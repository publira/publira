// Package platformconfig reads the platform-wide settings kept in the
// platform_config singleton row.
package platformconfig

import (
	"context"
	"strings"
	"sync"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/tenanttz"
)

// Querier is the minimal DB interface required to read the settings row.
type Querier interface {
	GetPlatformConfig(ctx context.Context) (dbmodels.PlatformConfig, error)
}

// Defaults returns the platform-wide default time zone and locale from a
// single read of the settings row. A missing or unreadable row (fresh
// install, DB hiccup) falls back to tenanttz.Default and locale.Default so
// read paths always get usable values instead of an unset state. Creation
// paths must not use the locale half as a stand-in: tenant creation takes the
// locale from its request.
func Defaults(ctx context.Context, q Querier) (timezone, defaultLocale string) {
	timezone, defaultLocale = tenanttz.Default, locale.Default
	config, err := q.GetPlatformConfig(ctx)
	if err != nil {
		return timezone, defaultLocale
	}
	if trimmed := strings.TrimSpace(config.DefaultTimezone); trimmed != "" {
		timezone = trimmed
	}
	if trimmed := strings.TrimSpace(config.DefaultLocale); trimmed != "" {
		defaultLocale = trimmed
	}
	return timezone, defaultLocale
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
// row is the source of truth; a missing or unreadable row falls back to
// locale.Default so read paths always get a usable locale instead of an unset
// state.
func DefaultLocale(ctx context.Context, q Querier) string {
	_, defaultLocale := Defaults(ctx, q)
	return defaultLocale
}

// DefaultTimeZoneFunc returns a lazy accessor for DefaultTimeZone. Read paths
// use it as the fallback of tenanttz.Resolve, where the platform default is
// only consulted for a tenant row that has no usable time zone of its own: the
// settings row is then read at most once, and only when that actually happens.
func DefaultTimeZoneFunc(ctx context.Context, q Querier) func() string {
	return lazyDefault(ctx, q, DefaultTimeZone)
}

// DefaultLocaleFunc returns a lazy accessor for DefaultLocale. Read paths
// use it as the fallback of locale.Resolve, where the platform default is
// only consulted for a tenant row that has no usable locale of its own: the
// settings row is then read at most once, and only when that actually happens.
func DefaultLocaleFunc(ctx context.Context, q Querier) func() string {
	return lazyDefault(ctx, q, DefaultLocale)
}

func lazyDefault(ctx context.Context, q Querier, read func(context.Context, Querier) string) func() string {
	var (
		once  sync.Once
		value string
	)
	return func() string {
		once.Do(func() {
			value = read(ctx, q)
		})
		return value
	}
}
