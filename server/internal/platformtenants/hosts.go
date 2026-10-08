package platformtenants

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
)

// consoleHost is the host a tenant's console is served on: its admin domain,
// or admin.{domain} when it stores none.
func consoleHost(domain string, adminDomain sql.NullString) string {
	if adminDomain.Valid {
		return adminDomain.String
	}
	return "admin." + domain
}

// lockHosts takes, until tx ends, the lock that serializes every write
// deciding which tenant a host name belongs to, so the answer [checkHosts]
// gives still holds when the write that follows it commits. Take it before
// reading anything the check is computed from.
func lockHosts(ctx context.Context, q *dbmodels.Queries) error {
	if err := q.LockTenantHosts(ctx); err != nil {
		return fmt.Errorf("lock tenant hosts: %w", err)
	}
	return nil
}

// checkHosts refuses the domain and admin domain the tenant id is about to be
// written with when another tenant already serves either one, as its domain or
// as its console host. The proxy sends a host name to one app, so a name two
// tenants claim reaches one of them and never the other. The caller holds
// [lockHosts].
//
// A console host equal to the tenant's own domain is refused too, for the
// same reason. Every collision is a [*fielderr.Conflict] on the field whose
// value is taken; a console host that is only implied is reported on
// [FieldAdminDomain] all the same, because giving the tenant an admin domain
// of its own is what resolves it.
func checkHosts(ctx context.Context, q *dbmodels.Queries, id uuid.UUID, domain string, adminDomain sql.NullString) error {
	console := consoleHost(domain, adminDomain)
	if console == domain {
		return &fielderr.Conflict{Field: FieldAdminDomain}
	}
	taken, err := q.GetTenantHostsTaken(ctx, dbmodels.GetTenantHostsTakenParams{
		ID:          id,
		Domain:      domain,
		ConsoleHost: console,
	})
	if err != nil {
		return fmt.Errorf("read tenant hosts: %w", err)
	}
	switch {
	case taken.DomainTaken:
		return &fielderr.Conflict{Field: FieldDomain}
	case taken.ConsoleHostTaken:
		return &fielderr.Conflict{Field: FieldAdminDomain}
	default:
		return nil
	}
}
