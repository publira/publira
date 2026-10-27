// Package auditexport is what the tenant's audit log export and the
// platform's have in common: the period a file may cover, and the columns
// every entry is written with, so a file from either log reads the same way.
package auditexport

import (
	"time"

	"github.com/publira/publira/server/internal/dayperiod"
)

// MaxPeriodDays bounds the days one file covers: a year, a leap one included.
const MaxPeriodDays = 366

// Action is what an export is recorded as, in whichever log it read.
const Action = "audit_log_exported"

// TargetType is what an export's entry names as its target, with the
// period's ID as the target ID.
const TargetType = "audit_log"

// ParsePeriod reads the two inclusive dates of a request as days in zone,
// covering at most MaxPeriodDays.
func ParsePeriod(rawStart, rawEnd string, zone *time.Location) (dayperiod.Period, error) {
	return dayperiod.Parse(rawStart, rawEnd, MaxPeriodDays, zone)
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
