package dayroll

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/tenantday"
)

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

var (
	tokyo       = tenantday.Tenant{ID: uuid.MustParse("018f0e6a-0000-7000-8000-000000000001"), TimeZone: "Asia/Tokyo"}
	losAngeles  = tenantday.Tenant{ID: uuid.MustParse("018f0e6a-0000-7000-8000-000000000002"), TimeZone: "America/Los_Angeles"}
	unloadable  = tenantday.Tenant{ID: uuid.MustParse("018f0e6a-0000-7000-8000-000000000003"), TimeZone: "Mars/Olympus_Mons"}
	everyTenant = func(tenants ...tenantday.Tenant) Lister {
		return func(context.Context) ([]tenantday.Tenant, error) { return tenants, nil }
	}
)

func at(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return parsed
}

func TestRunOnceDropsEveryTenantOnItsFirstPass(t *testing.T) {
	reval := &stubRevalidator{}
	runner := New(everyTenant(tokyo, losAngeles), reval, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))

	if len(reval.calls) != 2 {
		t.Fatalf("revalidate calls = %d, want 2", len(reval.calls))
	}
	want := "tenant:" + tokyo.ID.String() + ":today"
	if got := reval.calls[0]; len(got) != 1 || got[0] != want {
		t.Fatalf("first call = %v, want [%s]", got, want)
	}
}

func TestRunOnceDropsOncePerDay(t *testing.T) {
	reval := &stubRevalidator{}
	runner := New(everyTenant(tokyo), reval, quietLogger())

	// Three passes inside one Tokyo day, then one after its midnight.
	runner.RunOnce(context.Background(), at(t, "2026-03-02T01:00:00Z"))
	runner.RunOnce(context.Background(), at(t, "2026-03-02T09:00:00Z"))
	runner.RunOnce(context.Background(), at(t, "2026-03-02T14:00:00Z"))
	if len(reval.calls) != 1 {
		t.Fatalf("revalidate calls within one day = %d, want 1", len(reval.calls))
	}

	runner.RunOnce(context.Background(), at(t, "2026-03-02T15:30:00Z"))
	if len(reval.calls) != 2 {
		t.Fatalf("revalidate calls after midnight = %d, want 2", len(reval.calls))
	}
}

// 15:00 UTC is already the next day in Tokyo and still the day before in Los
// Angeles, which is what makes one pass turn one tenant over and not the other.
func TestRunOnceFollowsEachTenantsOwnMidnight(t *testing.T) {
	reval := &stubRevalidator{}
	runner := New(everyTenant(tokyo, losAngeles), reval, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))
	reval.calls = nil

	runner.RunOnce(context.Background(), at(t, "2026-03-02T15:30:00Z"))

	if len(reval.calls) != 1 {
		t.Fatalf("revalidate calls = %d, want 1", len(reval.calls))
	}
	want := "tenant:" + tokyo.ID.String() + ":today"
	if got := reval.calls[0]; got[0] != want {
		t.Fatalf("rolled %v, want the Tokyo tenant (%s)", got, want)
	}
}

func TestRunOnceRetriesATenantWhoseDropFailed(t *testing.T) {
	reval := &stubRevalidator{err: errors.New("web-host is unreachable")}
	runner := New(everyTenant(tokyo), reval, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))
	reval.err = nil
	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:01:00Z"))

	if len(reval.calls) != 2 {
		t.Fatalf("revalidate calls = %d, want the failed drop retried", len(reval.calls))
	}
}

func TestRunOnceLeavesTheOtherTenantsWhenOneZoneWillNotLoad(t *testing.T) {
	reval := &stubRevalidator{}
	runner := New(everyTenant(unloadable, tokyo), reval, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))

	if len(reval.calls) != 1 {
		t.Fatalf("revalidate calls = %d, want only the tenant with a usable zone", len(reval.calls))
	}
}

func TestRunOnceDropsNothingWhenTheTenantsCannotBeListed(t *testing.T) {
	reval := &stubRevalidator{}
	failing := func(context.Context) ([]tenantday.Tenant, error) {
		return nil, errors.New("the database is unreachable")
	}
	runner := New(failing, reval, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))

	if len(reval.calls) != 0 {
		t.Fatalf("revalidate calls = %d, want none", len(reval.calls))
	}
}

func TestRunOnceRecordsTheDayWithNoRevalidatorConfigured(t *testing.T) {
	runner := New(everyTenant(tokyo), nil, quietLogger())

	runner.RunOnce(context.Background(), at(t, "2026-03-02T12:00:00Z"))

	if got := runner.rolled[tokyo.ID]; got != "2026-03-02" {
		t.Fatalf("recorded day = %q, want 2026-03-02", got)
	}
}
