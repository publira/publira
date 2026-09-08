package publicapi

import (
	"context"
	"database/sql"
	"slices"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func episodeReadRequest(tenant testutil.Tenant, episodePublicID, token string) *connect.Request[publirav1.MarkEpisodeAsReadRequest] {
	return newBearerRequest(&publirav1.MarkEpisodeAsReadRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
	}, token)
}

func episodeReadListRequest(tenant testutil.Tenant, token string, limit int32, pageToken string) *connect.Request[publirav1.ListMyEpisodeReadsRequest] {
	return newBearerRequest(&publirav1.ListMyEpisodeReadsRequest{
		Tenant: tenantContext(tenant),
		Limit:  limit,
		Token:  pageToken,
	}, token)
}

func historyEpisodePublicIDs(reads []*publirav1.MyEpisodeRead) []string {
	ids := make([]string, 0, len(reads))
	for _, read := range reads {
		ids = append(ids, read.GetEpisode().GetPublicId())
	}
	return ids
}

func TestDBEpisodeReadServiceKeepsFirstReadDuringRepeatedAndConcurrentCalls(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADA", "read-a.example.com", "Read A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADA", "member-read-a@example.com", "Member A", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADA", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADA", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	first, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, token))
	if err != nil {
		t.Fatalf("first MarkEpisodeAsRead: %v", err)
	}
	firstReadAt, err := time.Parse(time.RFC3339Nano, first.Msg.ReadAt)
	if err != nil {
		t.Fatalf("parse first read_at %q: %v", first.Msg.ReadAt, err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			response, callErr := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, token))
			if callErr != nil {
				errs <- callErr
				return
			}
			if response.Msg.ReadAt != first.Msg.ReadAt {
				errs <- &readAtChangedError{got: response.Msg.ReadAt, want: first.Msg.ReadAt}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("concurrent MarkEpisodeAsRead: %v", err)
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_reads WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, member.ID, episode.ID); got != 1 {
		t.Fatalf("episode read rows = %d, want 1", got)
	}
	var storedReadAt time.Time
	if err := env.PG.DB.QueryRowContext(context.Background(), "SELECT read_at FROM episode_reads WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, member.ID, episode.ID).Scan(&storedReadAt); err != nil {
		t.Fatalf("get stored read_at: %v", err)
	}
	if !storedReadAt.Equal(firstReadAt) {
		t.Fatalf("stored read_at = %s, want first %s", storedReadAt, firstReadAt)
	}
}

type readAtChangedError struct {
	got  string
	want string
}

func (e *readAtChangedError) Error() string {
	return "read_at = " + e.got + ", want " + e.want
}

func TestDBEpisodeReadServiceRequiresCurrentPublicationAndBodyAccess(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADB", "member-read-b@example.com", "Member B", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADB", Title: "Public series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADB", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADC", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})
	purchased := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADD", Title: "Purchased", Status: testutil.EpisodeStatusPublished, Price: 500})
	ticketed := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADE", Title: "Ticketed", Status: testutil.EpisodeStatusPublished, Price: 500})
	draft := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADF", Title: "Draft", Status: testutil.EpisodeStatusDraft})
	expiredTicket := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADH", Title: "Expired ticket", Status: testutil.EpisodeStatusPublished, Price: 500})
	foreignSeries := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADC", Title: "Foreign", Published: true})
	foreign := env.PG.SeedEpisode(t, otherTenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADG", Title: "Foreign", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedPurchase(t, tenant.ID, member.ID, purchased.ID, purchased.Price)
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id)
		VALUES ($1, $2, $3, $4, $5)
	`, uuid.Must(uuid.NewV7()), tenant.ID, "TICKETREAD01", ticketed.ID, member.ID); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenant.ID, "TICKETREAD02", expiredTicket.ID, member.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("seed expired access ticket: %v", err)
	}

	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)
	for _, episode := range []testutil.Episode{free, purchased, ticketed} {
		response, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, token))
		if err != nil {
			t.Fatalf("MarkEpisodeAsRead %s: %v", episode.PublicID, err)
		}
		if response.Msg.ReadAt == "" {
			t.Fatalf("MarkEpisodeAsRead %s returned empty read_at", episode.PublicID)
		}
	}
	for _, publicID := range []string{paid.PublicID, draft.PublicID, expiredTicket.PublicID, foreign.PublicID, "MISSINGREAD"} {
		_, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, publicID, token))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("MarkEpisodeAsRead %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_reads WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 3 {
		t.Fatalf("accessible episode read rows = %d, want 3", got)
	}
}

func TestDBEpisodeReadsAreMemberScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADC", "read-c.example.com", "Read C")
	first := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADC", "member-read-c@example.com", "Member C", "tenant_member")
	second := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADD", "member-read-d@example.com", "Member D", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADD", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADH", Title: "Free", Status: testutil.EpisodeStatusPublished})
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)", uuid.Must(uuid.NewV7()), tenant.ID, first.ID, episode.ID); err != nil {
		t.Fatalf("seed first member read: %v", err)
	}

	env.withTenantConn(t, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", second.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM episode_reads").Scan(&visible); err != nil {
			t.Fatalf("count episode reads: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other member visible episode reads = %d, want 0", visible)
		}
		created, err := conn.ExecContext(ctx, "INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)", uuid.Must(uuid.NewV7()), tenant.ID, first.ID, episode.ID)
		if err == nil {
			t.Fatalf("create a first member read as another member succeeded: %#v", created)
		}
		updated, err := conn.ExecContext(ctx, "UPDATE episode_reads SET read_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, first.ID, episode.ID)
		if err != nil {
			t.Fatalf("attempt to update another member read: %v", err)
		}
		if changed, err := updated.RowsAffected(); err != nil {
			t.Fatalf("other member update rows affected: %v", err)
		} else if changed != 0 {
			t.Fatalf("other member updated %d episode reads, want 0", changed)
		}
	})
}

func TestDBEpisodeReadProjectsOneCompleteEventPerRead(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADE", "read-e.example.com", "Read E")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADE", "member-read-e@example.com", "Member E", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADE", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADI", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	for range 3 {
		if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, token)); err != nil {
			t.Fatalf("MarkEpisodeAsRead: %v", err)
		}
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM content_events WHERE tenant_id = $1 AND event_type = 'episode_complete'", tenant.ID); got != 1 {
		t.Fatalf("episode_complete events = %d, want 1", got)
	}

	var (
		readID     uuid.UUID
		readAt     time.Time
		eventUser  uuid.UUID
		eventSerie uuid.UUID
		sourceID   uuid.UUID
		occurredAt time.Time
	)
	if err := env.PG.DB.QueryRowContext(context.Background(), `
		SELECT r.id, r.read_at, ce.user_id, ce.series_id, ce.source_id, ce.occurred_at
		FROM episode_reads r
		JOIN content_events ce
			ON ce.tenant_id = r.tenant_id
			AND ce.source_table = 'episode_reads'
			AND ce.source_id = r.id
		WHERE r.tenant_id = $1 AND r.user_id = $2 AND r.episode_id = $3
	`, tenant.ID, member.ID, episode.ID).Scan(&readID, &readAt, &eventUser, &eventSerie, &sourceID, &occurredAt); err != nil {
		t.Fatalf("join the read to its projection: %v", err)
	}
	if sourceID != readID {
		t.Fatalf("source_id = %s, want the episode_reads id %s", sourceID, readID)
	}
	if eventUser != member.ID {
		t.Fatalf("event user_id = %s, want %s", eventUser, member.ID)
	}
	if eventSerie != series.ID {
		t.Fatalf("event series_id = %s, want the episode's own series %s", eventSerie, series.ID)
	}
	if !occurredAt.Equal(readAt) {
		t.Fatalf("occurred_at = %s, want the first read time %s", occurredAt, readAt)
	}
}

func TestDBListMyEpisodeReadsPagesTheMostRecentlyFinishedFirst(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADF", "read-f.example.com", "Read F")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADF", "member-read-f@example.com", "Member F", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADF", Title: "Public series", Published: true})
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	// Finished oldest first, so the history is the reverse of this order.
	var finished []string
	for _, publicID := range []string{"EPISODEREADJ", "EPISODEREADK", "EPISODEREADL"} {
		episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: publicID, Status: testutil.EpisodeStatusPublished})
		if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, token)); err != nil {
			t.Fatalf("MarkEpisodeAsRead %s: %v", episode.PublicID, err)
		}
		finished = append(finished, episode.PublicID)
	}
	first, second, third := finished[0], finished[1], finished[2]

	page, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, token, 2, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	if got, want := historyEpisodePublicIDs(page.Msg.Reads), []string{third, second}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	if got := page.Msg.Reads[0].GetSeries().GetPublicId(); got != series.PublicID {
		t.Fatalf("series public id = %q, want the episode's own series %q", got, series.PublicID)
	}
	if page.Msg.Reads[0].GetReadAt() == "" {
		t.Fatal("read_at is empty, want the instant the reader finished the episode")
	}
	if page.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", page.Msg.PreviousToken)
	}
	if page.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token while an episode remains")
	}

	rest, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, token, 2, page.Msg.NextToken))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads next page: %v", err)
	}
	if got, want := historyEpisodePublicIDs(rest.Msg.Reads), []string{first}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v", got, want)
	}
	if rest.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", rest.Msg.NextToken)
	}

	back, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, token, 2, rest.Msg.PreviousToken))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads previous page: %v", err)
	}
	if got, want := historyEpisodePublicIDs(back.Msg.Reads), []string{third, second}; !slices.Equal(got, want) {
		t.Fatalf("page back = %v, want the first page again %v", got, want)
	}
}

// Publication decides what the history may name; body access does not. A
// series taken down disappears from it, while an episode whose rental has run
// out stays, because the reader did read it.
func TestDBListMyEpisodeReadsDropsWithdrawnSeriesAndKeepsExpiredRentals(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADG", "read-g.example.com", "Read G")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADG", "member-read-g@example.com", "Member G", "tenant_member")
	staying := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADG", Title: "Staying", Published: true})
	withdrawn := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADH", Title: "Withdrawn", Published: true})
	rented := env.PG.SeedEpisode(t, tenant.ID, staying.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADM", Title: "Rented", Status: testutil.EpisodeStatusPublished, Price: 500})
	withdrawnEpisode := env.PG.SeedEpisode(t, tenant.ID, withdrawn.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADN", Title: "Withdrawn", Status: testutil.EpisodeStatusPublished})
	ticketID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ticketID, tenant.ID, "TICKETREAD03", rented.ID, member.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	for _, publicID := range []string{rented.PublicID, withdrawnEpisode.PublicID} {
		if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, publicID, token)); err != nil {
			t.Fatalf("MarkEpisodeAsRead %s: %v", publicID, err)
		}
	}
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE access_tickets SET expires_at = $1 WHERE id = $2", time.Now().Add(-time.Minute), ticketID,
	); err != nil {
		t.Fatalf("expire access ticket: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE series SET is_published = false WHERE id = $1", withdrawn.ID,
	); err != nil {
		t.Fatalf("unpublish series: %v", err)
	}

	response, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, token, 0, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	if got, want := historyEpisodePublicIDs(response.Msg.Reads), []string{rented.PublicID}; !slices.Equal(got, want) {
		t.Fatalf("history = %v, want only the still published episode %v", got, want)
	}
}

func TestDBListMyEpisodeReadsIsScopedToOneReaderAndTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	reader := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADH", "member-read-h@example.com", "Member H", "tenant_member")
	neighbour := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADI", "member-read-i@example.com", "Member I", "tenant_member")
	foreignMember := env.PG.SeedTenantUser(t, otherTenant.ID, "MEMBERREADJ", "member-read-j@example.com", "Member J", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADI", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADO", Title: "Free", Status: testutil.EpisodeStatusPublished})
	foreignSeries := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADJ", Title: "Foreign series", Published: true})
	foreignEpisode := env.PG.SeedEpisode(t, otherTenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADP", Title: "Foreign", Status: testutil.EpisodeStatusPublished})
	client := env.episodeReadClient()

	if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, episode.PublicID, tokenFor(t, tenant, reader))); err != nil {
		t.Fatalf("MarkEpisodeAsRead: %v", err)
	}
	if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(otherTenant, foreignEpisode.PublicID, tokenFor(t, otherTenant, foreignMember))); err != nil {
		t.Fatalf("MarkEpisodeAsRead in the other tenant: %v", err)
	}

	own, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, tokenFor(t, tenant, reader), 0, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads as the reader: %v", err)
	}
	if got, want := historyEpisodePublicIDs(own.Msg.Reads), []string{episode.PublicID}; !slices.Equal(got, want) {
		t.Fatalf("the reader's history = %v, want %v", got, want)
	}

	fromNeighbour, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(tenant, tokenFor(t, tenant, neighbour), 0, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads as another member: %v", err)
	}
	if len(fromNeighbour.Msg.Reads) != 0 {
		t.Fatalf("another member's view = %v, want none of the reader's history", historyEpisodePublicIDs(fromNeighbour.Msg.Reads))
	}

	fromOtherTenant, err := client.ListMyEpisodeReads(context.Background(), episodeReadListRequest(otherTenant, tokenFor(t, otherTenant, foreignMember), 0, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads as a member of the other tenant: %v", err)
	}
	if got, want := historyEpisodePublicIDs(fromOtherTenant.Msg.Reads), []string{foreignEpisode.PublicID}; !slices.Equal(got, want) {
		t.Fatalf("the other tenant's member sees %v, want only their own tenant's %v", got, want)
	}
}

// The series page marks its episode list from this list, and a reader can have
// finished episodes without ever saving a position, so it is reported whether
// or not there is progress to report beside it.
func TestDBSeriesProgressReportsTheFinishedEpisodesOfThatSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTREADH", "read-h.example.com", "Read H")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERREADK", "member-read-k@example.com", "Member K", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADK", Title: "Public series", Published: true})
	other := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREADL", Title: "Other series", Published: true})
	first := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADQ", Title: "Episode 1", Status: testutil.EpisodeStatusPublished, OrderIndex: 1})
	second := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADR", Title: "Episode 2", Status: testutil.EpisodeStatusPublished, OrderIndex: 2})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADS", Title: "Episode 3", Status: testutil.EpisodeStatusPublished, OrderIndex: 3})
	elsewhere := env.PG.SeedEpisode(t, tenant.ID, other.ID, testutil.EpisodeSeed{PublicID: "EPISODEREADT", Title: "Elsewhere", Status: testutil.EpisodeStatusPublished})
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	for _, publicID := range []string{second.PublicID, first.PublicID, elsewhere.PublicID} {
		if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, publicID, token)); err != nil {
			t.Fatalf("MarkEpisodeAsRead %s: %v", publicID, err)
		}
	}

	response, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if got, want := response.Msg.FinishedEpisodePublicIds, []string{first.PublicID, second.PublicID}; !slices.Equal(got, want) {
		t.Fatalf("finished_episode_public_ids = %v, want this series' finished episodes in list order %v", got, want)
	}
	if response.Msg.Progress != nil {
		t.Fatalf("progress = %+v, want none while the reader has saved no position", response.Msg.Progress)
	}
}
