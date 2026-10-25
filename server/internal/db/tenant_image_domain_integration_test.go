package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// Image delivery looks an image host up on the storefront's pool, so the
// storefront's login has to read it, and the lookup has to keep the order of
// the candidate hosts the way the domain lookups do.
func TestGetTenantByImageDomainsAnswersThePublicRoleInCandidateOrder(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	first := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTBBBBBB", "tenant-b.example.com", "Tenant B")
	for id, host := range map[any]string{first.ID: "images.tenant-a.example.com", second.ID: "images.tenant-b.example.com"} {
		if _, err := pg.DB.ExecContext(ctx, `UPDATE tenants SET image_domain = $2 WHERE id = $1`, id, host); err != nil {
			t.Fatalf("set image_domain: %v", err)
		}
	}

	q := dbmodels.New(pg.OpenPublicDB(t))
	tenant, err := q.GetTenantByImageDomains(ctx, []string{"unknown.example.com", "images.tenant-b.example.com", "images.tenant-a.example.com"})
	if err != nil {
		t.Fatalf("GetTenantByImageDomains as publira_public: %v", err)
	}
	if tenant.ID != second.ID {
		t.Fatalf("tenant = %s, want the first candidate that matches (%s)", tenant.PublicID, second.PublicID)
	}

	// A tenant's domain is not its image host.
	if _, err := q.GetTenantByImageDomains(ctx, []string{"tenant-a.example.com"}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("lookup of a domain: err = %v, want sql.ErrNoRows", err)
	}
}

// Two tenants cannot hold the same image host, the way they cannot hold the
// same admin domain, while any number of them may hold none.
func TestTenantImageDomainIsUniqueWhereSet(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	first := pg.SeedTenant(t, "TENANTAAAAAA", "tenant-a.example.com", "Tenant A")
	second := pg.SeedTenant(t, "TENANTBBBBBB", "tenant-b.example.com", "Tenant B")
	if _, err := pg.DB.ExecContext(ctx, `UPDATE tenants SET image_domain = 'images.example.com' WHERE id = $1`, first.ID); err != nil {
		t.Fatalf("set image_domain: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `UPDATE tenants SET image_domain = 'images.example.com' WHERE id = $1`, second.ID); err == nil {
		t.Fatal("a second tenant took the same image_domain")
	}
}
