package adminapi

import (
	"testing"
	"time"

	"connectrpc.com/connect"
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
