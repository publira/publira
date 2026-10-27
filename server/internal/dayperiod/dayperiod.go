// Package dayperiod reads the start_date and end_date of a request as the
// instants those days of one time zone span, which is how every RPC that takes
// a period of a tenant's days bounds what it reads.
package dayperiod

import (
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/rpcerrors"
)

var (
	errDate     = errors.New("start_date and end_date must be YYYY-MM-DD dates")
	errReversed = errors.New("start_date must not be after end_date")
)

// Period is a closed range of days in one time zone.
type Period struct {
	start time.Time
	end   time.Time
	// From is the first day's midnight and To the midnight after the last
	// day's, so an instant is in the period when From <= it < To.
	From time.Time
	To   time.Time
}

// Parse reads the two inclusive YYYY-MM-DD dates of a request as days in zone,
// refusing a period that runs backwards or covers more than maxDays days with
// invalid_argument on the field at fault.
func Parse(rawStart, rawEnd string, maxDays int, zone *time.Location) (Period, error) {
	start, err := time.Parse(time.DateOnly, rawStart)
	if err != nil {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errDate, "start_date")
	}
	end, err := time.Parse(time.DateOnly, rawEnd)
	if err != nil {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errDate, "end_date")
	}
	if end.Before(start) {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errReversed, "end_date")
	}
	if !end.Before(start.AddDate(0, 0, maxDays)) {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument,
			fmt.Errorf("the period must cover at most %d days", maxDays), "end_date")
	}
	return Period{
		start: start,
		end:   end,
		From:  startOfDay(start, zone),
		To:    startOfDay(end.AddDate(0, 0, 1), zone),
	}, nil
}

// startOfDay is the first instant of day in zone. Where the clocks go forward
// at midnight, that midnight does not exist and time.Date resolves it into the
// day before, so the day starts where the zone that skipped it ends.
func startOfDay(day time.Time, zone *time.Location) time.Time {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, zone)
	if start.Day() != day.Day() {
		_, start = start.ZoneBounds()
	}
	return start
}

// ID names the period as an ISO 8601 interval of its two dates.
func (p Period) ID() string {
	return p.start.Format(time.DateOnly) + "/" + p.end.Format(time.DateOnly)
}
