// Package platformconfig reads the platform-wide settings kept in the
// platform_config singleton row.
package platformconfig

import (
	"context"
	"fmt"
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
// single read of the settings row.
//
// The two halves fail differently on purpose. A missing or unreadable row
// (fresh install, DB hiccup) still yields tenanttz.Default, because a
// timestamp shown in the wrong zone is off by hours and stays legible. The
// locale has no such constant: the returned error is the only answer for a row
// that cannot be read or names no supported locale, so callers report the
// failure instead of rendering in a language nobody chose. Creation paths must
// not use the locale half as a stand-in either — tenant creation takes the
// locale from its request.
func Defaults(ctx context.Context, q Querier) (timezone, defaultLocale string, err error) {
	timezone = tenanttz.Default
	config, err := q.GetPlatformConfig(ctx)
	if err != nil {
		return timezone, "", fmt.Errorf("read platform config: %w", err)
	}
	if trimmed := strings.TrimSpace(config.DefaultTimezone); trimmed != "" {
		timezone = trimmed
	}
	defaultLocale, err = locale.Resolve(config.DefaultLocale)
	if err != nil {
		return timezone, "", err
	}
	return timezone, defaultLocale, nil
}

// DefaultTimeZone returns the platform-wide default IANA time zone. The
// singleton row is the source of truth; a missing or unreadable row (fresh
// install, DB hiccup) falls back to tenanttz.Default so callers always get a
// usable zone instead of an unset state.
func DefaultTimeZone(ctx context.Context, q Querier) string {
	timezone, _, _ := Defaults(ctx, q)
	return timezone
}

// DefaultLocale returns the platform-wide default UI locale, or an error when
// the settings row cannot be read or names no supported locale.
func DefaultLocale(ctx context.Context, q Querier) (string, error) {
	_, defaultLocale, err := Defaults(ctx, q)
	return defaultLocale, err
}

// DefaultTimeZoneFunc returns a lazy accessor for DefaultTimeZone. Read paths
// use it as the fallback of tenanttz.Resolve, where the platform default is
// only consulted for a tenant row that has no usable time zone of its own: the
// settings row is then read at most once, and only when that actually happens.
func DefaultTimeZoneFunc(ctx context.Context, q Querier) func() string {
	var (
		once     sync.Once
		timezone string
	)
	return func() string {
		once.Do(func() {
			timezone = DefaultTimeZone(ctx, q)
		})
		return timezone
	}
}
