package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The storefront and the tenant console sign in the same account, and both ask
// for its password again on top of a session. One process hands both one login
// guard, and these cases build the two that way, over the counters kept in it
// when no Redis is named: the account has to hold one step-up allowance across
// them, or a caller holding a session of each would get one budget per surface.

type sharedStepUpEnv struct {
	env      *publicDBEnv
	consoles consoleClients
	tenant   testutil.Tenant
	staff    testutil.TenantUser
}

func newSharedStepUpEnv(t *testing.T, limit int) sharedStepUpEnv {
	t.Helper()

	login := stepUpGuardWith(platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit})
	env := newPublicDBEnvWithLoginGuard(t, login)
	consoles := startConsolesWith(t, env, login, openMailGuard())
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "TAUSER01", "admin@tenant-a.example.com", "Admin")
	return sharedStepUpEnv{env: env, consoles: consoles, tenant: tenant, staff: staff}
}

func (e sharedStepUpEnv) storefrontChangePassword(t *testing.T, password string) error {
	t.Helper()

	_, err := e.env.authClient().ChangePassword(testutil.WithBearer(context.Background(), tokenFor(t, e.tenant, e.staff)), &publirav1.ChangePasswordRequest{
		Tenant:          tenantContext(e.tenant),
		CurrentPassword: password,
		NewPassword:     "a-brand-new-password",
	})
	return err
}

func (e sharedStepUpEnv) consoleRequestEmailChange(t *testing.T, password string) error {
	t.Helper()

	token, _, err := testutil.TokenManager().Issue(e.staff.PublicID, auth.AudienceAdmin, e.tenant.ID.String(), e.staff.Role, e.staff.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("issue a console token: %v", err)
	}
	_, err = e.consoles.tenant.RequestEmailChange(testutil.WithBearer(context.Background(), token), &publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
		Tenant:          tenantContext(e.tenant),
		CurrentEmail:    e.staff.Email,
		NewEmail:        "moved@tenant-a.example.com",
		CurrentPassword: password,
	})
	return err
}

// Guesses made on the storefront leave the tenant console nothing to guess
// with: the right password is refused there without being checked.
func TestDBTheStorefrontAndTheTenantConsoleShareTheStepUpAllowance(t *testing.T) {
	t.Parallel()

	e := newSharedStepUpEnv(t, 2)

	for guess := 1; guess <= 2; guess++ {
		if err := e.storefrontChangePassword(t, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("guess %d on the storefront code = %v, want invalid_argument (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	if err := e.consoleRequestEmailChange(t, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the right password on the tenant console after the storefront's guesses code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if count := countRows(t, e.env, `SELECT count(*) FROM user_email_change_tokens WHERE user_id = $1`, e.staff.ID); count != 0 {
		t.Fatalf("email change requests = %d, want none", count)
	}
}

// The password verifying on one surface clears the count the other one spent.
func TestDBAPasswordVerifiedOnTheTenantConsoleClearsTheStorefrontsCount(t *testing.T) {
	t.Parallel()

	e := newSharedStepUpEnv(t, 2)

	if err := e.storefrontChangePassword(t, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the typo on the storefront code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if err := e.consoleRequestEmailChange(t, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the tenant console: %v", err)
	}
	for typo := 1; typo <= 2; typo++ {
		if err := e.storefrontChangePassword(t, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d on the storefront after the console verified code = %v, want invalid_argument (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}
