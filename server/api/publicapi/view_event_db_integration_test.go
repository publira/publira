package publicapi

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Soft PV is written on the way out of a successful RecordContentView, so
// nothing about it can be asserted against canned rows: the debounce lives in a
// partial unique index, the actor in a generated column, and the tenant
// boundary in an RLS policy. These cases drive the real database.

// contentEventRow is the part of content_events these tests read back.
type contentEventRow struct {
	eventType   string
	userID      uuid.NullUUID
	anonymousID uuid.NullUUID
	actorKey    uuid.NullUUID
	seriesID    uuid.NullUUID
	episodeID   uuid.NullUUID
	payload     []byte
}

func (e *publicDBEnv) contentEvents(t *testing.T, tenantID uuid.UUID) []contentEventRow {
	t.Helper()

	rows, err := e.PG.DB.QueryContext(context.Background(), `
		SELECT event_type, user_id, anonymous_id, actor_key, series_id, episode_id, payload
		FROM content_events
		WHERE tenant_id = $1
		ORDER BY occurred_at, id
	`, tenantID)
	if err != nil {
		t.Fatalf("read content_events: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	events := make([]contentEventRow, 0)
	for rows.Next() {
		var event contentEventRow
		if err := rows.Scan(&event.eventType, &event.userID, &event.anonymousID,
			&event.actorKey, &event.seriesID, &event.episodeID, &event.payload); err != nil {
			t.Fatalf("scan content_events: %v", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate content_events: %v", err)
	}
	return events
}

// seedPublishedEpisode gives every case below the same starting point: one
// published series with one published free episode inside it.
func (e *publicDBEnv) seedPublishedEpisode(t *testing.T, tenant testutil.Tenant) (testutil.Series, testutil.Episode) {
	t.Helper()

	series := e.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESVIEW01",
		Title:     "Viewed Series",
		Published: true,
	})
	episode := e.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEVIEW1",
		Title:    "Viewed Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	return series, episode
}

func episodeViewRequest(tenant testutil.Tenant, publicID string) *connect.Request[publirav1.RecordContentViewRequest] {
	return connect.NewRequest(&publirav1.RecordContentViewRequest{
		Tenant: tenantContext(tenant),
		Target: episodeViewTarget(publicID),
	})
}

func seriesViewRequest(tenant testutil.Tenant, publicID string) *connect.Request[publirav1.RecordContentViewRequest] {
	return connect.NewRequest(&publirav1.RecordContentViewRequest{
		Tenant: tenantContext(tenant),
		Target: seriesViewTarget(publicID),
	})
}

func episodeDetailRequest(tenant testutil.Tenant, publicID string) *connect.Request[publirav1.GetEpisodeDetailRequest] {
	return connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: publicID,
	})
}

func TestDBEpisodeViewEventMintsAnActorAndRecordsOneRowPerBucket(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series, episode := env.seedPublishedEpisode(t, tenant)
	client := env.contentViewClient()

	first, err := client.RecordContentView(context.Background(), episodeViewRequest(tenant, episode.PublicID))
	if err != nil {
		t.Fatalf("first RecordContentView: %v", err)
	}
	anonymousID := mintedAnonymousID(t, first.Header())

	// The same reader coming back inside the debounce window is the case the
	// partial unique index exists for.
	second := episodeViewRequest(tenant, episode.PublicID)
	second.Header().Set("Cookie", anonymousIDCookieName+"="+anonymousID.String())
	secondResp, err := client.RecordContentView(context.Background(), second)
	if err != nil {
		t.Fatalf("second RecordContentView: %v", err)
	}
	if got := secondResp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie on the second view = %v, want the existing identifier reused", got)
	}

	events := env.contentEvents(t, tenant.ID)
	if len(events) != 1 {
		t.Fatalf("content_events = %d rows, want 1 for two views in the same bucket", len(events))
	}
	event := events[0]
	if event.eventType != "episode_view" {
		t.Fatalf("event_type = %q, want episode_view", event.eventType)
	}
	if event.anonymousID.UUID != anonymousID {
		t.Fatalf("anonymous_id = %v, want the minted %v", event.anonymousID, anonymousID)
	}
	if event.userID.Valid {
		t.Fatalf("user_id = %v, want unset for a signed-out reader", event.userID.UUID)
	}
	if event.actorKey.UUID != anonymousID {
		t.Fatalf("actor_key = %v, want it to fall through to the anonymous id", event.actorKey)
	}
	// The client never names the series: the server reads it off the episode,
	// so the row cannot contradict the episode it belongs to.
	if event.seriesID.UUID != series.ID {
		t.Fatalf("series_id = %v, want the episode's series %v", event.seriesID, series.ID)
	}
	if event.episodeID.UUID != episode.ID {
		t.Fatalf("episode_id = %v, want %v", event.episodeID, episode.ID)
	}

	var payload map[string]string
	if err := json.Unmarshal(event.payload, &payload); err != nil {
		t.Fatalf("payload %s: %v", event.payload, err)
	}
	if payload["pv_kind"] != "soft" {
		t.Fatalf("payload = %s, want it marked as soft PV", event.payload)
	}
}

func TestDBEpisodeViewEventAttributesASignedInReaderToTheirUser(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	_, episode := env.seedPublishedEpisode(t, tenant)
	member := env.PG.SeedEndUser(t, tenant.ID, "USERVIEW0001", "viewer@example.com", "Viewer")
	token := tokenFor(t, tenant, member)

	req := episodeViewRequest(tenant, episode.PublicID)
	req.Header().Set("Authorization", "Bearer "+token)
	// A member may well be carrying an anonymous cookie from before they signed
	// in; the member is the actor either way.
	req.Header().Set("Cookie", anonymousIDCookieName+"="+uuid.Must(uuid.NewV7()).String())
	if _, err := env.contentViewClient().RecordContentView(context.Background(), req); err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}

	events := env.contentEvents(t, tenant.ID)
	if len(events) != 1 {
		t.Fatalf("content_events = %d rows, want 1", len(events))
	}
	if events[0].userID.UUID != member.ID {
		t.Fatalf("user_id = %v, want the signed-in member %v", events[0].userID, member.ID)
	}
	if events[0].anonymousID.Valid {
		t.Fatalf("anonymous_id = %v, want unset for a signed-in member", events[0].anonymousID.UUID)
	}
}

func TestDBEpisodeViewEventConcurrentViewsWithOneCookieCollapseToOneRow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	_, episode := env.seedPublishedEpisode(t, tenant)
	client := env.contentViewClient()
	anonymousID := uuid.Must(uuid.NewV7())

	// Concurrency is where ON CONFLICT DO NOTHING earns its place: a
	// read-then-insert would let several of these through.
	const readers = 8
	var wg sync.WaitGroup
	errs := make([]error, readers)
	for i := range readers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := episodeViewRequest(tenant, episode.PublicID)
			req.Header().Set("Cookie", anonymousIDCookieName+"="+anonymousID.String())
			_, errs[i] = client.RecordContentView(context.Background(), req)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("concurrent RecordContentView %d: %v", i, err)
		}
	}

	events := env.contentEvents(t, tenant.ID)
	if len(events) != 1 {
		t.Fatalf("content_events = %d rows, want 1 for %d concurrent views by one actor", len(events), readers)
	}
}

func TestDBSeriesViewEventIsRecordedForTheSeriesTarget(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series, _ := env.seedPublishedEpisode(t, tenant)

	resp, err := env.contentViewClient().RecordContentView(context.Background(), seriesViewRequest(tenant, series.PublicID))
	if err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}
	anonymousID := mintedAnonymousID(t, resp.Header())

	events := env.contentEvents(t, tenant.ID)
	if len(events) != 1 {
		t.Fatalf("content_events = %d rows, want 1", len(events))
	}
	event := events[0]
	if event.eventType != "series_view" {
		t.Fatalf("event_type = %q, want series_view", event.eventType)
	}
	if event.episodeID.Valid {
		t.Fatalf("episode_id = %v, want unset on a series view", event.episodeID.UUID)
	}
	if event.seriesID.UUID != series.ID {
		t.Fatalf("series_id = %v, want %v", event.seriesID, series.ID)
	}
	if event.anonymousID.UUID != anonymousID {
		t.Fatalf("anonymous_id = %v, want the minted %v", event.anonymousID, anonymousID)
	}
}

// An unpublished episode is not something a view may be filed against, so the
// call fails before anything is written rather than recording an attempt.
func TestDBViewEventIsNotRecordedForAnUnpublishedTarget(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESVIEW02",
		Title:     "Series With A Draft",
		Published: true,
	})
	draft := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEDRAF1",
		Title:    "Draft Episode",
	})

	_, err := env.contentViewClient().RecordContentView(context.Background(), episodeViewRequest(tenant, draft.PublicID))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RecordContentView on a draft code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	if events := env.contentEvents(t, tenant.ID); len(events) != 0 {
		t.Fatalf("content_events = %d rows, want none for a view that failed", len(events))
	}
}

// The detail RPCs are behind a `"use cache"` boundary in web-host, and a fill
// of that cache reaches the API carrying neither the reader's cookie nor a
// bearer. When they instrumented views themselves, every fill minted a fresh
// actor and left a row nothing could deduplicate.
func TestDBRepeatedDetailReadsRecordNoViewEvents(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series, episode := env.seedPublishedEpisode(t, tenant)
	client := env.catalogClient()

	const fills = 3
	for range fills {
		if _, err := client.GetEpisodeDetail(context.Background(), episodeDetailRequest(tenant, episode.PublicID)); err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		if _, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: series.PublicID,
		})); err != nil {
			t.Fatalf("GetSeriesDetail: %v", err)
		}
	}

	if events := env.contentEvents(t, tenant.ID); len(events) != 0 {
		t.Fatalf("content_events = %d rows, want none for %d cache fills", len(events), fills)
	}

	// The reader's own view still lands, so the table is empty above because
	// the detail reads stopped writing, not because writing broke.
	if _, err := env.contentViewClient().RecordContentView(context.Background(), episodeViewRequest(tenant, episode.PublicID)); err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}
	if events := env.contentEvents(t, tenant.ID); len(events) != 1 {
		t.Fatalf("content_events = %d rows, want the reader's single view", len(events))
	}
}
