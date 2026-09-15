package pinnedannouncements

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

type stubQueries struct {
	due      []dbmodels.ListPinnedAnnouncementsDueRow
	dueErr   error
	cleared  []uuid.UUID
	clearErr error
}

func (s *stubQueries) ListPinnedAnnouncementsDue(context.Context) ([]dbmodels.ListPinnedAnnouncementsDueRow, error) {
	return s.due, s.dueErr
}

func (s *stubQueries) ClearAnnouncementPin(_ context.Context, id uuid.UUID) error {
	if s.clearErr != nil {
		return s.clearErr
	}
	s.cleared = append(s.cleared, id)
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

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRunOnceDropsOneTagPerTenantAndClearsEveryPin(t *testing.T) {
	tenantA := uuid.Must(uuid.NewV7())
	tenantB := uuid.Must(uuid.NewV7())
	first := uuid.Must(uuid.NewV7())
	second := uuid.Must(uuid.NewV7())
	third := uuid.Must(uuid.NewV7())

	queries := &stubQueries{due: []dbmodels.ListPinnedAnnouncementsDueRow{
		{ID: first, TenantID: tenantA},
		{ID: second, TenantID: tenantA},
		{ID: third, TenantID: tenantB},
	}}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	if !slices.Equal(queries.cleared, []uuid.UUID{first, second, third}) {
		t.Fatalf("cleared = %v, want every due announcement", queries.cleared)
	}
	if len(reval.calls) != 2 {
		t.Fatalf("revalidate calls = %d, want one per tenant", len(reval.calls))
	}
	if !slices.Equal(reval.calls[0], RevalidateTags(tenantA)) {
		t.Fatalf("first revalidate = %v, want %v", reval.calls[0], RevalidateTags(tenantA))
	}
	if !slices.Equal(reval.calls[1], RevalidateTags(tenantB)) {
		t.Fatalf("second revalidate = %v, want %v", reval.calls[1], RevalidateTags(tenantB))
	}
}

// A pin cleared before the cache was dropped would never be retried, and the
// banner would stay above every page until the entry expired.
func TestRunOnceLeavesThePinWhenTheCacheCannotBeDropped(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListPinnedAnnouncementsDueRow{
		{ID: uuid.Must(uuid.NewV7()), TenantID: tenantID},
	}}

	New(queries, &stubRevalidator{err: errors.New("unreachable")}, quietLogger()).RunOnce(context.Background())

	if len(queries.cleared) != 0 {
		t.Fatalf("cleared = %v, want nothing while the drop is failing", queries.cleared)
	}
}

// A deployment with revalidation turned off still clears the flags instead of
// collecting them.
func TestRunOnceClearsPinsWithNoRevalidator(t *testing.T) {
	announcementID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListPinnedAnnouncementsDueRow{
		{ID: announcementID, TenantID: uuid.Must(uuid.NewV7())},
	}}

	New(queries, nil, quietLogger()).RunOnce(context.Background())

	if !slices.Equal(queries.cleared, []uuid.UUID{announcementID}) {
		t.Fatalf("cleared = %v, want the due announcement", queries.cleared)
	}
}

func TestRunOnceDropsNothingWhenNoWindowHasClosed(t *testing.T) {
	reval := &stubRevalidator{}

	New(&stubQueries{}, reval, quietLogger()).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidate calls = %v, want none", reval.calls)
	}
}
