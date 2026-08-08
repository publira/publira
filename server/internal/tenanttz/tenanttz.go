// Package tenanttz resolves and validates the IANA time zone a tenant uses for
// wall-clock display and date/time input (tenants.timezone).
package tenanttz

import (
	"errors"
	"strings"
	"time"
	// Embed the IANA time zone database so validation does not depend on the
	// zoneinfo files of the runtime image (the API images are distroless).
	_ "time/tzdata"
)

// Default mirrors the tenants.timezone column default in db/migrations.
const Default = "Asia/Tokyo"

// ErrInvalid is returned when a value is not a usable IANA time zone name.
var ErrInvalid = errors.New("timezone must be a valid IANA time zone name")

// Resolve returns the tenant time zone to expose through the API. Stored values
// are already NOT NULL, so this only guards against blank rows written before
// the column existed.
func Resolve(stored string) string {
	trimmed := strings.TrimSpace(stored)
	if trimmed == "" {
		return Default
	}
	return trimmed
}

// Normalize validates an incoming time zone name and returns the value to store.
// Blank input is rejected instead of falling back to the default so that callers
// cannot silently reset a configured tenant time zone.
func Normalize(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", ErrInvalid
	}
	// "Local" resolves to the server process zone, which is not a portable
	// identifier for a tenant setting.
	if strings.EqualFold(trimmed, "Local") {
		return "", ErrInvalid
	}
	if _, err := time.LoadLocation(trimmed); err != nil {
		return "", ErrInvalid
	}
	return trimmed, nil
}
