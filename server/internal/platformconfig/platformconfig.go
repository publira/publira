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

// DefaultTimeZone returns the platform-wide default IANA time zone. The
// singleton row is the source of truth; a missing or unreadable row (fresh
// install, DB hiccup) falls back to tenanttz.Default so callers always get a
// usable zone instead of an unset state.
func DefaultTimeZone(ctx context.Context, q Querier) string {
	config, err := q.GetPlatformConfig(ctx)
	if err != nil {
		return tenanttz.Default
	}
	if trimmed := strings.TrimSpace(config.DefaultTimezone); trimmed != "" {
		return trimmed
	}
	return tenanttz.Default
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
