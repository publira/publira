package auditexport

import (
	"testing"
	"time"

	"connectrpc.com/connect/v2"
)

func TestParsePeriodBoundsTheDaysInTheZone(t *testing.T) {
	newYork, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("load the zone: %v", err)
	}

	// The last day is the one the clocks go forward on, which is 23 hours
	// long, so the bound is the next midnight rather than 24 hours on.
	period, err := ParsePeriod("2026-03-01", "2026-03-08", newYork)
	if err != nil {
		t.Fatalf("ParsePeriod: %v", err)
	}
	if want := time.Date(2026, 3, 1, 5, 0, 0, 0, time.UTC); !period.From.Equal(want) {
		t.Fatalf("From = %s, want %s", period.From.UTC(), want)
	}
	if want := time.Date(2026, 3, 9, 4, 0, 0, 0, time.UTC); !period.To.Equal(want) {
		t.Fatalf("To = %s, want %s", period.To.UTC(), want)
	}
	if got, want := period.ID(), "2026-03-01/2026-03-08"; got != want {
		t.Fatalf("ID = %q, want %q", got, want)
	}
}

func TestParsePeriodStartsADayWhoseMidnightIsSkipped(t *testing.T) {
	santiago, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Fatalf("load the zone: %v", err)
	}

	// Chile's clocks go from 00:00 to 01:00 on 2026-09-06, so that day starts
	// at 01:00 -03 and the day before ends there too.
	skipped := time.Date(2026, 9, 6, 4, 0, 0, 0, time.UTC)
	starting, err := ParsePeriod("2026-09-06", "2026-09-07", santiago)
	if err != nil {
		t.Fatalf("ParsePeriod from the skipped midnight: %v", err)
	}
	if !starting.From.Equal(skipped) {
		t.Fatalf("From = %s, want %s", starting.From.UTC(), skipped)
	}
	ending, err := ParsePeriod("2026-09-01", "2026-09-05", santiago)
	if err != nil {
		t.Fatalf("ParsePeriod up to the skipped midnight: %v", err)
	}
	if !ending.To.Equal(skipped) {
		t.Fatalf("To = %s, want %s", ending.To.UTC(), skipped)
	}
}

func TestParsePeriodRefusesWhatOneFileDoesNotCover(t *testing.T) {
	for _, accepted := range []struct{ start, end string }{
		{"2026-01-10", "2026-01-10"},
		{"2024-01-01", "2024-12-31"},
		{"2025-01-01", "2026-01-01"},
	} {
		if _, err := ParsePeriod(accepted.start, accepted.end, time.UTC); err != nil {
			t.Fatalf("ParsePeriod(%s, %s): %v", accepted.start, accepted.end, err)
		}
	}

	for _, refused := range []struct{ start, end string }{
		{"2025-01-01", "2026-01-02"},
		{"2026-01-11", "2026-01-10"},
		{"2026-01-10", ""},
		{"", "2026-01-10"},
		{"2026-01-10T00:00:00Z", "2026-01-11"},
	} {
		_, err := ParsePeriod(refused.start, refused.end, time.UTC)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ParsePeriod(%q, %q) error = %v, want invalid_argument", refused.start, refused.end, err)
		}
	}
}

func TestEntryFieldsWriteTheTimeInTheZone(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("load the zone: %v", err)
	}
	fields := Entry{
		Time:          time.Date(2026, 1, 9, 15, 0, 0, 0, time.UTC),
		ActorPublicID: "ACTOR",
		Action:        "series_created",
		Outcome:       "success",
	}.Fields(tokyo)
	if len(fields) != len(Columns) {
		t.Fatalf("fields = %d, want one per column (%d)", len(fields), len(Columns))
	}
	if got, want := fields[0], "2026-01-10T00:00:00+09:00"; got != want {
		t.Fatalf("time = %q, want %q", got, want)
	}
}
