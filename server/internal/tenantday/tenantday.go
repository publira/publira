// Package tenantday resolves the calendar day a per-tenant daily aggregate
// covers. A day in this repository's engagement data is the tenant's own
// calendar day, the same day the console's date filters and rendered dates
// mean, so a batch spanning every tenant resolves the boundary once per tenant
// instead of sharing one UTC day between them.
package tenantday

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// Tenant is one tenant and the time zone its calendar days are counted in.
// TimeZone is already resolved, so it is the name to hand to PostgreSQL's
// AT TIME ZONE as well as the one to load in Go.
type Tenant struct {
	ID       uuid.UUID
	TimeZone string
}

// List reads every tenant in id order together with that time zone. A row with
// no usable zone of its own falls back to the platform default, which is read
// at most once and only when that actually happens.
//
// The connection must use a role with BYPASSRLS (or be a superuser): the
// callers are batches that span every tenant.
func List(ctx context.Context, db *sql.DB) ([]Tenant, error) {
	platformDefault := platformconfig.DefaultTimeZoneFunc(ctx, dbmodels.New(db))

	rows, err := db.QueryContext(ctx, "SELECT id, timezone FROM tenants ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close() //nolint:errcheck

	var tenants []Tenant
	for rows.Next() {
		var (
			id     uuid.UUID
			stored string
		)
		if err := rows.Scan(&id, &stored); err != nil {
			return nil, err
		}
		tenants = append(tenants, Tenant{ID: id, TimeZone: tenanttz.Resolve(stored, platformDefault)})
	}
	return tenants, rows.Err()
}

// Date is the calendar day one run covers for this tenant.
//
// A pinned date is read as the tenant's own local date, which is what keeps
// the rebuild-one-day contract: naming a date rebuilds that calendar day for
// every tenant, even though the instants behind it differ between zones. A
// zero pinned date means the tenant's own yesterday — the last day it has
// finished — so a run started once for everyone still gives a tenant west of
// the run its own last whole day rather than someone else's.
//
// The result is midnight UTC of that civil date: the aggregates key on a date
// rather than an instant, and UTC only keeps date arithmetic on it exact.
func (t Tenant) Date(pinned, now time.Time) (time.Time, error) {
	if !pinned.IsZero() {
		return civilDate(pinned), nil
	}
	location, err := time.LoadLocation(t.TimeZone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load time zone %q: %w", t.TimeZone, err)
	}
	return civilDate(now.In(location).AddDate(0, 0, -1)), nil
}

func civilDate(at time.Time) time.Time {
	year, month, day := at.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
