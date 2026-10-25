package adminapi

import (
	"errors"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/rpcerrors"
)

// maxStatsPeriodDays bounds the period a statistics report may cover: a year,
// a leap one included. It is what keeps a day report one response, and what
// bounds the range of rows any of the reports aggregates.
const maxStatsPeriodDays = 366

var (
	errStatsPeriodDate     = errors.New("start_date and end_date must be YYYY-MM-DD dates")
	errStatsPeriodReversed = errors.New("start_date must not be after end_date")
	errStatsPeriodTooLong  = errors.New("the period must cover at most 366 days")
)

// statsPeriod is the closed range of tenant days a report covers. The dates
// come back at midnight UTC because they name calendar days rather than
// instants; the queries turn them into the tenant's midnights themselves.
type statsPeriod struct {
	start time.Time
	end   time.Time
}

func parseStatsPeriod(rawStart, rawEnd string) (statsPeriod, error) {
	start, err := time.Parse(time.DateOnly, rawStart)
	if err != nil {
		return statsPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsPeriodDate, "start_date")
	}
	end, err := time.Parse(time.DateOnly, rawEnd)
	if err != nil {
		return statsPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsPeriodDate, "end_date")
	}
	if end.Before(start) {
		return statsPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsPeriodReversed, "end_date")
	}
	if !end.Before(start.AddDate(0, 0, maxStatsPeriodDays)) {
		return statsPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errStatsPeriodTooLong, "end_date")
	}
	return statsPeriod{start: start, end: end}, nil
}
