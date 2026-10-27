// Package auditexport is what the tenant's audit log export and the
// platform's have in common: the period a file may cover, and the columns
// every entry is written with, so a file from either log reads the same way.
package auditexport

import (
	"errors"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/rpcerrors"
)

// MaxPeriodDays bounds the days one file covers: a year, a leap one included.
const MaxPeriodDays = 366

// Action is what an export is recorded as, in whichever log it read.
const Action = "audit_log_exported"

// TargetType is what an export's entry names as its target, with the
// period's ID as the target ID.
const TargetType = "audit_log"

var (
	errPeriodDate     = errors.New("start_date and end_date must be YYYY-MM-DD dates")
	errPeriodReversed = errors.New("start_date must not be after end_date")
	errPeriodTooLong  = errors.New("the period must cover at most 366 days")
)

// Period is the closed range of days a file covers, in one time zone.
type Period struct {
	start time.Time
	end   time.Time
	// From is the first day's midnight and To the midnight after the last
	// day's, so an entry is in the period when From <= its time < To.
	From time.Time
	To   time.Time
}

// ParsePeriod reads the two inclusive dates of a request as days in zone,
// refusing a period that runs backwards or past MaxPeriodDays with
// invalid_argument on the field at fault.
func ParsePeriod(rawStart, rawEnd string, zone *time.Location) (Period, error) {
	start, err := time.Parse(time.DateOnly, rawStart)
	if err != nil {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPeriodDate, "start_date")
	}
	end, err := time.Parse(time.DateOnly, rawEnd)
	if err != nil {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPeriodDate, "end_date")
	}
	if end.Before(start) {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPeriodReversed, "end_date")
	}
	if !end.Before(start.AddDate(0, 0, MaxPeriodDays)) {
		return Period{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPeriodTooLong, "end_date")
	}
	return Period{
		start: start,
		end:   end,
		From:  time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, zone),
		To:    time.Date(end.Year(), end.Month(), end.Day()+1, 0, 0, 0, 0, zone),
	}, nil
}

// ID names the period in the audit log, as an ISO 8601 interval of its two
// dates.
func (p Period) ID() string {
	return p.start.Format(time.DateOnly) + "/" + p.end.Format(time.DateOnly)
}

// Columns is the header every export starts with. The platform's file adds
// columns of its own after them.
var Columns = []string{
	"time", "actor_public_id", "actor_name", "actor_role", "action",
	"outcome", "reason", "target_type", "target_id", "client_ip",
}

// Entry is one entry's values for Columns, an absent one empty.
type Entry struct {
	Time          time.Time
	ActorPublicID string
	ActorName     string
	ActorRole     string
	Action        string
	Outcome       string
	Reason        string
	TargetType    string
	TargetID      string
	ClientIP      string
}

// Fields is e's row under Columns, its time in RFC 3339 with zone's offset.
func (e Entry) Fields(zone *time.Location) []string {
	return []string{
		e.Time.In(zone).Format(time.RFC3339),
		e.ActorPublicID, e.ActorName, e.ActorRole, e.Action,
		e.Outcome, e.Reason, e.TargetType, e.TargetID, e.ClientIP,
	}
}
