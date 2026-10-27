package auditexport

import (
	"testing"
	"time"

	"connectrpc.com/connect/v2"
)

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
