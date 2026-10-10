package royalties

import (
	"errors"
	"testing"
	"time"
)

func TestParsePeriodAcceptsOnlyYearAndMonth(t *testing.T) {
	period, err := ParsePeriod("2026-07")
	if err != nil {
		t.Fatalf("ParsePeriod(2026-07): %v", err)
	}
	if want := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC); !period.Equal(want) {
		t.Fatalf("ParsePeriod(2026-07) = %s, want %s", period, want)
	}
	if got := FormatPeriod(period); got != "2026-07" {
		t.Fatalf("FormatPeriod = %q, want 2026-07", got)
	}

	for _, raw := range []string{"", "2026-7", "2026-07-01", "2026/07", "2026-13"} {
		if _, err := ParsePeriod(raw); !errors.Is(err, ErrInvalidPeriod) {
			t.Fatalf("ParsePeriod(%q) error = %v, want ErrInvalidPeriod", raw, err)
		}
	}
}
