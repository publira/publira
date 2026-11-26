package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// reauthenticate answers the step-up token the session sessionToken names
// earns with req's proof.
func reauthenticate(t *testing.T, env *adminDBEnv, tenant adminDBTenant, sessionToken string, req *publiraadminv1.AdminAuthServiceReauthenticateRequest) (string, error) {
	t.Helper()
	req.Tenant = tenant.tenantContext()
	resp, err := env.authClient().Reauthenticate(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		return "", err
	}
	if resp.GetStepUpToken().GetToken() == "" || resp.GetStepUpToken().GetExpiresAt() == "" {
		t.Fatalf("Reauthenticate = %+v, want a token and its expiry", resp)
	}
	return resp.GetStepUpToken().GetToken(), nil
}

// createAPIKeySteppedUp is CreateApiKey, one of the RPCs that ask for a
// step-up, on sessionToken with stepUp in the step-up header when it is set.
func createAPIKeySteppedUp(env *adminDBEnv, tenant adminDBTenant, sessionToken, stepUp string) error {
	ctx := testutil.WithBearer(context.Background(), sessionToken)
	if stepUp != "" {
		ctx = testutil.WithRequestHeader(ctx, StepUpHeader, stepUp)
	}
	_, err := env.apiKeyClient().CreateApiKey(ctx, &publiraadminv1.CreateApiKeyRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Data warehouse",
		Scopes: []publiraadminv1.ApiKeyScope{publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ},
	})
	return err
}

func assertReauthenticationRequired(t *testing.T, err error, what string) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodePermissionDenied || errorInfoReason(t, err) != rpcerrors.ReasonReauthenticationRequired {
		t.Fatalf("%s = %v, want permission_denied with %s", what, err, rpcerrors.ReasonReauthenticationRequired)
	}
}

// The password earns a step-up token that admits the operations asking for one
// beside the session it was earned on, and beside no other session of the
// same account, nor once that session has signed out.
func TestDBReauthenticateWithThePasswordAdmitsItsOwnSession(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	session, otherSession := tenant.token(), tenant.token()

	_, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Reauthenticate with a wrong password = %v, want invalid_argument", err)
	}
	stepUp, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{Password: testutil.SeededPassword})
	if err != nil {
		t.Fatalf("Reauthenticate with the password: %v", err)
	}

	if err := createAPIKeySteppedUp(env, tenant, session, stepUp); err != nil {
		t.Fatalf("CreateApiKey beside the session the step-up was earned on: %v", err)
	}
	assertReauthenticationRequired(t, createAPIKeySteppedUp(env, tenant, otherSession, stepUp), "CreateApiKey beside another session of the account")
	assertReauthenticationRequired(t, createAPIKeySteppedUp(env, tenant, session, otherSession), "CreateApiKey with a session token as the step-up")
	assertReauthenticationRequired(t, createAPIKeySteppedUp(env, tenant, session, "not-a-token"), "CreateApiKey with a malformed step-up")

	if _, err := env.authClient().Logout(testutil.WithBearer(context.Background(), session), &publiraadminv1.AdminAuthServiceLogoutRequest{Tenant: tenant.tenantContext()}); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if err := createAPIKeySteppedUp(env, tenant, session, stepUp); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("CreateApiKey on a signed-out session with its step-up = %v, want unauthenticated", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_api_keys WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("API keys = %d, want only the one the admitted request created", got)
	}

	for outcome, reason := range map[string]string{"failure": "invalid_password", "success": "password"} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = $4 AND reason = $5",
			tenant.Tenant.ID, tenant.User.ID, auditActionReauthenticated, outcome, reason); got != 1 {
			t.Fatalf("%s re-authentications by %s in the audit trail = %d, want 1", outcome, reason, got)
		}
	}
}

// An account that holds a second factor re-authenticates with it as well, and
// one that holds none has no factor to answer with.
func TestDBReauthenticateTakesASecondFactor(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	session := tenant.token()

	_, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{Confirmation: codeConfirmation("123456")})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Reauthenticate with a code for an account without a factor = %v, want failed_precondition", err)
	}

	secret, _ := enrollMfa(t, env, tenant)
	if _, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{
		Password:     testutil.SeededPassword,
		Confirmation: codeConfirmation(mfaNextCode(t, secret)),
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Reauthenticate with a password and a code = %v, want invalid_argument", err)
	}
	if _, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Reauthenticate with no proof = %v, want invalid_argument", err)
	}
	if _, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{Confirmation: codeConfirmation("000000")}); errorInfoReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("Reauthenticate with a wrong code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}

	stepUp, err := reauthenticate(t, env, tenant, session, &publiraadminv1.AdminAuthServiceReauthenticateRequest{Confirmation: codeConfirmation(mfaNextCode(t, secret))})
	if err != nil {
		t.Fatalf("Reauthenticate with a code: %v", err)
	}
	if err := createAPIKeySteppedUp(env, tenant, session, stepUp); err != nil {
		t.Fatalf("CreateApiKey beside a step-up earned with a code: %v", err)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = 'success' AND reason = 'totp'",
		tenant.Tenant.ID, tenant.User.ID, auditActionReauthenticated); got != 1 {
		t.Fatalf("re-authentications by code in the audit trail = %d, want 1", got)
	}
}

// A password tried here spends the allowance every step-up password check
// spends, so re-authenticating buys a guesser no attempts of its own.
func TestDBReauthenticateSharesTheStepUpPasswordAllowance(t *testing.T) {
	t.Parallel()

	env := newStepUpLimitedEnv(t, 1)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	if _, err := reauthenticate(t, env, tenant, tenant.token(), &publiraadminv1.AdminAuthServiceReauthenticateRequest{Password: "not-the-password"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Reauthenticate with a wrong password = %v, want invalid_argument", err)
	}
	if err := tryEmailChange(t, env, tenant, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RequestEmailChange with the right password past the shared limit = %v, want resource_exhausted", err)
	}
	if _, err := reauthenticate(t, env, tenant, tenant.token(), &publiraadminv1.AdminAuthServiceReauthenticateRequest{Password: testutil.SeededPassword}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("Reauthenticate with the right password past the limit = %v, want resource_exhausted", err)
	}
}

// A role the operation does not admit is refused for its role, not asked to
// re-authenticate for an operation it could not make anyway.
func TestDBStepUpLeavesAWeakerRoleToTheHandler(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor))

	err := createAPIKeySteppedUp(env, editor, editor.token(), "not-a-token")
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateApiKey as an editor = %v, want permission_denied", err)
	}
	if reason := errorInfoReason(t, err); reason == rpcerrors.ReasonReauthenticationRequired {
		t.Fatalf("CreateApiKey as an editor asked for a re-authentication, want the role's refusal")
	}
}
