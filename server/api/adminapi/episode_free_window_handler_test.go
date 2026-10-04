package adminapi

import (
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestParseFreeWindowPeriod(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		startsAt  string
		endsAt    string
		wantStart time.Time
		wantEnd   time.Time
		wantCode  connect.Code
	}{
		{
			name:      "a period is kept as the instants it names",
			startsAt:  "2026-09-08T13:00:00Z",
			endsAt:    "2026-09-09T13:00:00Z",
			wantStart: time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 9, 13, 0, 0, 0, time.UTC),
		},
		{
			name:      "an offset is read as the instant it names",
			startsAt:  "2026-09-08T22:00:00+09:00",
			endsAt:    "2026-09-09T00:00:00+09:00",
			wantStart: time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 8, 15, 0, 0, 0, time.UTC),
		},
		{
			// The response carries whole seconds, and a client schedules the
			// next window at the ends_at it was given. A stored fraction the
			// response cannot show would make that window overlap.
			name:      "a fractional second is dropped, as the response is",
			startsAt:  "2026-09-08T13:00:00.750Z",
			endsAt:    "2026-09-09T13:00:00.250Z",
			wantStart: time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 9, 13, 0, 0, 0, time.UTC),
		},
		{
			// An editor makes an episode free right now by starting in the past.
			name:      "a start already passed is allowed",
			startsAt:  "2026-09-08T11:00:00Z",
			endsAt:    "2026-09-08T13:00:00Z",
			wantStart: time.Date(2026, 9, 8, 11, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC),
		},
		{
			name:     "a period that ends before it starts",
			startsAt: "2026-09-08T13:00:00Z",
			endsAt:   "2026-09-08T12:30:00Z",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			// Half a second is a whole period once both ends are truncated.
			name:     "a period shorter than the second it is reported in",
			startsAt: "2026-09-08T13:00:00.100Z",
			endsAt:   "2026-09-08T13:00:00.600Z",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "a period that is already over",
			startsAt: "2026-09-08T10:00:00Z",
			endsAt:   "2026-09-08T11:00:00Z",
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name:     "a start that is not a timestamp",
			startsAt: "tomorrow",
			endsAt:   "2026-09-08T13:00:00Z",
			wantCode: connect.CodeInvalidArgument,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			period, err := parseFreeWindowPeriod(tc.startsAt, tc.endsAt, now)
			if tc.wantCode != 0 {
				if connect.CodeOf(err) != tc.wantCode {
					t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), tc.wantCode, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseFreeWindowPeriod: %v", err)
			}
			if !period.startsAt.Equal(tc.wantStart) || !period.endsAt.Equal(tc.wantEnd) {
				t.Fatalf("period = %s..%s, want %s..%s", period.startsAt, period.endsAt, tc.wantStart, tc.wantEnd)
			}
		})
	}
}

func TestFreeWindowPeriodOpenAt(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	period := freeWindowPeriod{
		startsAt: time.Date(2026, 9, 8, 11, 0, 0, 0, time.UTC),
		endsAt:   time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC),
	}

	if !period.openAt(now) {
		t.Error("a period covering now does not read as open")
	}
	if !period.openAt(period.startsAt) {
		t.Error("a period does not read as open at the instant it starts")
	}
	// Half-open: the end instant is already outside, which is what lets the
	// next window start there.
	if period.openAt(period.endsAt) {
		t.Error("a period reads as open at the instant it ends")
	}
	if period.openAt(period.startsAt.Add(-time.Second)) {
		t.Error("a period reads as open before it starts")
	}
}

func TestSeriesFreeWindowEpisodes(t *testing.T) {
	first := uuid.MustParse("01900000-0000-7000-8000-000000000001")
	second := uuid.MustParse("01900000-0000-7000-8000-000000000002")

	t.Run("no episodes named is every episode", func(t *testing.T) {
		ids, err := seriesFreeWindowEpisodes(nil)
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if ids != nil {
			t.Fatalf("ids = %v, want nil", ids)
		}
	})

	t.Run("the named episodes are read in the order given", func(t *testing.T) {
		ids, err := seriesFreeWindowEpisodes([]string{second.String(), first.String()})
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if !slices.Equal(ids, []uuid.UUID{second, first}) {
			t.Fatalf("ids = %v, want [%v %v]", ids, second, first)
		}
	})

	t.Run("an episode named twice is refused", func(t *testing.T) {
		_, err := seriesFreeWindowEpisodes([]string{first.String(), first.String()})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	t.Run("more episodes than one call may name is refused", func(t *testing.T) {
		raw := make([]string, 0, maxSeriesFreeWindowEpisodes+1)
		for range maxSeriesFreeWindowEpisodes + 1 {
			raw = append(raw, uuid.Must(uuid.NewV7()).String())
		}
		_, err := seriesFreeWindowEpisodes(raw)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})
}

func TestSelectSeriesFreeWindowEpisodes(t *testing.T) {
	episodes := []dbmodels.ListEpisodesBySeriesForTenantRow{
		{ID: uuid.MustParse("01900000-0000-7000-8000-000000000001"), Title: "Chapter One"},
		{ID: uuid.MustParse("01900000-0000-7000-8000-000000000002"), Title: "Chapter Two"},
		{ID: uuid.MustParse("01900000-0000-7000-8000-000000000003"), Title: "Chapter Three"},
	}
	titles := func(rows []dbmodels.ListEpisodesBySeriesForTenantRow) []string {
		out := make([]string, 0, len(rows))
		for _, row := range rows {
			out = append(out, row.Title)
		}
		return out
	}

	t.Run("nothing named keeps every episode", func(t *testing.T) {
		selected, err := selectSeriesFreeWindowEpisodes(episodes, nil)
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if len(selected) != len(episodes) {
			t.Fatalf("selected %d episodes, want %d", len(selected), len(episodes))
		}
	})

	t.Run("the named episodes come back in the series' order", func(t *testing.T) {
		selected, err := selectSeriesFreeWindowEpisodes(episodes, []uuid.UUID{episodes[2].ID, episodes[0].ID})
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if got, want := titles(selected), []string{"Chapter One", "Chapter Three"}; !slices.Equal(got, want) {
			t.Fatalf("selected = %v, want %v", got, want)
		}
	})

	t.Run("an episode the series does not have fails the call", func(t *testing.T) {
		_, err := selectSeriesFreeWindowEpisodes(episodes, []uuid.UUID{episodes[0].ID, uuid.Must(uuid.NewV7())})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})
}
