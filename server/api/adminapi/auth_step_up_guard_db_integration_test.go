package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The password the console asks for again on top of a session, as a caller
// holding the session but not the password meets it.

// newStepUpLimitedEnv starts a server that lets limit passwords be tried on top
// of one account's sessions.
func newStepUpLimitedEnv(t *testing.T, limit int) *adminDBEnv {
	t.Helper()

	policy := platformpolicy.Defaults()
	policy.PasswordVerification = platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit}
	return newAdminDBEnvWithLoginGuard(t, loginguard.New(testutil.Limiter(), platformpolicy.Fixed(policy), nil))
}

func tryEmailChange(t *testing.T, env *adminDBEnv, tenant adminDBTenant, password string) error {
	t.Helper()

	_, err := env.authClient().RequestEmailChange(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
		Tenant:          tenant.tenantContext(),
		CurrentEmail:    tenant.User.Email,
		NewEmail:        "moved@tenant-a.example.com",
		CurrentPassword: password,
	})
	return err
}

// Past the limit the password is not verified at all: the right one is refused
// too, and nothing is recorded for it.
func TestDBAdminRequestEmailChangeRefusesPastThePasswordAllowance(t *testing.T) {
	t.Parallel()

	env := newStepUpLimitedEnv(t, 2)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for guess := 1; guess <= 2; guess++ {
		if err := tryEmailChange(t, env, tenant, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("guess %d code = %v, want invalid_argument (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	if err := tryEmailChange(t, env, tenant, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, `SELECT count(*) FROM user_email_change_tokens WHERE user_id = $1`, tenant.User.ID); count != 0 {
		t.Fatalf("email change requests = %d, want none", count)
	}
}

// A request refused on what the caller typed is not a guess at the password,
// and costs no allowance.
func TestDBAdminRequestEmailChangeChargesOnlyPasswordGuesses(t *testing.T) {
	t.Parallel()

	env := newStepUpLimitedEnv(t, 1)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for attempt := 1; attempt <= 3; attempt++ {
		_, err := env.authClient().RequestEmailChange(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceRequestEmailChangeRequest{
			Tenant:          tenant.tenantContext(),
			CurrentEmail:    "someone-else@tenant-a.example.com",
			NewEmail:        "moved@tenant-a.example.com",
			CurrentPassword: "not-the-password",
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("attempt %d with the wrong current address code = %v, want invalid_argument (err=%v)", attempt, connect.CodeOf(err), err)
		}
	}
	if err := tryEmailChange(t, env, tenant, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password after requests refused on the address: %v", err)
	}
}

// A member of staff who mistypes and then gets it right is not held back.
func TestDBAdminRequestEmailChangeCorrectPasswordClearsTheCount(t *testing.T) {
	t.Parallel()

	env := newStepUpLimitedEnv(t, 3)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for typo := 1; typo <= 2; typo++ {
		if err := tryEmailChange(t, env, tenant, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d code = %v, want invalid_argument (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
	if err := tryEmailChange(t, env, tenant, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the last allowance: %v", err)
	}
	for typo := 1; typo <= 3; typo++ {
		if err := tryEmailChange(t, env, tenant, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d after the right password code = %v, want invalid_argument (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}
