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

// checkHosts refuses the domain, admin domain, and image domain the tenant id
// is about to be written with when another tenant already serves any one of
// them, as its domain, as its console host, or as its image host. The proxy
// sends a host name to one app, and image delivery answers it as one tenant,
// so a name two tenants claim reaches one of them and never the other. The
// caller holds [lockHosts].
//
// A console host or an image host equal to another of the tenant's own hosts
// is refused too, for the same reason. Every collision is a
// [*fielderr.Conflict] on the field whose value is taken; a console host that
// is only implied is reported on [FieldAdminDomain] all the same, because
// giving the tenant an admin domain of its own is what resolves it.
func checkHosts(ctx context.Context, q *dbmodels.Queries, id uuid.UUID, domain string, adminDomain, imageDomain sql.NullString) error {
	console := consoleHost(domain, adminDomain)
	if console == domain {
		return &fielderr.Conflict{Field: FieldAdminDomain}
	}
	if imageDomain.Valid && (imageDomain.String == domain || imageDomain.String == console) {
		return &fielderr.Conflict{Field: FieldImageDomain}
	}
	taken, err := q.GetTenantHostsTaken(ctx, dbmodels.GetTenantHostsTakenParams{
		ID:          id,
		Domain:      domain,
		ConsoleHost: console,
		ImageHost:   imageDomain,
	})
	if err != nil {
		return fmt.Errorf("read tenant hosts: %w", err)
	}
	switch {
	case taken.DomainTaken:
		return &fielderr.Conflict{Field: FieldDomain}
	case taken.ConsoleHostTaken:
		return &fielderr.Conflict{Field: FieldAdminDomain}
	case taken.ImageHostTaken:
		return &fielderr.Conflict{Field: FieldImageDomain}
	default:
		return nil
	}
}

// hostsMoved reports whether before and after differ in any of the tenant's
// hosts, which a rename alone never does.
func hostsMoved(before, after dbmodels.Tenant) bool {
	return before.Domain != after.Domain ||
		before.AdminDomain != after.AdminDomain ||
		before.ImageDomain != after.ImageDomain
}

// hostCacheTags names the storefront entries whose answers are built from the
// tenant's hosts. The catalog reads and the campaign banners carry image URLs,
// which are absolute on the image host when the tenant has one. The site read
// carries the tenant's own images and the domain every link that leaves the
// site is written against, and moving its tag is also what makes the
// storefront look up again a host it holds for the tenant, so the previous
// domain stops answering. Every read that carries a single series' tag carries
// the list or the detail tag as well.
func hostCacheTags(tenantID uuid.UUID) []string {
	id := tenantID.String()
	return []string{
		fmt.Sprintf("tenant:%s:series:list", id),
		fmt.Sprintf("tenant:%s:series:detail", id),
		fmt.Sprintf("tenant:%s:creators", id),
		fmt.Sprintf("tenant:%s:labels", id),
		fmt.Sprintf("tenant:%s:campaign-banners", id),
		fmt.Sprintf("tenant:%s:site", id),
	}
}
