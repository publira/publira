// Package readthrough resolves the window of tenant days the read-through
// figures cover, which the console's report and a linked reader's Author page
// both count over, so the two never report different weeks.
package readthrough

import "time"

// WindowDays is how many of the tenant's days the window covers, counted back
// from the last day the daily aggregate can have finished. Four whole weeks so
// every weekday contributes equally: a window of 30 days weights two of them
// twice and makes the number move when the month does.
const WindowDays = 28

// Period is the closed range of stat dates the window covers. The dates are the
// tenant's calendar days, which is what content_daily_stats stores, so the
// range is compared against stat_date as written.
type Period struct {
	Start time.Time
	End   time.Time
}

// Resolve ends the window on the last day the tenant has finished, read in the
// tenant's own zone. Today is still accumulating, and its stats row does not
// exist until the batch runs after that tenant's midnight, so including it
// would put a partial day beside whole ones and make the rate look like it
// fell.
//
// The dates come back at midnight UTC because they name calendar days rather
// than instants: the queries bind them to a date column, and UTC keeps the day
// arithmetic on them exact.
func Resolve(now time.Time, location *time.Location) Period {
	year, month, day := now.In(location).AddDate(0, 0, -1).Date()
	end := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	return Period{
		Start: end.AddDate(0, 0, -(WindowDays - 1)),
		End:   end,
	}
}
