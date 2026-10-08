package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBAdminLoginIssuesUsableSession(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	loggedIn, err := client.Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: testutil.SeededPassword,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if loggedIn.User.PublicId != tenant.User.PublicID {
		t.Fatalf("login user = %q, want %q", loggedIn.User.PublicId, tenant.User.PublicID)
	}
	if loggedIn.User.Role != auth.RoleTenantAdmin {
		t.Fatalf("login role = %q, want %s", loggedIn.User.Role, auth.RoleTenantAdmin)
	}
	token := loggedIn.AccessToken.GetToken()
	if token == "" {
		t.Fatal("login returned an empty access token")
	}

	// The token the server just minted has to carry a session the same server
	// accepts, all the way through the RLS-scoped user lookup.
	req := &publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}
	me, err := client.GetMe(testutil.WithBearer(context.Background(), token), req)
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if me.User.PublicId != tenant.User.PublicID {
		t.Fatalf("GetMe user = %q, want %q", me.User.PublicId, tenant.User.PublicID)
	}
}

// An account publiractl creates, as publira_platform and with no invitation,
// signs in to the console straight away.
func TestDBAdminLoginAcceptsAnAccountCreatedWithoutAnInvitation(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()

	tx, err := env.PG.OpenPlatformDB(t).BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	member, err := tenantmembers.CreateAccount(ctx, tx, tenantmembers.AccountParams{
		TenantID: tenant.Tenant.ID,
		Email:    "second@tenant-a.example.com",
		Name:     "Second",
		Password: "a password nobody mailed",
		Role:     auth.RoleTenantAdmin,
	})
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	loggedIn, err := env.authClient().Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    "second@tenant-a.example.com",
		Password: "a password nobody mailed",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if loggedIn.User.PublicId != member.PublicID || loggedIn.User.Role != auth.RoleTenantAdmin {
		t.Fatalf("login user = %+v, want %s as %s", loggedIn.User, member.PublicID, auth.RoleTenantAdmin)
	}
	if count := env.countRows(t, `SELECT count(*) FROM outbox_events WHERE tenant_id = $1`, tenant.Tenant.ID); count != 0 {
		t.Fatalf("queued events = %d, want no mail", count)
	}
}

func TestDBAdminLoginRejectsWrongPassword(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.authClient().Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: "not-the-password",
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBAdminLoginRejectsUserOfAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	// Correct credentials, wrong tenant: RLS keeps the other tenant's user out of
	// reach, so the lookup finds nothing rather than signing them in.
	_, err := env.authClient().Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   first.tenantContext(),
		Email:    second.User.Email,
		Password: testutil.SeededPassword,
	})
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

	_, err := env.authClient().Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: testutil.SeededPassword,
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// A reader of the tenant is an active account with a password that works, and
// holds no tenant role. The console answers them exactly as it answers a wrong
// password, so it confirms neither the address nor the password.
func TestDBAdminLoginRejectsReaderWithoutATenantRole(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER", "reader@tenant-a.example.com", "Reader")
	client := env.authClient()
	ctx := context.Background()

	_, readerErr := client.Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    reader.Email,
		Password: testutil.SeededPassword,
	})
	_, wrongPasswordErr := client.Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    reader.Email,
		Password: "not-the-password",
	})
	if connect.CodeOf(readerErr) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(readerErr), readerErr)
	}
	if readerErr.Error() != wrongPasswordErr.Error() {
		t.Fatalf("Login error = %q, want the wrong-password answer %q", readerErr, wrongPasswordErr)
	}
}

// Roles are read on every request, so a member whose roles are taken away
// loses the console session they already hold rather than keeping it until
// the token expires.
func TestDBAdminSessionEndsWhenTheMemberRolesAreRemoved(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.seedMember(t, tenant, "TAEDITOR", "editor@tenant-a.example.com", auth.RoleTenantEditor)
	asEditor := tenant.as(editor)
	client := env.authClient()
	ctx := context.Background()

	loggedIn, err := client.Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    editor.Email,
		Password: testutil.SeededPassword,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	getMe := func() error {
		req := &publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: asEditor.tenantContext()}
		ctx, info := connect.NewClientContext(ctx)
		info.RequestHeader().Set("Authorization", "Bearer "+loggedIn.AccessToken.GetToken())
		_, err := client.GetMe(ctx, req)
		return err
	}
	if err := getMe(); err != nil {
		t.Fatalf("GetMe before removal: %v", err)
	}

	if _, err := env.tenantMemberClient().RemoveTenantMember(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.RemoveTenantMemberRequest{
		Tenant: tenant.tenantContext(), UserId: editor.ID.String(),
	}); err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}

	if err := getMe(); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe after removal code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
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

	req := &publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}
	_, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), staleToken), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateTenantConfigPersists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.authClient()

	if _, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
		Tenant:          tenant.tenantContext(),
		CopyrightText:   "© Tenant A",
		SiteDescription: "A tenant that exists only in a test",
		SiteTagline:     "Read on",
	}); err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}

	got, err := client.GetTenantConfig(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceGetTenantConfigRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantConfig: %v", err)
	}
	if got.CopyrightText != "© Tenant A" || got.SiteTagline != "Read on" {
		t.Fatalf("tenant config = %+v, want the values just written", got)
	}

	// tenant_config is RLS-protected; the row must be stamped with this tenant.
	if count := env.countRows(t,
		"SELECT count(*) FROM tenant_config WHERE tenant_id = $1 AND copyright_text = $2",
		tenant.Tenant.ID, "© Tenant A",
	); count != 1 {
		t.Fatalf("tenant_config rows = %d, want 1", count)
	}
}
