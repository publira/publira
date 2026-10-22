package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/lib/pq"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedCrawlerSettings stores a tenant's exclusions through the superuser
// connection, since the storefront's role may only read them.
func seedCrawlerSettings(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, userAgents, paths []string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_crawler_settings (tenant_id, excluded_user_agents, excluded_paths)
		VALUES ($1, $2, $3)
	`, tenant.ID, pq.Array(userAgents), pq.Array(paths)); err != nil {
		t.Fatalf("insert tenant_crawler_settings for %s: %v", tenant.PublicID, err)
	}
}

func getDBCrawlerSettings(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) *publirav1.GetTenantCrawlerSettingsResponse {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenantCrawlerSettings(context.Background(), &publirav1.GetTenantCrawlerSettingsRequest{
		Tenant: tenantContext(tenant),
	})
	if err != nil {
		t.Fatalf("GetTenantCrawlerSettings: %v", err)
	}
	return resp
}

func TestDBGetTenantCrawlerSettingsAnswersEachTenantItsOwnExclusions(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedCrawlerSettings(t, env, first, []string{"Googlebot-Image", "GPTBot"}, []string{"/drafts"})
	seedCrawlerSettings(t, env, second, []string{"ClaudeBot"}, []string{"/campaigns/preview"})

	got := getDBCrawlerSettings(t, env, first)
	if !slices.Equal(got.ExcludedUserAgents, []string{"GPTBot", "Googlebot-Image"}) || !slices.Equal(got.ExcludedPaths, []string{"/drafts"}) {
		t.Fatalf("tenant A = %v, want GPTBot and Googlebot-Image, and /drafts", got)
	}
	other := getDBCrawlerSettings(t, env, second)
	if !slices.Equal(other.ExcludedUserAgents, []string{"ClaudeBot"}) || !slices.Equal(other.ExcludedPaths, []string{"/campaigns/preview"}) {
		t.Fatalf("tenant B = %v, want ClaudeBot and /campaigns/preview", other)
	}
}

func TestDBGetTenantCrawlerSettingsAnswersNothingExcludedWithoutARow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if got := getDBCrawlerSettings(t, env, tenant); len(got.ExcludedUserAgents) != 0 || len(got.ExcludedPaths) != 0 {
		t.Fatalf("settings = %v, want nothing excluded", got)
	}
}

// A token the server no longer knows is never answered, since the storefront
// writes what it reads into robots.txt as it is.
func TestDBGetTenantCrawlerSettingsLeavesOutATokenNoLongerKnown(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	seedCrawlerSettings(t, env, tenant, []string{"RetiredBot", "GPTBot"}, []string{})

	if got := getDBCrawlerSettings(t, env, tenant); !slices.Equal(got.ExcludedUserAgents, []string{"GPTBot"}) {
		t.Fatalf("user agents = %q, want only GPTBot", got.ExcludedUserAgents)
	}
}

func TestDBGetTenantCrawlerSettingsRejectsAnUnknownTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.tenantAPIClient().GetTenantCrawlerSettings(context.Background(), &publirav1.GetTenantCrawlerSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: uuid.Must(uuid.NewV7()).String()},
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
