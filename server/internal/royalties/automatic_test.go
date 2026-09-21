package royalties

import (
	"testing"
	"time"
)

func TestAutomaticCloseScheduleFollowsTheCloseDay(t *testing.T) {
	// Chosen mid-June with the 5th as the close day, so June is the first
	// month the instruction owes.
	instruction := AutomaticClose{CloseDay: 5, Since: time.Date(2026, time.June, 15, 3, 0, 0, 0, time.UTC)}

	tests := []struct {
		name         string
		now          time.Time
		wantLast     string
		wantPrevious string
		wantDue      bool
	}{
		{name: "the day before the close day", now: time.Date(2026, time.August, 4, 12, 0, 0, 0, time.UTC), wantLast: "2026-06", wantPrevious: "2026-07", wantDue: false},
		{name: "the close day", now: time.Date(2026, time.August, 5, 0, 0, 0, 0, time.UTC), wantLast: "2026-07", wantPrevious: "2026-07", wantDue: true},
		{name: "a month after the close day", now: time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC), wantLast: "2026-08", wantPrevious: "2026-08", wantDue: true},
		{name: "the last day of the month", now: time.Date(2026, time.August, 31, 23, 0, 0, 0, time.UTC), wantLast: "2026-07", wantPrevious: "2026-07", wantDue: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schedule, err := instruction.Schedule("UTC", tt.now)
			if err != nil {
				t.Fatalf("Schedule: %v", err)
			}
			if got := FormatPeriod(schedule.First); got != "2026-06" {
				t.Fatalf("First = %s, want 2026-06", got)
			}
			if got := FormatPeriod(schedule.Last); got != tt.wantLast {
				t.Fatalf("Last = %s, want %s", got, tt.wantLast)
			}
			if got := FormatPeriod(schedule.Previous); got != tt.wantPrevious {
				t.Fatalf("Previous = %s, want %s", got, tt.wantPrevious)
			}
			if got := schedule.PreviousIsDue(); got != tt.wantDue {
				t.Fatalf("PreviousIsDue = %t, want %t", got, tt.wantDue)
			}
			if !schedule.Owes() || !schedule.PreviousIsAutomatic() {
				t.Fatalf("schedule %+v owes nothing, want June onwards", schedule)
			}
		})
	}
}

// The close day is the tenant's own: 2026-08-04T15:30Z is already the 5th in
// Seoul and still the 4th in Los Angeles.
func TestAutomaticCloseScheduleIsCutInTheTenantsZone(t *testing.T) {
	instruction := AutomaticClose{CloseDay: 5, Since: time.Date(2026, time.June, 15, 0, 0, 0, 0, time.UTC)}
	now := time.Date(2026, time.August, 4, 15, 30, 0, 0, time.UTC)

	for zone, wantDue := range map[string]bool{"Asia/Seoul": true, "America/Los_Angeles": false} {
		schedule, err := instruction.Schedule(zone, now)
		if err != nil {
			t.Fatalf("Schedule(%s): %v", zone, err)
		}
		if got := schedule.PreviousIsDue(); got != wantDue {
			t.Fatalf("PreviousIsDue in %s = %t, want %t", zone, got, wantDue)
		}
		if got := schedule.PreviousDueOn.Format(time.DateOnly); got != "2026-08-05" {
			t.Fatalf("PreviousDueOn in %s = %s, want 2026-08-05", zone, got)
		}
	}
}

// A month that ended before the tenant chose automatic closing was the
// tenant's to close by hand, whichever day of the next month it chose.
func TestAutomaticCloseScheduleOwesNothingBeforeItBegan(t *testing.T) {
	seoul, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		t.Fatalf("load Asia/Seoul: %v", err)
	}
	tests := []struct {
		name          string
		since         time.Time
		wantFirst     string
		wantAutomatic bool
	}{
		// Chosen on the 2nd, after July ended: July is not the instruction's.
		{name: "chosen after the month ended", since: time.Date(2026, time.August, 2, 9, 0, 0, 0, seoul), wantFirst: "2026-08", wantAutomatic: false},
		// Chosen at the very instant July ended: July ended at, not after, it.
		{name: "chosen as the month ended", since: time.Date(2026, time.August, 1, 0, 0, 0, 0, seoul), wantFirst: "2026-08", wantAutomatic: false},
		// Chosen a second before July ended in Seoul, which is still July there.
		{name: "chosen before the month ended", since: time.Date(2026, time.July, 31, 23, 59, 59, 0, seoul), wantFirst: "2026-07", wantAutomatic: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schedule, err := AutomaticClose{CloseDay: 1, Since: tt.since}.Schedule("Asia/Seoul", time.Date(2026, time.August, 10, 0, 0, 0, 0, seoul))
			if err != nil {
				t.Fatalf("Schedule: %v", err)
			}
			if got := FormatPeriod(schedule.First); got != tt.wantFirst {
				t.Fatalf("First = %s, want %s", got, tt.wantFirst)
			}
			if got := schedule.PreviousIsAutomatic(); got != tt.wantAutomatic {
				t.Fatalf("PreviousIsAutomatic = %t, want %t", got, tt.wantAutomatic)
			}
			if got := schedule.Owes(); got != tt.wantAutomatic {
				t.Fatalf("Owes = %t, want %t", got, tt.wantAutomatic)
			}
		})
	}
}
