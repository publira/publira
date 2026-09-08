package freewindows

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

type stubQueries struct {
	due       []dbmodels.ListEpisodeFreeWindowBoundariesDueRow
	dueErr    error
	startMark []uuid.UUID
	endMark   []uuid.UUID
	markErr   error
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
	calls [][]string
	err   error
}

func (s *stubRevalidator) RevalidateTags(_ context.Context, tags []string) error {
	s.calls = append(s.calls, tags)
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

	queries := &stubQueries{due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
		{ID: opened, TenantID: tenantA, StartDue: yes(), EndDue: no()},
		{ID: closed, TenantID: tenantA, StartDue: no(), EndDue: yes()},
		{ID: both, TenantID: tenantB, StartDue: yes(), EndDue: yes()},
	}}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	// Every cached read of an episode carries its tenant's series tag, so the
	// two windows of tenant A are answered by one request.
	if len(reval.calls) != 2 {
		t.Fatalf("revalidations = %d, want one per tenant", len(reval.calls))
	}
	wantTags := map[string]bool{
		RevalidateTags(tenantA)[0]: true,
		RevalidateTags(tenantB)[0]: true,
	}
	for _, call := range reval.calls {
		if len(call) != 1 || !wantTags[call[0]] {
			t.Fatalf("revalidated %v, want one of the two tenant tags", call)
		}
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

// Revalidation can be turned off entirely. There is then nothing to drop, and a
// pass that kept collecting the boundaries it crossed would grow without end.
func TestRunOnceMarksBoundariesWithoutARevalidator(t *testing.T) {
	windowID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListEpisodeFreeWindowBoundariesDueRow{
		{ID: windowID, TenantID: uuid.Must(uuid.NewV7()), StartDue: yes(), EndDue: no()},
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
