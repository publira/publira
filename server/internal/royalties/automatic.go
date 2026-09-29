package royalties

import (
	"fmt"
	"time"
)

// AutomaticClose is a tenant's standing instruction to close each month on a
// day of the month after it.
type AutomaticClose struct {
	// CloseDay is the day of the following month the close is due on, 1–28.
	CloseDay int
	// Since is when the tenant chose automatic closing. A month that ended at
	// or before it was the tenant's to close by hand, so it is never owed.
	Since time.Time
}

// Schedule is what an AutomaticClose owes a tenant at one instant, in periods
// as ParsePeriod returns them.
type Schedule struct {
	// First is the month the instruction began in, the first it can owe.
	First time.Time
	// Last is the latest month whose close day has come. A Last before First
	// means nothing is owed yet.
	Last time.Time
	// Previous is the month before the current one: the month a close day
	// in the current month is for.
	Previous time.Time
	// PreviousDueOn is the tenant's local date the close of Previous is due.
	PreviousDueOn time.Time
}

// Owes reports whether the schedule owes any month at all.
func (s Schedule) Owes() bool {
	return !s.Last.Before(s.First)
}

// PreviousIsDue reports whether the close day of Previous has come.
func (s Schedule) PreviousIsDue() bool {
	return !s.Last.Before(s.Previous)
}

// PreviousIsAutomatic reports whether Previous ended after the instruction
// began, and so is the instruction's to close rather than the tenant's.
func (s Schedule) PreviousIsAutomatic() bool {
	return !s.Previous.Before(s.First)
}

// Schedule resolves the instruction at now in the tenant's zone.
func (a AutomaticClose) Schedule(timeZone string, now time.Time) (Schedule, error) {
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return Schedule{}, fmt.Errorf("load time zone %q: %w", timeZone, err)
	}
	today := now.In(location)
	current := periodOf(today)
	previous := current.AddDate(0, -1, 0)
	last := previous
	if today.Day() < a.CloseDay {
		last = previous.AddDate(0, -1, 0)
	}
	return Schedule{
		First:         periodOf(a.Since.In(location)),
		Last:          last,
		Previous:      previous,
		PreviousDueOn: current.AddDate(0, 0, a.CloseDay-1),
	}, nil
}

// periodOf is the month a local time falls in, as ParsePeriod returns it.
func periodOf(local time.Time) time.Time {
	return time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, time.UTC)
}
