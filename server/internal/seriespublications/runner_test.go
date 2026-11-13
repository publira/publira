package seriespublications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

type stubQueries struct {
	// The tenant has no webhook endpoint, so owing the webhooks reads nothing
	// past the endpoints.
	tenantwebhooks.Queries

	// lockErr answers LockSeriesPublicationDue; sql.ErrNoRows is a series
	// changed since the listing read it.
	lockErr error
	due     []dbmodels.ListSeriesPublicationsDueRow
	dueErr  error
	marked  []uuid.UUID
	markErr error
	// redated answers RedateEpisodesForSeriesPublication per series.
	redated   map[uuid.UUID][]dbmodels.RedateEpisodesForSeriesPublicationRow
	redateErr error
	outbox    []dbmodels.InsertOutboxEventParams
	// calls is every statement in the order the runner ran it.
	calls []string
}

func (s *stubQueries) RedateEpisodesForSeriesPublication(_ context.Context, arg dbmodels.RedateEpisodesForSeriesPublicationParams) ([]dbmodels.RedateEpisodesForSeriesPublicationRow, error) {
	s.calls = append(s.calls, "redate")
	if s.redateErr != nil {
		return nil, s.redateErr
	}
	return s.redated[arg.SeriesID], nil
}

func (s *stubQueries) ClearEpisodeAnnouncementsOwed(context.Context, dbmodels.ClearEpisodeAnnouncementsOwedParams) error {
	s.calls = append(s.calls, "clear")
	return nil
}

func (s *stubQueries) InsertOutboxEvent(_ context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error) {
	s.calls = append(s.calls, arg.EventType)
	s.outbox = append(s.outbox, arg)
	return dbmodels.OutboxEvent{}, nil
}

func (s *stubQueries) LockSeriesPublicationDue(_ context.Context, arg dbmodels.LockSeriesPublicationDueParams) (uuid.UUID, error) {
	s.calls = append(s.calls, "lock")
	return arg.ID, s.lockErr
}

func (s *stubQueries) ListTenantWebhookEndpointsForEvent(context.Context, dbmodels.ListTenantWebhookEndpointsForEventParams) ([]uuid.UUID, error) {
	s.calls = append(s.calls, "webhooks")
	return nil, nil
}

func (s *stubQueries) ListSeriesPublicationsDue(context.Context) ([]dbmodels.ListSeriesPublicationsDueRow, error) {
	return s.due, s.dueErr
}

func (s *stubQueries) MarkSeriesPublicationRevalidated(_ context.Context, id uuid.UUID) error {
	s.calls = append(s.calls, "mark")
	if s.markErr != nil {
		return s.markErr
	}
	s.marked = append(s.marked, id)
	return nil
}

type stubRevalidator struct {
	calls   [][]string
	tenants []uuid.UUID
	err     error
	// queries, when set, has the revalidation logged among its statements.
	queries *stubQueries
}

func (s *stubRevalidator) RevalidateTags(_ context.Context, tenantID uuid.UUID, tags []string) error {
	if s.queries != nil {
		s.queries.calls = append(s.queries.calls, "revalidate")
	}
	s.calls = append(s.calls, tags)
	s.tenants = append(s.tenants, tenantID)
	return s.err
}

// newStubRunner is a runner over queries whose transactions run on queries
// too, logged among its statements.
func newStubRunner(queries *stubQueries, reval Revalidator) *Runner {
	return newRunner(queries, func(_ context.Context, fn func(WebhookQueries) error) error {
		queries.calls = append(queries.calls, "begin")
		if err := fn(queries); err != nil {
			queries.calls = append(queries.calls, "rollback")
			return err
		}
		queries.calls = append(queries.calls, "commit")
		return nil
	}, reval, quietLogger())
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRunOnceRevalidatesOncePerTenantAndMarksEverySeries(t *testing.T) {
	tenantA := uuid.Must(uuid.NewV7())
	tenantB := uuid.Must(uuid.NewV7())
	first := uuid.Must(uuid.NewV7())
	second := uuid.Must(uuid.NewV7())
	other := uuid.Must(uuid.NewV7())

	queries := &stubQueries{due: []dbmodels.ListSeriesPublicationsDueRow{
		{ID: first, TenantID: tenantA, PublicID: "SERIESA00001"},
		{ID: second, TenantID: tenantA, PublicID: "SERIESA00002"},
		{ID: other, TenantID: tenantB, PublicID: "SERIESB00001"},
	}}
	reval := &stubRevalidator{}

	newStubRunner(queries, reval).RunOnce(context.Background())

	// The lists and the creator pages are cached per tenant, so the two series
	// of tenant A are answered by one request that also names each of them.
	wantTenants := []uuid.UUID{tenantA, tenantB}
	if !slices.Equal(reval.tenants, wantTenants) {
		t.Fatalf("revalidated tenants = %v, want one request each for %v", reval.tenants, wantTenants)
	}
	wantTags := [][]string{
		{
			fmt.Sprintf("tenant:%s:series:list", tenantA),
			fmt.Sprintf("tenant:%s:series:detail", tenantA),
			fmt.Sprintf("tenant:%s:creators", tenantA),
			fmt.Sprintf("tenant:%s:series:SERIESA00001", tenantA),
			fmt.Sprintf("tenant:%s:series:SERIESA00002", tenantA),
		},
		{
			fmt.Sprintf("tenant:%s:series:list", tenantB),
			fmt.Sprintf("tenant:%s:series:detail", tenantB),
			fmt.Sprintf("tenant:%s:creators", tenantB),
			fmt.Sprintf("tenant:%s:series:SERIESB00001", tenantB),
		},
	}
	for index, want := range wantTags {
		if !slices.Equal(reval.calls[index], want) {
			t.Errorf("revalidated %v for tenant %s, want %v", reval.calls[index], wantTenants[index], want)
		}
	}

	if want := []uuid.UUID{first, second, other}; !slices.Equal(queries.marked, want) {
		t.Errorf("series marked = %v, want %v", queries.marked, want)
	}
}

// The episodes added while the series was hidden are dated and their
// announcements queued before what they owed is cleared, and all of it before
// the drop is recorded, so the drop carries the new dates; the webhooks, in a
// transaction that holds the series, and the series' search sync are owed
// after them, since both carry them; and the publication is marked applied
// last.
func TestRunOnceAnnouncesTheEpisodesAddedWhileHiddenBeforeTheDrop(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	publishedAt := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

	queries := &stubQueries{
		due: []dbmodels.ListSeriesPublicationsDueRow{{ID: seriesID, TenantID: tenantID, PublicID: "SERIESA00001"}},
		redated: map[uuid.UUID][]dbmodels.RedateEpisodesForSeriesPublicationRow{
			seriesID: {{EpisodeID: episodeID, SeriesPublishedAt: publishedAt}},
		},
	}
	reval := &stubRevalidator{queries: queries}

	newStubRunner(queries, reval).RunOnce(context.Background())

	wantCalls := []string{"redate", outbox.EventTypeEpisodePublishedNotification, "clear", "begin", "lock", "webhooks", "commit", outbox.EventTypeCatalogIndexSync, "revalidate", "mark"}
	if !slices.Equal(queries.calls, wantCalls) {
		t.Fatalf("statements = %v, want %v", queries.calls, wantCalls)
	}
	announcement := queries.outbox[0]
	if want := outbox.SeriesPublicationIdempotencyKey(episodeID, publishedAt); announcement.IdempotencyKey != want {
		t.Errorf("announcement idempotency_key = %q, want %q", announcement.IdempotencyKey, want)
	}
	var payload outbox.EpisodePublishedNotificationPayload
	if err := json.Unmarshal(announcement.Payload, &payload); err != nil {
		t.Fatalf("decode announcement payload: %v", err)
	}
	if want := (outbox.EpisodePublishedNotificationPayload{TenantID: tenantID.String(), EpisodeID: episodeID.String()}); payload != want {
		t.Errorf("announcement payload = %+v, want %+v", payload, want)
	}
}

// A series hidden or rescheduled since the listing read it owes no webhook,
// since its episodes did not come back with the publication the job listed,
// and the rest of the pass goes on as it would have.
func TestRunOnceOwesNoWebhookForASeriesChangedSinceTheListing(t *testing.T) {
	seriesID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{
		due:     []dbmodels.ListSeriesPublicationsDueRow{{ID: seriesID, TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESGONE01"}},
		lockErr: sql.ErrNoRows,
	}

	newStubRunner(queries, &stubRevalidator{}).RunOnce(context.Background())

	wantCalls := []string{"redate", "begin", "lock", "commit", outbox.EventTypeCatalogIndexSync, "mark"}
	if !slices.Equal(queries.calls, wantCalls) {
		t.Fatalf("statements = %v, want %v", queries.calls, wantCalls)
	}
}

// A series whose webhooks could not be owed keeps its publication owed, so the
// next pass owes them rather than marking it applied without them.
func TestRunOnceLeavesSeriesUnmarkedWhenItsWebhooksCannotBeOwed(t *testing.T) {
	queries := &stubQueries{
		due:     []dbmodels.ListSeriesPublicationsDueRow{{ID: uuid.Must(uuid.NewV7()), TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESFAIL03"}},
		lockErr: errors.New("connection reset"),
	}
	reval := &stubRevalidator{}

	newStubRunner(queries, reval).RunOnce(context.Background())

	if len(queries.marked) != 0 {
		t.Fatalf("series marked = %v, want none while its webhooks are owed", queries.marked)
	}
	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none", len(reval.calls))
	}
}

// A series whose episodes could not be dated keeps its publication owed, so the
// next pass dates them and announces them rather than marking it applied
// without either.
func TestRunOnceLeavesSeriesUnmarkedWhenItsEpisodesCannotBeAnnounced(t *testing.T) {
	queries := &stubQueries{
		due:       []dbmodels.ListSeriesPublicationsDueRow{{ID: uuid.Must(uuid.NewV7()), TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESFAIL02"}},
		redateErr: errors.New("connection reset"),
	}
	reval := &stubRevalidator{}

	newStubRunner(queries, reval).RunOnce(context.Background())

	if len(queries.marked) != 0 {
		t.Fatalf("marked %v after a failed announcement, want none", queries.marked)
	}
	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none for a tenant with nothing applied", len(reval.calls))
	}
}

// A publication marked while its caches are still standing would never be
// retried, so a failed revalidation leaves the tenant's rows as it found them.
func TestRunOnceLeavesSeriesUnmarkedWhenRevalidationFails(t *testing.T) {
	queries := &stubQueries{due: []dbmodels.ListSeriesPublicationsDueRow{
		{ID: uuid.Must(uuid.NewV7()), TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESFAIL01"},
	}}
	reval := &stubRevalidator{err: errors.New("connection reset")}

	newStubRunner(queries, reval).RunOnce(context.Background())

	if len(queries.marked) != 0 {
		t.Fatalf("marked %v after a failed revalidation, want none", queries.marked)
	}
}

// Revalidation can be turned off entirely. There is then nothing to drop, and a
// pass that kept collecting the publications it passed would grow without end.
func TestRunOnceMarksSeriesWithoutARevalidator(t *testing.T) {
	seriesID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListSeriesPublicationsDueRow{
		{ID: seriesID, TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESNONE01"},
	}}

	newStubRunner(queries, nil).RunOnce(context.Background())

	if want := []uuid.UUID{seriesID}; !slices.Equal(queries.marked, want) {
		t.Fatalf("series marked = %v, want %v", queries.marked, want)
	}
}

func TestRunOnceDoesNothingWithoutDueSeries(t *testing.T) {
	reval := &stubRevalidator{}

	newStubRunner(&stubQueries{}, reval).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none", len(reval.calls))
	}
}

func TestRunOnceStopsOnAListingFailure(t *testing.T) {
	reval := &stubRevalidator{}

	newStubRunner(&stubQueries{dueErr: errors.New("connection refused")}, reval).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none when the listing failed", len(reval.calls))
	}
}
