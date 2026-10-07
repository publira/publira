package seriespublications

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

type stubQueries struct {
	due     []dbmodels.ListSeriesPublicationsDueRow
	dueErr  error
	marked  []uuid.UUID
	markErr error
}

func (s *stubQueries) ListSeriesPublicationsDue(context.Context) ([]dbmodels.ListSeriesPublicationsDueRow, error) {
	return s.due, s.dueErr
}

func (s *stubQueries) MarkSeriesPublicationRevalidated(_ context.Context, id uuid.UUID) error {
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
}

func (s *stubRevalidator) RevalidateTags(_ context.Context, tenantID uuid.UUID, tags []string) error {
	s.calls = append(s.calls, tags)
	s.tenants = append(s.tenants, tenantID)
	return s.err
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

	New(queries, reval, quietLogger()).RunOnce(context.Background())

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

// A publication marked while its caches are still standing would never be
// retried, so a failed revalidation leaves the tenant's rows as it found them.
func TestRunOnceLeavesSeriesUnmarkedWhenRevalidationFails(t *testing.T) {
	queries := &stubQueries{due: []dbmodels.ListSeriesPublicationsDueRow{
		{ID: uuid.Must(uuid.NewV7()), TenantID: uuid.Must(uuid.NewV7()), PublicID: "SERIESFAIL01"},
	}}
	reval := &stubRevalidator{err: errors.New("connection reset")}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

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

	New(queries, nil, quietLogger()).RunOnce(context.Background())

	if want := []uuid.UUID{seriesID}; !slices.Equal(queries.marked, want) {
		t.Fatalf("series marked = %v, want %v", queries.marked, want)
	}
}

func TestRunOnceDoesNothingWithoutDueSeries(t *testing.T) {
	reval := &stubRevalidator{}

	New(&stubQueries{}, reval, quietLogger()).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none", len(reval.calls))
	}
}

func TestRunOnceStopsOnAListingFailure(t *testing.T) {
	reval := &stubRevalidator{}

	New(&stubQueries{dueErr: errors.New("connection refused")}, reval, quietLogger()).RunOnce(context.Background())

	if len(reval.calls) != 0 {
		t.Fatalf("revalidations = %d, want none when the listing failed", len(reval.calls))
	}
}
