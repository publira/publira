package royalties

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
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

func TestMonthEndsAtTheNextMidnightInItsZone(t *testing.T) {
	month := Month{TenantID: uuid.New(), Period: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC), TimeZone: "Asia/Seoul"}
	endOfJulyInSeoul := time.Date(2026, time.July, 31, 15, 0, 0, 0, time.UTC)

	// The month is refused before anything touches the database, so a nil
	// beginner is enough to reach both answers.
	if _, err := CloseStatement(context.Background(), nil, month, uuid.NullUUID{}, endOfJulyInSeoul.Add(-time.Second), nil); !errors.Is(err, ErrNotOver) {
		t.Fatalf("close a second before the Seoul month ends error = %v, want ErrNotOver", err)
	}
	if _, err := PreviewStatement(context.Background(), nil, month, time.Date(2026, time.June, 30, 14, 59, 59, 0, time.UTC)); !errors.Is(err, ErrNotStarted) {
		t.Fatalf("preview a second before the Seoul month starts error = %v, want ErrNotStarted", err)
	}
}
