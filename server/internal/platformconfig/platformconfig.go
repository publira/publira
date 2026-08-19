// Package platformconfig reads the platform-wide settings kept in the
// platform_config singleton row.
package platformconfig

import (
	"context"
	"strings"
	"sync"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/tenanttz"
)

// Querier is the minimal DB interface required to read the settings row.
type Querier interface {
	GetPlatformConfig(ctx context.Context) (dbmodels.PlatformConfig, error)
}

// defaultLocale mirrors the tenants.default_locale and
// platform_config.default_locale column defaults. It is the last resort when
// the settings row cannot be read.
const defaultLocale = "ja"

// Defaults returns the platform-wide default time zone and locale from a
// single read of the settings row. A missing or unreadable row (fresh
// install, DB hiccup) falls back to the column defaults so callers always
// get usable values instead of an unset state.
func Defaults(ctx context.Context, q Querier) (timezone, locale string) {
	timezone, locale = tenanttz.Default, defaultLocale
	config, err := q.GetPlatformConfig(ctx)
	if err != nil {
		return timezone, locale
	}
	if trimmed := strings.TrimSpace(config.DefaultTimezone); trimmed != "" {
		timezone = trimmed
	}
	if trimmed := strings.TrimSpace(config.DefaultLocale); trimmed != "" {
		locale = trimmed
	}
	return timezone, locale
}

// DefaultTimeZone returns the platform-wide default IANA time zone. The
// singleton row is the source of truth; a missing or unreadable row (fresh
// install, DB hiccup) falls back to tenanttz.Default so callers always get a
// usable zone instead of an unset state.
func DefaultTimeZone(ctx context.Context, q Querier) string {
	timezone, _ := Defaults(ctx, q)
	return timezone
}

// DefaultLocale returns the platform-wide default UI locale. The singleton
// row is the source of truth; a missing or unreadable row falls back to the
// column default so callers always get a usable locale instead of an unset
// state.
func DefaultLocale(ctx context.Context, q Querier) string {
	_, locale := Defaults(ctx, q)
	return locale
}

// DefaultTimeZoneFunc returns a lazy accessor for DefaultTimeZone. Read paths
// use it as the fallback of tenanttz.Resolve, where the platform default is
// only consulted for a tenant row that has no usable time zone of its own: the
// settings row is then read at most once, and only when that actually happens.
func DefaultTimeZoneFunc(ctx context.Context, q Querier) func() string {
	var (
		once  sync.Once
		value string
	)
	return func() string {
		once.Do(func() {
			value = DefaultTimeZone(ctx, q)
		})
		return value
	}
}
