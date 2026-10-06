package freewindows

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

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
)

type stubQueries struct {
	due       []dbmodels.ListEpisodeFreeWindowBoundariesDueRow
	dueErr    error
	startMark []uuid.UUID
	endMark   []uuid.UUID
	markErr   error
	// synced are the series a catalog_index_sync event was queued for, in
	// order, and syncErr fails every one of them.
	synced  []uuid.UUID
	syncErr error
}

func (s *stubQueries) InsertOutboxEvent(_ context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error) {
	if s.syncErr != nil {
		return dbmodels.OutboxEvent{}, s.syncErr
	}
	if arg.EventType != outbox.EventTypeCatalogIndexSync {
		return dbmodels.OutboxEvent{}, fmt.Errorf("unexpected outbox event %s", arg.EventType)
	}
	var payload outbox.CatalogIndexSyncPayload
	if err := json.Unmarshal(arg.Payload, &payload); err != nil {
		return dbmodels.OutboxEvent{}, err
	}
	id, err := uuid.Parse(payload.ID)
	if err != nil {
		return dbmodels.OutboxEvent{}, err
	}
	s.synced = append(s.synced, id)
	return dbmodels.OutboxEvent{}, nil
}

func (s *stubQueries) ListEpisodeFreeWindowBoundariesDue(context.Context) ([]dbmodels.ListEpisodeFreeWindowBoundariesDueRow, error) {
	return s.due, s.dueErr
}

func (s *stubQueries) MarkEpisodeFreeWindowStartRevalidated(_ context.Context, id uuid.UUID) error {
	if s.markErr != nil {
		return s.markErr
	}
	s.startMark = append(s.startMark, id)
	return nil
}

func (s *stubQueries) MarkEpisodeFreeWindowEndRevalidated(_ context.Context, id uuid.UUID) error {
	if s.markErr != nil {
		return s.markErr
	}
	s.endMark = append(s.endMark, id)
	return nil
}

type stubRevalidator struct {
	calls   [][]string
	tenants []uuid.UUID
	err     error
}

func (s *stubRevalidator) RevalidateTags(_ context.Context, tenantID uuid.UUID, tags []string) error {
	s.calls = append(s.calls, tags)
	s.tenants = append(s.tenants, tenantID)
	return s.err
}

func yes() sql.NullBool { return sql.NullBool{Bool: true, Valid: true} }
func no() sql.NullBool  { return sql.NullBool{Bool: false, Valid: true} }

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRunOnceRevalidatesOncePerTenantAndMarksEveryBoundary(t *testing.T) {
	tenantA := uuid.Must(uuid.NewV7())
	tenantB := uuid.Must(uuid.NewV7())
	opened := uuid.Must(uuid.NewV7())
	closed := uuid.Must(uuid.NewV7())
	both := uuid.Must(uuid.NewV7())

	seriesA := uuid.Must(uuid.NewV7())
	seriesB := uuid.Must(uuid.NewV7())

	queries := &stubQueries{due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
		{ID: opened, TenantID: tenantA, SeriesID: seriesA, StartDue: yes(), EndDue: no()},
		{ID: closed, TenantID: tenantA, SeriesID: seriesA, StartDue: no(), EndDue: yes()},
		{ID: both, TenantID: tenantB, SeriesID: seriesB, StartDue: yes(), EndDue: yes()},
	}}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	// Every cached read of an episode carries its tenant's series detail tag,
	// and every cached series list its series list tag, so the two windows of
	// tenant A are answered by one request. The list is what the free-episode
	// count on a series card and the "Free to read" module are cached under.
	wantTenants := []uuid.UUID{tenantA, tenantB}
	if !slices.Equal(reval.tenants, wantTenants) {
		t.Fatalf("revalidated tenants = %v, want one request each for %v", reval.tenants, wantTenants)
	}
	for index, tenantID := range wantTenants {
		want := []string{
			fmt.Sprintf("tenant:%s:series:detail", tenantID),
			fmt.Sprintf("tenant:%s:series:list", tenantID),
		}
		if !slices.Equal(reval.calls[index], want) {
			t.Errorf("revalidated %v for tenant %s, want %v", reval.calls[index], tenantID, want)
		}
	}

	// Whether a free episode is open is on the series' search document, which
	// is read again once per series however many of its windows passed.
	if want := []uuid.UUID{seriesA, seriesB}; !slices.Equal(queries.synced, want) {
		t.Errorf("series synced = %v, want %v", queries.synced, want)
	}

	if len(queries.startMark) != 2 || queries.startMark[0] != opened || queries.startMark[1] != both {
		t.Errorf("start boundaries marked = %v, want %v", queries.startMark, []uuid.UUID{opened, both})
	}
	if len(queries.endMark) != 2 || queries.endMark[0] != closed || queries.endMark[1] != both {
		t.Errorf("end boundaries marked = %v, want %v", queries.endMark, []uuid.UUID{closed, both})
	}
}

// A boundary marked while its caches are still standing would never be retried,
// so a failed revalidation leaves the tenant's rows exactly as it found them.
func TestRunOnceLeavesBoundariesUnmarkedWhenRevalidationFails(t *testing.T) {
	failing := uuid.Must(uuid.NewV7())
	healthy := uuid.Must(uuid.NewV7())
	tenantA := uuid.Must(uuid.NewV7())

	queries := &stubQueries{due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
		{ID: failing, TenantID: tenantA, StartDue: yes(), EndDue: no()},
		{ID: healthy, TenantID: tenantA, StartDue: yes(), EndDue: no()},
	}}
	reval := &stubRevalidator{err: errors.New("web-host is unreachable")}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	if len(queries.startMark) != 0 || len(queries.endMark) != 0 {
		t.Fatalf("marked %v / %v after a failed revalidation, want none", queries.startMark, queries.endMark)
	}
}

// A boundary marked before its series' search document is owed a sync would
// leave the search answering from the side of the window it has left.
func TestRunOnceLeavesBoundariesUnmarkedWhenTheSyncCannotBeQueued(t *testing.T) {
	queries := &stubQueries{
		due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
			{ID: uuid.Must(uuid.NewV7()), TenantID: uuid.Must(uuid.NewV7()), SeriesID: uuid.Must(uuid.NewV7()), StartDue: yes(), EndDue: no()},
		},
		syncErr: errors.New("connection reset"),
	}

	New(queries, &stubRevalidator{}, quietLogger()).RunOnce(context.Background())

	if len(queries.startMark) != 0 || len(queries.endMark) != 0 {
		t.Fatalf("marked %v / %v after a failed sync, want none", queries.startMark, queries.endMark)
	}
}

// Revalidation can be turned off entirely. There is then nothing to drop, and a
// pass that kept collecting the boundaries it crossed would grow without end.
func TestRunOnceMarksBoundariesWithoutARevalidator(t *testing.T) {
	windowID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
		{ID: windowID, TenantID: uuid.Must(uuid.NewV7()), SeriesID: uuid.Must(uuid.NewV7()), StartDue: yes(), EndDue: no()},
	}}

	New(queries, nil, quietLogger()).RunOnce(context.Background())

	if len(queries.startMark) != 1 || queries.startMark[0] != windowID {
		t.Fatalf("start boundaries marked = %v, want %v", queries.startMark, []uuid.UUID{windowID})
	}
}

func TestRunOnceDoesNothingWithoutDueBoundaries(t *testing.T) {
	queries := &stubQueries{}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none", len(reval.calls))
	}
}

func TestRunOnceStopsOnAListingFailure(t *testing.T) {
	queries := &stubQueries{dueErr: errors.New("connection refused")}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none when the listing failed", len(reval.calls))
	}
}
