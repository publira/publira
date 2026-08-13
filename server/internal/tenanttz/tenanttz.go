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

// Default mirrors the tenants.timezone and platform_config.default_timezone
// column defaults in db/migrations. The platform default row is the source of
// truth for new tenants, so this constant is only the last resort for when that
// row cannot be read.
const Default = "Asia/Tokyo"

// ErrInvalid is returned when a value is not a usable IANA time zone name.
var ErrInvalid = errors.New("timezone must be a valid IANA time zone name")

// Resolve returns the tenant time zone to expose through the API. Stored values
// are NOT NULL with a non-blank CHECK, so the fallback only guards rows written
// before those constraints existed. platformDefault yields the platform-wide
// default and is called only when the stored value is unusable, which keeps the
// platform settings row off the hot read path; a nil platformDefault, or one
// that yields a blank value, falls back to Default.
func Resolve(stored string, platformDefault func() string) string {
	if trimmed := strings.TrimSpace(stored); trimmed != "" {
		return trimmed
	}
	if platformDefault != nil {
		if trimmed := strings.TrimSpace(platformDefault()); trimmed != "" {
			return trimmed
		}
	}
	return Default
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
