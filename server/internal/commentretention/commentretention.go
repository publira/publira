// Package commentretention answers how long a comment its author withdrew is
// kept before it is deleted for good.
//
// Two places need that answer and have to agree on it: the admin console tells
// staff when a withdrawn comment stops being readable, and the purge batch is
// what makes that true. A window each of them carried separately would drift,
// and the console would promise a deadline the batch does not keep.
package commentretention

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// DefaultWithdrawnDays is the window a deployment that sets nothing gets: long
// enough that a report or a dispute raised about a comment can still be settled
// after its author took it down, and bounded so the author's deletion does
// eventually mean deletion.
const DefaultWithdrawnDays = 180

// WithdrawnDaysEnv names the deployment setting that overrides the default.
const WithdrawnDaysEnv = "PUBLIRA_COMMENT_WITHDRAWN_RETENTION_DAYS"

// WithdrawnDays reads the configured window. An unset value is the default; a
// value that is not a whole number of at least one day is an error, because a
// window of zero or less puts the deletion cutoff at or after now and takes
// every withdrawn comment with it.
func WithdrawnDays() (int, error) {
	raw := strings.TrimSpace(os.Getenv(WithdrawnDaysEnv))
	if raw == "" {
		return DefaultWithdrawnDays, nil
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer, got %q", WithdrawnDaysEnv, raw)
	}
	if days < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", WithdrawnDaysEnv, days)
	}
	return days, nil
}
