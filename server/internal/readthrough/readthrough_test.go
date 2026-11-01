package readthrough

import (
	"testing"
	"time"
)

func TestResolveEndsOnTheLastCompleteDay(t *testing.T) {
	now := time.Date(2026, 3, 15, 9, 30, 0, 0, time.UTC)

	period := Resolve(now, time.UTC)

	if got, want := period.End.Format(time.DateOnly), "2026-03-14"; got != want {
		t.Fatalf("period end = %s, want %s", got, want)
	}
	if got, want := period.Start.Format(time.DateOnly), "2026-02-15"; got != want {
		t.Fatalf("period start = %s, want %s", got, want)
	}
	days := int(period.End.Sub(period.Start).Hours()/24) + 1
	if days != WindowDays {
		t.Fatalf("period spans %d days, want %d", days, WindowDays)
	}
}

func TestResolveUsesTheTenantsDays(t *testing.T) {
	// One instant, two tenants: 2026-03-15T21:00Z is already the 16th in
	// Seoul and still the 15th in Los Angeles, so their last complete day is
	// not the same one — and neither is the UTC day the report used to report.
	seoul, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	losAngeles, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	now := time.Date(2026, 3, 15, 21, 0, 0, 0, time.UTC)

	tests := []struct {
		name     string
		location *time.Location
		want     string
	}{
		{name: "Seoul has entered the next day", location: seoul, want: "2026-03-15"},
		{name: "Los Angeles has not", location: losAngeles, want: "2026-03-14"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			period := Resolve(now, tt.location)
			if got := period.End.Format(time.DateOnly); got != tt.want {
				t.Fatalf("period end = %s, want %s", got, tt.want)
			}
		})
	}
}
