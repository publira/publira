package tenantday

import (
	"testing"
	"time"
)

func TestDatePinned(t *testing.T) {
	// 2026-08-28 in Los Angeles and in Tokyo are the same calendar day to
	// rebuild, even though the instants they cover do not overlap.
	pinned := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)

	for _, zone := range []string{"Asia/Tokyo", "America/Los_Angeles", "UTC"} {
		got, err := Tenant{TimeZone: zone}.Date(pinned, now)
		if err != nil {
			t.Fatalf("Date(%s): %v", zone, err)
		}
		if want := "2026-08-28"; got.Format(time.DateOnly) != want {
			t.Fatalf("Date(%s) = %s, want %s", zone, got.Format(time.DateOnly), want)
		}
	}
}

func TestDateDefaultsToTheTenantsYesterday(t *testing.T) {
	// 2026-09-05T14:30Z is already the 5th in Tokyo and still the 5th in Los
	// Angeles, so both tenants' yesterday is the 4th. Two hours earlier the
	// zones disagree: Tokyo has entered the 5th while Los Angeles is on the
	// 4th, which is what makes one run cover two different days.
	tests := []struct {
		name string
		now  time.Time
		zone string
		want string
	}{
		{name: "Tokyo after the shared day boundary", now: time.Date(2026, time.September, 5, 14, 30, 0, 0, time.UTC), zone: "Asia/Tokyo", want: "2026-09-04"},
		{name: "Los Angeles after the shared day boundary", now: time.Date(2026, time.September, 5, 14, 30, 0, 0, time.UTC), zone: "America/Los_Angeles", want: "2026-09-04"},
		{name: "Tokyo has already turned the day", now: time.Date(2026, time.September, 4, 16, 0, 0, 0, time.UTC), zone: "Asia/Tokyo", want: "2026-09-04"},
		{name: "Los Angeles has not", now: time.Date(2026, time.September, 4, 16, 0, 0, 0, time.UTC), zone: "America/Los_Angeles", want: "2026-09-03"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Tenant{TimeZone: tt.zone}.Date(time.Time{}, tt.now)
			if err != nil {
				t.Fatalf("Date: %v", err)
			}
			if got.Format(time.DateOnly) != tt.want {
				t.Fatalf("Date = %s, want %s", got.Format(time.DateOnly), tt.want)
			}
		})
	}
}

func TestDateRejectsAnUnloadableZone(t *testing.T) {
	if _, err := (Tenant{TimeZone: "Mars/Olympus_Mons"}).Date(time.Time{}, time.Now()); err == nil {
		t.Fatal("Date error = nil, want a failure naming the zone")
	}
}
