package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBAdminLoginIssuesUsableSession(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	loggedIn, err := client.Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if loggedIn.Msg.User.PublicId != tenant.User.PublicID {
		t.Fatalf("login user = %q, want %q", loggedIn.Msg.User.PublicId, tenant.User.PublicID)
	}
	if loggedIn.Msg.User.Role != auth.RoleTenantAdmin {
		t.Fatalf("login role = %q, want %s", loggedIn.Msg.User.Role, auth.RoleTenantAdmin)
	}
	token := loggedIn.Msg.AccessToken.GetToken()
	if token == "" {
		t.Fatal("login returned an empty access token")
	}

	// The token the server just minted has to carry a session the same server
	// accepts, all the way through the RLS-scoped user lookup.
	req := connect.NewRequest(&publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()})
	req.Header().Set("Authorization", "Bearer "+token)
	me, err := client.GetMe(context.Background(), req)
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if me.Msg.User.PublicId != tenant.User.PublicID {
		t.Fatalf("GetMe user = %q, want %q", me.Msg.User.PublicId, tenant.User.PublicID)
	}
}

func TestDBAdminLoginRejectsWrongPassword(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: "not-the-password",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBAdminLoginRejectsUserOfAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	// Correct credentials, wrong tenant: RLS keeps the other tenant's user out of
	// reach, so the lookup finds nothing rather than signing them in.
	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   first.tenantContext(),
		Email:    second.User.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBAdminLoginRejectsSuspendedUser(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE users SET status = 'suspended' WHERE id = $1", tenant.User.ID); err != nil {
		t.Fatalf("suspend user: %v", err)
	}

	_, err := env.authClient().Login(ctx, connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBAdminSessionRejectsStaleCredentialsVersion(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	// A token minted before a credentials change must stop working once the
	// stored version moves on (password reset, forced sign-out).
	staleToken := tenant.token()
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE users SET credentials_version = credentials_version + 1 WHERE id = $1", tenant.User.ID,
	); err != nil {
		t.Fatalf("bump credentials_version: %v", err)
	}

	req := connect.NewRequest(&publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()})
	req.Header().Set("Authorization", "Bearer "+staleToken)
	_, err := env.authClient().GetMe(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateTenantConfigPersists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	if _, err := client.UpdateTenantConfig(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
		Tenant:          tenant.tenantContext(),
		CopyrightText:   "© Tenant A",
		SiteDescription: "A tenant that exists only in a test",
		SiteTagline:     "Read on",
	})); err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}

	got, err := client.GetTenantConfig(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceGetTenantConfigRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantConfig: %v", err)
	}
	if got.Msg.CopyrightText != "© Tenant A" || got.Msg.SiteTagline != "Read on" {
		t.Fatalf("tenant config = %+v, want the values just written", got.Msg)
	}

	// tenant_config is RLS-protected; the row must be stamped with this tenant.
	if count := env.countRows(t,
		"SELECT count(*) FROM tenant_config WHERE tenant_id = $1 AND copyright_text = $2",
		tenant.Tenant.ID, "© Tenant A",
	); count != 1 {
		t.Fatalf("tenant_config rows = %d, want 1", count)
	}
}
