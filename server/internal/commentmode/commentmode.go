// Package commentmode resolves and validates how a tenant publishes the
// comments its readers write (tenant_config.comment_mode).
package commentmode

import (
	"errors"
	"slices"
	"strings"
)

// The stored values, matching the CHECK constraint on tenant_config.comment_mode.
const (
	// Disabled is what a tenant that has never chosen gets: the column's own
	// default, and the answer for a tenant with no config row at all.
	Disabled = "disabled"
	// Immediate publishes a comment as soon as it is stored.
	Immediate = "immediate"
	// ApprovalRequired holds a comment until a staff member approves it.
	ApprovalRequired = "approval_required"
)

// Supported lists every mode this build can act on, in the order a chooser
// offers them: off, then the two ways of being on.
var Supported = []string{Disabled, Immediate, ApprovalRequired}

// ErrInvalid is returned when an incoming value names no supported mode. It
// belongs to a request the caller can correct.
var ErrInvalid = errors.New("comment_mode must be a supported mode")

// ErrUnresolved is returned when a stored value names no supported mode. There
// is no stand-in: guessing would either publish text the tenant wanted reviewed
// or put a comment box on screen that every submission is refused from.
var ErrUnresolved = errors.New("stored comment_mode names no supported mode")

// Resolve returns the stored mode to act on and to expose through the API. The
// column is NOT NULL with a CHECK listing the three modes, so a value this
// rejects is a data fault: a row written around the API, or one naming a mode
// this build does not know.
func Resolve(stored string) (string, error) {
	trimmed, ok := supported(stored)
	if !ok {
		return "", ErrUnresolved
	}
	return trimmed, nil
}

// Normalize validates an incoming mode and returns the value to store. Blank
// input is rejected rather than read as "off": turning commenting off is
// Disabled, which a tenant chooses deliberately.
func Normalize(raw string) (string, error) {
	trimmed, ok := supported(raw)
	if !ok {
		return "", ErrInvalid
	}
	return trimmed, nil
}

func supported(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !slices.Contains(Supported, trimmed) {
		return "", false
	}
	return trimmed, true
}
