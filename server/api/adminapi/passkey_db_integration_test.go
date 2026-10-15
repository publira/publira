package adminapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/tenantwebauthn/webauthntest"
	"github.com/publira/publira/server/internal/testutil"
)

// The passkey RPCs run against a real PostgreSQL with a software
// authenticator, so a ceremony is the whole round trip a browser would make:
// the options the server hands out, a credential signed over them, and the
// rows that are left behind.

// The two origins of the tenant seedMfaTenant creates. Its console is served
// on admin-tenant.example.com, outside the storefront's domain, so the console
// is a relying party ID of its own.
const (
	passkeyConsoleOrigin    = "https://admin-tenant.example.com"
	passkeyStorefrontOrigin = "https://tenant.example.com"
	passkeyConsoleRPID      = "admin-tenant.example.com"
)

func newPasskeyDBEnv(t *testing.T) *adminDBEnv {
	t.Helper()
	t.Setenv(tenantorigin.SchemeEnv, "")
	return newAdminDBEnv(t)
}

// registerPasskey takes a signed-in account through a whole registration on
// the console's origin and returns the authenticator now holding the
// credential, together with what the finish answered.
func registerPasskey(t *testing.T, env *adminDBEnv, tenant adminDBTenant, name string) (*webauthntest.Authenticator, *publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationResponse) {
	t.Helper()

	ctx := testutil.WithBearer(context.Background(), tenant.token())
	begun, err := env.authClient().BeginPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	authenticator := webauthntest.New(t, passkeyConsoleOrigin)
	finished, err := env.authClient().FinishPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		CredentialJson: authenticator.Register(t, begun.CreationOptionsJson),
		Name:           name,
	})
	if err != nil {
		t.Fatalf("FinishPasskeyRegistration: %v", err)
	}
	if finished.AccessToken != nil {
		t.Fatal("FinishPasskeyRegistration issued an access token to an account that was already signed in")
	}
	return authenticator, finished
}

func beginPasskeyVerification(t *testing.T, env *adminDBEnv, tenant adminDBTenant, challengeToken string) string {
	t.Helper()

	begun, err := env.authClient().BeginPasskeyVerification(context.Background(), &publiraadminv1.AdminAuthServiceBeginPasskeyVerificationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: challengeToken,
	})
	if err != nil {
		t.Fatalf("BeginPasskeyVerification: %v", err)
	}
	return begun.RequestOptionsJson
}

func finishPasskeyVerification(env *adminDBEnv, tenant adminDBTenant, challengeToken, credential string) (*publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse, error) {
	return env.authClient().FinishPasskeyVerification(context.Background(), &publiraadminv1.AdminAuthServiceFinishPasskeyVerificationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: challengeToken,
		CredentialJson: credential,
	})
}

// verifyChallenge signs in with the password and returns the verify challenge
// it stops at.
func verifyChallenge(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.AdminAuthServiceMfaChallenge {
	t.Helper()

	login := mfaLogin(t, env, tenant)
	if login.AccessToken != nil {
		t.Fatal("Login issued an access token before the second factor was settled")
	}
	if login.MfaChallenge == nil || login.MfaChallenge.Kind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY {
		t.Fatalf("mfa challenge = %v, want a VERIFY challenge", login.MfaChallenge)
	}
	return login.MfaChallenge
}

func assertPasskeyRefused(t *testing.T, err error, what string) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeUnauthenticated || errorInfoReason(t, err) != rpcerrors.ReasonMfaPasskeyRefused {
		t.Fatalf("%s = %v, want unauthenticated with %s", what, err, rpcerrors.ReasonMfaPasskeyRefused)
	}
}

// An account whose only second factor is a passkey gets no session for its
// password alone, and gets one for an assertion made on the console.
func TestAdminPasskeySettlesTheSecondFactorOfALogin(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, registered := registerPasskey(t, env, tenant, "Laptop")
	if len(registered.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d for the account's first factor", len(registered.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	if registered.Passkey.GetName() != "Laptop" || registered.Passkey.GetId() == "" || registered.Passkey.GetLastUsedAt() != "" {
		t.Fatalf("passkey = %+v, want a named, unused passkey with an id", registered.Passkey)
	}

	challenge := verifyChallenge(t, env, tenant)
	if len(challenge.Methods) != 1 || challenge.Methods[0] != publiraadminv1.MfaMethod_MFA_METHOD_PASSKEY {
		t.Fatalf("challenge methods = %v, want the passkey alone", challenge.Methods)
	}

	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	verified, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
	if err != nil {
		t.Fatalf("FinishPasskeyVerification: %v", err)
	}
	if verified.AccessToken == nil || verified.AccessToken.Token == "" {
		t.Fatal("FinishPasskeyVerification issued no access token")
	}
	if verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("remaining recovery codes = %d, want %d", verified.RemainingRecoveryCodes, mfa.RecoveryCodeCount)
	}
	if _, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), verified.AccessToken.Token), &publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}); err != nil {
		t.Fatalf("GetMe with the token FinishPasskeyVerification issued: %v", err)
	}

	if got := env.countRows(t,
		"SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1 AND sign_count = $2 AND last_used_at IS NOT NULL",
		tenant.User.ID, int64(authenticator.SignCount)); got != 1 {
		t.Fatalf("passkeys with the asserted counter and a last use = %d, want 1", got)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = 'admin_mfa_verified' AND outcome = 'success' AND reason = 'passkey'",
		tenant.Tenant.ID, tenant.User.ID); got != 1 {
		t.Fatalf("passkey verifications in the audit trail = %d, want 1", got)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = 'admin_mfa_passkey_registered' AND outcome = 'success'",
		tenant.Tenant.ID, tenant.User.ID); got != 1 {
		t.Fatalf("passkey registrations in the audit trail = %d, want 1", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("ceremonies left behind = %d, want every one spent", got)
	}
}

func TestAdminPasskeyVerificationRefusesAnAssertionFromTheStorefront(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, _ := registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	authenticator.Origin = passkeyStorefrontOrigin
	_, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
	assertPasskeyRefused(t, err, "FinishPasskeyVerification from the storefront's origin")
}

func TestAdminPasskeyVerificationRefusesAnUnknownCredential(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	stranger := webauthntest.New(t, passkeyConsoleOrigin)
	stranger.RPID = passkeyConsoleRPID
	stranger.UserHandle = []byte(tenant.User.PublicID)
	_, err := finishPasskeyVerification(env, tenant, challenge.Token, stranger.Assert(t, options))
	assertPasskeyRefused(t, err, "FinishPasskeyVerification with a credential the account never registered")
}

// A ceremony is spent by its finish, so the same assertion presented again
// finds nothing to verify against, and so does an assertion over a challenge
// the server never issued.
func TestAdminPasskeyVerificationRefusesAReusedChallenge(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, _ := registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	assertion := authenticator.Assert(t, options)
	if _, err := finishPasskeyVerification(env, tenant, challenge.Token, assertion); err != nil {
		t.Fatalf("FinishPasskeyVerification: %v", err)
	}

	again := verifyChallenge(t, env, tenant)
	_, err := finishPasskeyVerification(env, tenant, again.Token, assertion)
	assertPasskeyRefused(t, err, "FinishPasskeyVerification with an assertion already spent")

	_, err = finishPasskeyVerification(env, tenant, again.Token, authenticator.AssertChallenge(t, "bm90LWEtY2hhbGxlbmdlLXRoZS1zZXJ2ZXItaXNzdWVk"))
	assertPasskeyRefused(t, err, "FinishPasskeyVerification over a challenge the server never issued")
}

// The login challenge an assertion is exchanged under buys one session, as it
// does for a code: a second ceremony begun under the same token verifies and
// is still refused the session.
func TestAdminPasskeyVerificationRefusesAReusedLoginChallenge(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, _ := registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	if _, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options)); err != nil {
		t.Fatalf("FinishPasskeyVerification: %v", err)
	}

	options = beginPasskeyVerification(t, env, tenant, challenge.Token)
	_, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
	if connect.CodeOf(err) != connect.CodeUnauthenticated || errorInfoReason(t, err) != "" {
		t.Fatalf("FinishPasskeyVerification with a spent login challenge = %v, want an invalid session", err)
	}
}

func TestAdminPasskeyVerificationRefusesACounterThatWentBackwards(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	authenticator, _ := registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	if _, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options)); err != nil {
		t.Fatalf("FinishPasskeyVerification: %v", err)
	}

	// A clone of the authenticator taken before that sign-in reports the
	// counter the original had then.
	authenticator.SignCount -= 2
	challenge = verifyChallenge(t, env, tenant)
	options = beginPasskeyVerification(t, env, tenant, challenge.Token)
	_, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
	assertPasskeyRefused(t, err, "FinishPasskeyVerification with a counter that went backwards")
}

// A refused assertion and a refused code count toward the one lock, so a
// guesser gains nothing by alternating between the two factors.
func TestAdminPasskeyFailuresCountTowardTheLockCodesDo(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	enrollMfa(t, env, tenant)
	authenticator, _ := registerPasskey(t, env, tenant, "")

	challenge := verifyChallenge(t, env, tenant)
	if len(challenge.Methods) != 2 {
		t.Fatalf("challenge methods = %v, want the authenticator and the passkey", challenge.Methods)
	}
	authenticator.Origin = passkeyStorefrontOrigin
	for range 2 {
		options := beginPasskeyVerification(t, env, tenant, challenge.Token)
		_, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
		assertPasskeyRefused(t, err, "FinishPasskeyVerification from the storefront's origin")
	}
	for range mfa.MaxFailedAttempts - 3 {
		if _, err := env.authClient().VerifyMfa(context.Background(), &publiraadminv1.AdminAuthServiceVerifyMfaRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: challenge.Token,
			Code:           "000000",
		}); errorInfoReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
			t.Fatalf("VerifyMfa with a wrong code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
		}
	}
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	_, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options))
	if connect.CodeOf(err) != connect.CodeResourceExhausted || errorInfoReason(t, err) != rpcerrors.ReasonMfaLocked {
		t.Fatalf("the attempt that reached the limit = %v, want %s", err, rpcerrors.ReasonMfaLocked)
	}

	// Locked, the right answer from either factor is refused as well.
	authenticator.Origin = passkeyConsoleOrigin
	if _, err := env.authClient().BeginPasskeyVerification(context.Background(), &publiraadminv1.AdminAuthServiceBeginPasskeyVerificationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: challenge.Token,
	}); errorInfoReason(t, err) != rpcerrors.ReasonMfaLocked {
		t.Fatalf("BeginPasskeyVerification while locked = %v, want %s", err, rpcerrors.ReasonMfaLocked)
	}
}

// Where the platform requires the factor, a passkey answers the enrollment a
// login stopped at, and finishing it finishes the login with the recovery
// codes beside the session.
func TestAdminPasskeyRegistrationFinishesALoginStoppedAtEnrollment(t *testing.T) {
	env := newPasskeyDBEnv(t)
	requireTenantAdminMFA(t, env)
	tenant := seedMfaTenant(t, env)

	login := mfaLogin(t, env, tenant)
	if login.MfaChallenge == nil || login.MfaChallenge.Kind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		t.Fatalf("mfa challenge = %v, want an ENROLL challenge", login.MfaChallenge)
	}
	begun, err := env.authClient().BeginPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
	})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration with an enroll challenge: %v", err)
	}
	authenticator := webauthntest.New(t, passkeyConsoleOrigin)
	finished, err := env.authClient().FinishPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		CredentialJson: authenticator.Register(t, begun.CreationOptionsJson),
	})
	if err != nil {
		t.Fatalf("FinishPasskeyRegistration with an enroll challenge: %v", err)
	}
	if finished.AccessToken == nil || finished.AccessToken.Token == "" {
		t.Fatal("FinishPasskeyRegistration did not finish the login it was reached from")
	}
	if len(finished.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(finished.RecoveryCodes), mfa.RecoveryCodeCount)
	}

	// The enroll challenge bought that session and no other.
	begun, err = env.authClient().BeginPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
	})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration again: %v", err)
	}
	_, err = env.authClient().FinishPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		CredentialJson: webauthntest.New(t, passkeyConsoleOrigin).Register(t, begun.CreationOptionsJson),
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("FinishPasskeyRegistration with a spent enroll challenge = %v, want unauthenticated", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", tenant.User.ID); got != 1 {
		t.Fatalf("passkeys = %d, want only the one the challenge bought", got)
	}

	// From then on the login asks for the passkey.
	challenge := verifyChallenge(t, env, tenant)
	options := beginPasskeyVerification(t, env, tenant, challenge.Token)
	if _, err := finishPasskeyVerification(env, tenant, challenge.Token, authenticator.Assert(t, options)); err != nil {
		t.Fatalf("FinishPasskeyVerification: %v", err)
	}
}

func TestAdminPasskeyRegistrationRefusesAnotherOrigin(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)

	ctx := testutil.WithBearer(context.Background(), tenant.token())
	begun, err := env.authClient().BeginPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	_, err = env.authClient().FinishPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		CredentialJson: webauthntest.New(t, passkeyStorefrontOrigin).Register(t, begun.CreationOptionsJson),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument || errorInfoReason(t, err) != rpcerrors.ReasonMfaPasskeyRefused {
		t.Fatalf("FinishPasskeyRegistration from the storefront's origin = %v, want invalid_argument with %s", err, rpcerrors.ReasonMfaPasskeyRefused)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("passkeys = %d, want none", got)
	}
}

// The recovery codes stand in for whichever factors the account holds: a
// passkey-only account signs in with one, a second factor issues no second
// batch, and turning the authenticator off keeps the codes the passkey still
// needs.
func TestAdminPasskeyShareTheRecoveryCodesOfTheAccount(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, registered := registerPasskey(t, env, tenant, "")
	codes := registered.RecoveryCodes

	challenge := verifyChallenge(t, env, tenant)
	verified, err := env.authClient().VerifyMfa(context.Background(), &publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: challenge.Token,
		Code:           codes[0],
	})
	if err != nil {
		t.Fatalf("VerifyMfa with a recovery code on a passkey-only account: %v", err)
	}
	if !verified.RecoveryCodeUsed || verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("VerifyMfa = %+v, want a spent recovery code", verified)
	}

	_, second := registerPasskey(t, env, tenant, "Phone")
	if len(second.RecoveryCodes) != 0 {
		t.Fatalf("recovery codes on a second passkey = %d, want none while unused ones remain", len(second.RecoveryCodes))
	}

	secret, _ := enrollMfa(t, env, tenant)
	status, err := env.authClient().GetMfaStatus(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceGetMfaStatusRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if !status.Enabled || len(status.Methods) != 2 {
		t.Fatalf("status = %+v, want the authenticator and passkeys", status)
	}
	if _, err := env.authClient().DisableMfa(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaNextCode(t, secret),
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", tenant.User.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("unused recovery codes after turning the authenticator off = %d, want %d", got, mfa.RecoveryCodeCount)
	}
	status, err = env.authClient().GetMfaStatus(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceGetMfaStatusRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if status.Enabled || len(status.Methods) != 1 || status.Methods[0] != publiraadminv1.MfaMethod_MFA_METHOD_PASSKEY || status.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("status = %+v, want the passkeys alone with their recovery codes", status)
	}
}

func TestAdminPasskeyListRenameAndDelete(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, first := registerPasskey(t, env, tenant, "Laptop")
	_, second := registerPasskey(t, env, tenant, "Phone")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	listed, err := env.authClient().ListPasskeys(ctx, &publiraadminv1.AdminAuthServiceListPasskeysRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListPasskeys: %v", err)
	}
	if len(listed.Passkeys) != 2 || listed.Passkeys[0].Id != first.Passkey.Id || listed.Passkeys[1].Id != second.Passkey.Id {
		t.Fatalf("passkeys = %+v, want both, oldest first", listed.Passkeys)
	}

	renamed, err := env.authClient().RenamePasskey(ctx, &publiraadminv1.AdminAuthServiceRenamePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     first.Passkey.Id,
		Name:   "  Work laptop  ",
	})
	if err != nil {
		t.Fatalf("RenamePasskey: %v", err)
	}
	if renamed.Passkey.Name != "Work laptop" {
		t.Fatalf("renamed passkey = %+v, want the trimmed name", renamed.Passkey)
	}
	if _, err := env.authClient().RenamePasskey(ctx, &publiraadminv1.AdminAuthServiceRenamePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     first.Passkey.Id,
		Name:   strings.Repeat("a", passkeyNameMaxLength+1),
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("RenamePasskey with a name too long = %v, want invalid_argument", err)
	}

	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     first.Passkey.Id,
	}); err != nil {
		t.Fatalf("DeletePasskey: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", tenant.User.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes after removing one of two passkeys = %d, want %d", got, mfa.RecoveryCodeCount)
	}
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     first.Passkey.Id,
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePasskey of a removed passkey = %v, want not_found", err)
	}

	// The last factor goes with its recovery codes, and the login takes the
	// password alone again.
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     second.Passkey.Id,
	}); err != nil {
		t.Fatalf("DeletePasskey of the last passkey: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("recovery codes after removing the last factor = %d, want none", got)
	}
	if login := mfaLogin(t, env, tenant); login.AccessToken == nil {
		t.Fatalf("Login = %+v, want a session on the password alone", login)
	}
	for _, action := range []string{"admin_mfa_passkey_renamed", "admin_mfa_passkey_removed"} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = 'success'",
			tenant.Tenant.ID, tenant.User.ID, action); got == 0 {
			t.Fatalf("no audit_logs row for %s", action)
		}
	}
}

func TestAdminPasskeyDeleteRefusesTheLastFactorTheTenantRequires(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, registered := registerPasskey(t, env, tenant, "")
	requireTenantAdminMFA(t, env)
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	_, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     registered.Passkey.Id,
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeletePasskey of the last required factor = %v, want failed_precondition", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", tenant.User.ID); got != 1 {
		t.Fatalf("passkeys = %d, want the one refused removal kept", got)
	}

	// With an authenticator beside it, the passkey is no longer the last.
	enrollMfa(t, env, tenant)
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     registered.Passkey.Id,
	}); err != nil {
		t.Fatalf("DeletePasskey beside an authenticator: %v", err)
	}
}

// A passkey is its owner's: another member of staff cannot name it, and the
// list holds only one's own.
func TestAdminPasskeyBelongsToItsOwner(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, registered := registerPasskey(t, env, tenant, "")
	other := tenant.as(env.PG.SeedTenantAdmin(t, tenant.Tenant.ID, "TENANTUSER02", "other@example.com", "Other"))
	ctx := testutil.WithBearer(context.Background(), other.token())

	listed, err := env.authClient().ListPasskeys(ctx, &publiraadminv1.AdminAuthServiceListPasskeysRequest{Tenant: other.tenantContext()})
	if err != nil {
		t.Fatalf("ListPasskeys: %v", err)
	}
	if len(listed.Passkeys) != 0 {
		t.Fatalf("another member's passkeys = %+v, want none", listed.Passkeys)
	}
	if _, err := env.authClient().RenamePasskey(ctx, &publiraadminv1.AdminAuthServiceRenamePasskeyRequest{
		Tenant: other.tenantContext(),
		Id:     registered.Passkey.Id,
		Name:   "Mine",
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RenamePasskey of another member's passkey = %v, want not_found", err)
	}
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: other.tenantContext(),
		Id:     registered.Passkey.Id,
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePasskey of another member's passkey = %v, want not_found", err)
	}
}

// A passkey registered while the account's last other factor is being removed
// waits for that removal, and then finds the recovery codes gone with it and
// issues a batch of its own, rather than counting codes that are about to
// disappear and being left with none.
func TestAdminPasskeyRegistrationWaitsForARemovalOfTheLastFactor(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	registerPasskey(t, env, tenant, "")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	begun, err := env.authClient().BeginPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	credential := webauthntest.New(t, passkeyConsoleOrigin).Register(t, begun.CreationOptionsJson)

	// The removal of the last passkey, half done: its credential and the
	// recovery codes are deleted and not yet committed.
	removal, err := env.PG.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer removal.Rollback() //nolint:errcheck
	if err := dbmodels.New(removal).LockUserMfaFactors(context.Background(), tenant.User.ID); err != nil {
		t.Fatalf("LockUserMfaFactors: %v", err)
	}
	for _, statement := range []string{
		"DELETE FROM user_webauthn_credentials WHERE user_id = $1",
		"DELETE FROM user_mfa_recovery_codes WHERE user_id = $1",
	} {
		if _, err := removal.ExecContext(context.Background(), statement, tenant.User.ID); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}

	type result struct {
		resp *publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationResponse
		err  error
	}
	finished := make(chan result, 1)
	go func() {
		resp, err := env.authClient().FinishPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
			Tenant:         tenant.tenantContext(),
			CredentialJson: credential,
		})
		finished <- result{resp, err}
	}()
	select {
	case got := <-finished:
		t.Fatalf("FinishPasskeyRegistration = %+v, %v before the removal committed, want it to wait", got.resp, got.err)
	case <-time.After(500 * time.Millisecond):
	}
	if err := removal.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}

	got := <-finished
	if got.err != nil {
		t.Fatalf("FinishPasskeyRegistration: %v", got.err)
	}
	if len(got.resp.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d for the account's only factor", len(got.resp.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	if n := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", tenant.User.ID); n != mfa.RecoveryCodeCount {
		t.Fatalf("stored recovery codes = %d, want %d", n, mfa.RecoveryCodeCount)
	}
}
