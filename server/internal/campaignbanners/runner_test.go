package campaignbanners

import (
	"context"
	"database/sql"
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
	due       []dbmodels.ListCampaignBannerBoundariesDueRow
	dueErr    error
	startMark []uuid.UUID
	endMark   []uuid.UUID
	markErr   error
}

func (s *stubQueries) ListCampaignBannerBoundariesDue(context.Context) ([]dbmodels.ListCampaignBannerBoundariesDueRow, error) {
	return s.due, s.dueErr
}

func (s *stubQueries) MarkCampaignBannerStartRevalidated(_ context.Context, id uuid.UUID) error {
	if s.markErr != nil {
		return s.markErr
	}
	s.startMark = append(s.startMark, id)
	return nil
}

func (s *stubQueries) MarkCampaignBannerEndRevalidated(_ context.Context, id uuid.UUID) error {
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

	queries := &stubQueries{due: []dbmodels.ListCampaignBannerBoundariesDueRow{
		{ID: opened, TenantID: tenantA, StartDue: yes(), EndDue: no()},
		{ID: closed, TenantID: tenantA, StartDue: no(), EndDue: yes()},
		{ID: both, TenantID: tenantB, StartDue: yes(), EndDue: yes()},
	}}
	reval := &stubRevalidator{}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	// The band is cached under one tag per tenant, so the two boundaries of
	// tenant A are answered by one request.
	wantTenants := []uuid.UUID{tenantA, tenantB}
	if !slices.Equal(reval.tenants, wantTenants) {
		t.Fatalf("revalidated tenants = %v, want one request each for %v", reval.tenants, wantTenants)
	}
	for index, tenantID := range wantTenants {
		want := []string{fmt.Sprintf("tenant:%s:campaign-banners", tenantID)}
		if !slices.Equal(reval.calls[index], want) {
			t.Errorf("revalidated %v for tenant %s, want %v", reval.calls[index], tenantID, want)
		}
	}

	if want := []uuid.UUID{opened, both}; !slices.Equal(queries.startMark, want) {
		t.Errorf("start boundaries marked = %v, want %v", queries.startMark, want)
	}
	if want := []uuid.UUID{closed, both}; !slices.Equal(queries.endMark, want) {
		t.Errorf("end boundaries marked = %v, want %v", queries.endMark, want)
	}
}

// A boundary marked while the band is still cached would never be retried, so
// a failed revalidation leaves the tenant's rows exactly as it found them.
func TestRunOnceLeavesBoundariesUnmarkedWhenRevalidationFails(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListCampaignBannerBoundariesDueRow{
		{ID: uuid.Must(uuid.NewV7()), TenantID: tenantID, StartDue: yes(), EndDue: no()},
		{ID: uuid.Must(uuid.NewV7()), TenantID: tenantID, StartDue: no(), EndDue: yes()},
	}}
	reval := &stubRevalidator{err: errors.New("the outbox insert failed")}

	New(queries, reval, quietLogger()).RunOnce(context.Background())

	if len(queries.startMark) != 0 || len(queries.endMark) != 0 {
		t.Fatalf("marked %v / %v after a failed revalidation, want none", queries.startMark, queries.endMark)
	}
}

// Revalidation can be turned off entirely. There is then nothing to drop, and a
// pass that kept collecting the boundaries it crossed would grow without end.
func TestRunOnceMarksBoundariesWithoutARevalidator(t *testing.T) {
	bannerID := uuid.Must(uuid.NewV7())
	queries := &stubQueries{due: []dbmodels.ListCampaignBannerBoundariesDueRow{
		{ID: bannerID, TenantID: uuid.Must(uuid.NewV7()), StartDue: yes(), EndDue: no()},
	}}

	New(queries, nil, quietLogger()).RunOnce(context.Background())

	if want := []uuid.UUID{bannerID}; !slices.Equal(queries.startMark, want) {
		t.Fatalf("start boundaries marked = %v, want %v", queries.startMark, want)
	}
}

func TestRunOnceDoesNothingWithoutDueBoundaries(t *testing.T) {
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
