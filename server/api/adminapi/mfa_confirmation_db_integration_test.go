package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantwebauthn/webauthntest"
	"github.com/publira/publira/server/internal/testutil"
)

func codeConfirmation(code string) *publiraadminv1.MfaConfirmation {
	return &publiraadminv1.MfaConfirmation{Code: code}
}

// passkeyConfirmation is an assertion authenticator makes over a confirmation
// the signed-in account begins.
func passkeyConfirmation(t *testing.T, env *adminDBEnv, tenant adminDBTenant, authenticator *webauthntest.Authenticator) *publiraadminv1.MfaConfirmation {
	t.Helper()
	return &publiraadminv1.MfaConfirmation{PasskeyCredentialJson: authenticator.Assert(t, beginPasskeyConfirmation(t, env, tenant))}
}

// finishSecondPasskey runs a whole registration for a signed-in account and
// answers what its finish did with confirmation.
func finishSecondPasskey(t *testing.T, env *adminDBEnv, tenant adminDBTenant, confirmation *publiraadminv1.MfaConfirmation) error {
	t.Helper()

	ctx := testutil.WithBearer(context.Background(), tenant.token())
	begun, err := env.authClient().BeginPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	_, err = env.authClient().FinishPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		CredentialJson: webauthntest.New(t, passkeyConsoleOrigin).Register(t, begun.CreationOptionsJson),
		Confirmation:   confirmation,
	})
	return err
}

// Once an account holds a second factor, its session alone neither adds
// another nor removes one: each asks for proof of a factor it already holds,
// and a refused proof changes nothing while counting toward the lock.
func TestAdminFactorChangeAsksForAFactorTheAccountHolds(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, registered := registerPasskey(t, env, tenant, "")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	unchanged := func(what string) {
		t.Helper()
		if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", tenant.User.ID); got != 1 {
			t.Fatalf("passkeys after %s = %d, want the one the account held", what, got)
		}
		if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID); got != 0 {
			t.Fatalf("authenticators after %s = %d, want none", what, got)
		}
		if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", tenant.User.ID); got != mfa.RecoveryCodeCount {
			t.Fatalf("unused recovery codes after %s = %d, want the batch untouched (%d)", what, got, mfa.RecoveryCodeCount)
		}
	}

	if err := finishSecondPasskey(t, env, tenant, nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("FinishPasskeyRegistration without a confirmation = %v, want invalid_argument", err)
	}
	unchanged("a registration without a confirmation")
	if _, err := env.authClient().StartMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("StartMfaEnrollment without a confirmation = %v, want invalid_argument", err)
	}
	unchanged("an enrollment without a confirmation")
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     registered.Passkey.Id,
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeletePasskey without a confirmation = %v, want invalid_argument", err)
	}
	unchanged("a removal without a confirmation")

	both := &publiraadminv1.MfaConfirmation{
		Code:                  registered.RecoveryCodes[0],
		PasskeyCredentialJson: authenticator.Assert(t, beginPasskeyConfirmation(t, env, tenant)),
	}
	if err := finishSecondPasskey(t, env, tenant, both); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("FinishPasskeyRegistration with a code and an assertion = %v, want invalid_argument", err)
	}
	unchanged("a registration with a code and an assertion")
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_lockouts WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("lockout rows = %d, want none before a proof was refused", got)
	}

	if err := finishSecondPasskey(t, env, tenant, codeConfirmation("ABCDE-FGHIJ")); errorInfoReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("FinishPasskeyRegistration with a wrong code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}
	unchanged("a registration with a wrong code")
	authenticator.Origin = passkeyStorefrontOrigin
	_, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant:       tenant.tenantContext(),
		Id:           registered.Passkey.Id,
		Confirmation: passkeyConfirmation(t, env, tenant, authenticator),
	})
	assertPasskeyRefused(t, err, "DeletePasskey confirmed from the storefront's origin")
	unchanged("a removal with a refused assertion")
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_lockouts WHERE user_id = $1 AND failed_attempts = 2", tenant.User.ID); got != 1 {
		t.Fatal("the refused code and assertion were not both counted toward the lock")
	}
	for _, action := range []string{"admin_mfa_passkey_registered", "admin_mfa_enrolled", "admin_mfa_passkey_removed"} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = 'failure'",
			tenant.Tenant.ID, tenant.User.ID, action); got == 0 {
			t.Fatalf("no refused %s in the audit trail", action)
		}
	}
}

// Whichever factor the account holds proves it: a code from the authenticator,
// a recovery code, which the change spends, or an assertion from a passkey.
func TestAdminFactorChangeTakesEachFactorAsProof(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, codes := enrollMfa(t, env, tenant)
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	authenticator, byCode := addPasskey(t, env, tenant, "Laptop", codeConfirmation(mfaNextCode(t, secret)))
	_, byRecoveryCode := addPasskey(t, env, tenant, "Phone", codeConfirmation(codes[0]))
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", tenant.User.ID); got != mfa.RecoveryCodeCount-1 {
		t.Fatalf("unused recovery codes = %d, want the one that confirmed spent", got)
	}
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant:       tenant.tenantContext(),
		Id:           byRecoveryCode.Passkey.Id,
		Confirmation: passkeyConfirmation(t, env, tenant, authenticator),
	}); err != nil {
		t.Fatalf("DeletePasskey confirmed with a passkey: %v", err)
	}
	if len(byCode.RecoveryCodes) != 0 || len(byRecoveryCode.RecoveryCodes) != 0 {
		t.Fatal("a passkey added beside a factor issued a batch of recovery codes")
	}

	for _, entry := range []struct{ action, reason string }{
		{"admin_mfa_passkey_registered", "totp"},
		{"admin_mfa_passkey_registered", "recovery_code"},
		{"admin_mfa_passkey_removed", "passkey"},
	} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = 'success' AND reason = $4",
			tenant.Tenant.ID, tenant.User.ID, entry.action, entry.reason); got != 1 {
			t.Fatalf("%s confirmed by %s in the audit trail = %d, want 1", entry.action, entry.reason, got)
		}
	}
}

// An authenticator set up while the account held nothing to prove cannot be
// confirmed once the account has a passkey: the passkey's registration drops
// the unconfirmed secret, and the recovery codes stay the passkey's.
func TestAdminMfaEnrollmentStartedBeforeAPasskeyIsNotConfirmedAfterIt(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	started, err := env.authClient().StartMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	_, registered := registerPasskey(t, env, tenant, "")

	_, err = env.authClient().ConfirmMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaCode(t, started.Secret),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ConfirmMfaEnrollment of an authenticator started before the passkey = %v, want failed_precondition", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("authenticators = %d, want the unconfirmed one dropped", got)
	}

	challenge := verifyChallenge(t, env, tenant)
	if _, err := env.authClient().VerifyMfa(context.Background(), &publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: challenge.Token,
		Code:           registered.RecoveryCodes[0],
	}); err != nil {
		t.Fatalf("VerifyMfa with the passkey's recovery code: %v", err)
	}
}

// A start sent for an account with no factor is checked again where the
// secret is stored: a passkey whose registration committed in between is seen
// there, and the start is refused rather than left to be confirmed on the
// session alone.
func TestAdminMfaEnrollmentStartSeesAPasskeyRegisteredMeanwhile(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	// The registration, under way: it holds the account's factors and has
	// stored its passkey, not yet committed.
	registration, err := env.PG.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer registration.Rollback() //nolint:errcheck
	if err := dbmodels.New(registration).LockUserMfaFactors(context.Background(), tenant.User.ID); err != nil {
		t.Fatalf("LockUserMfaFactors: %v", err)
	}
	if _, err := registration.ExecContext(context.Background(), `
		INSERT INTO user_webauthn_credentials (
			id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, aaguid, backup_eligible, backed_up
		) VALUES (gen_random_uuid(), 'MEANWHILE001', $1, $2, 'admin_console', $3, '\x02', '\x00', '00000000-0000-0000-0000-000000000000', false, false)
	`, tenant.Tenant.ID, tenant.User.ID, passkeyConsoleRPID); err != nil {
		t.Fatalf("insert passkey: %v", err)
	}

	started := make(chan error, 1)
	go func() {
		_, err := env.authClient().StartMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{Tenant: tenant.tenantContext()})
		started <- err
	}()
	select {
	case err := <-started:
		t.Fatalf("StartMfaEnrollment = %v before the registration committed, want it to wait", err)
	case <-time.After(500 * time.Millisecond):
	}
	if err := registration.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	if err := <-started; connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("StartMfaEnrollment once a passkey was registered meanwhile = %v, want invalid_argument", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("authenticators = %d, want none stored", got)
	}
}
