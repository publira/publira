package adminapi

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

// The MFA RPCs are exercised against a real PostgreSQL rather than sqlmock:
// the flow spans an encrypted secret, a lock counter, and ten hashed recovery
// codes, and what matters about it is the state each step leaves behind.

// mfaErrorReason reads the ErrorInfo reason an MFA failure carries. A refused
// code and a rejected session share the unauthenticated code, so the console
// tells them apart by this reason alone.
func mfaErrorReason(t *testing.T, err error) string {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error is not a connect error: %v", err)
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		info, ok := value.(*errdetails.ErrorInfo)
		if !ok {
			continue
		}
		if info.GetDomain() != rpcerrors.ErrorInfoDomain {
			continue
		}
		return info.GetReason()
	}
	return ""
}

func seedMfaTenant(t *testing.T, env *adminDBEnv) adminDBTenant {
	t.Helper()
	return env.seedTenantWithAdmin(t, "TENANT001", "tenant.example.com", "Tenant", "TENANTUSER01", "admin@example.com")
}

func mfaLogin(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.AdminAuthServiceLoginResponse {
	t.Helper()

	resp, err := env.authClient().Login(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    tenant.User.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	return resp.Msg
}

// withBearer signs a request with a token the test has in hand, rather than
// with the one newAdminDBRequest mints: what an MFA step hands back is the
// thing under test.
func withBearer[T any](msg *T, token string) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+token)
	return req
}

func mfaCode(t *testing.T, secret string) string {
	t.Helper()

	code, err := mfa.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

// mfaNextCode is the code for the period after the current one, still inside
// the acceptance window. A step is good once, so a test presenting a second
// code within the same period has to reach for the next one rather than
// repeat the step an earlier step of the test already spent.
func mfaNextCode(t *testing.T, secret string) string {
	t.Helper()

	code, err := mfa.GenerateCode(secret, time.Now().Add(mfa.Period*time.Second))
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

// enrollMfa takes a signed-in account through a whole enrollment and returns
// the secret its authenticator now holds together with the recovery codes it
// was handed exactly once.
func enrollMfa(t *testing.T, env *adminDBEnv, tenant adminDBTenant) (string, []string) {
	t.Helper()

	started, err := env.authClient().StartMfaEnrollment(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	secret := started.Msg.Secret
	if secret == "" || started.Msg.OtpauthUri == "" {
		t.Fatalf("StartMfaEnrollment returned secret=%q otpauth_uri=%q", secret, started.Msg.OtpauthUri)
	}

	confirmed, err := env.authClient().ConfirmMfaEnrollment(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaCode(t, secret),
	}))
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment: %v", err)
	}
	if len(confirmed.Msg.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(confirmed.Msg.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	// A session enrolled voluntarily already has one; nothing new is issued.
	if confirmed.Msg.AccessToken != nil {
		t.Fatal("ConfirmMfaEnrollment issued an access token to an account that was already signed in")
	}
	return secret, confirmed.Msg.RecoveryCodes
}

func TestAdminLoginIssuesASessionWhenNoFactorIsEnrolled(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)

	resp := mfaLogin(t, env, tenant)
	if resp.MfaChallenge != nil {
		t.Fatalf("mfa_challenge = %v, want none", resp.MfaChallenge)
	}
	if resp.AccessToken == nil || resp.AccessToken.Token == "" {
		t.Fatal("Login returned no access token")
	}
}

func TestAdminMfaEnrollmentStoresTheSecretEncrypted(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)

	secret, _ := enrollMfa(t, env, tenant)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var stored string
	if err := env.PG.DB.QueryRowContext(ctx, "SELECT secret_encrypted FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID).Scan(&stored); err != nil {
		t.Fatalf("read stored secret: %v", err)
	}
	if stored == secret {
		t.Fatal("the TOTP secret is stored as plaintext")
	}
	if !secretcrypto.IsEncryptedEnvelope(stored) {
		t.Fatalf("stored secret = %q, want a secretcrypto envelope", stored)
	}
}

func TestAdminMfaRecoveryCodesAreStoredHashed(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)

	_, codes := enrollMfa(t, env, tenant)

	for _, code := range codes {
		if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND code_hash = $2", tenant.User.ID, code); got != 0 {
			t.Fatalf("recovery code %q is stored as plaintext", code)
		}
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", tenant.User.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("stored recovery codes = %d, want %d", got, mfa.RecoveryCodeCount)
	}
}

func TestAdminLoginStopsAtAVerifyChallengeOnceTheFactorIsEnrolled(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, _ := enrollMfa(t, env, tenant)

	login := mfaLogin(t, env, tenant)
	if login.AccessToken != nil {
		t.Fatal("Login issued an access token before the second factor was settled")
	}
	if login.MfaChallenge == nil {
		t.Fatal("Login returned no mfa challenge")
	}
	if login.MfaChallenge.Kind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY {
		t.Fatalf("challenge kind = %v, want VERIFY", login.MfaChallenge.Kind)
	}

	verified, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           mfaNextCode(t, secret),
	}))
	if err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	if verified.Msg.AccessToken == nil || verified.Msg.AccessToken.Token == "" {
		t.Fatal("VerifyMfa returned no access token")
	}
	if verified.Msg.RecoveryCodeUsed {
		t.Fatal("recovery_code_used = true for a code from the authenticator")
	}
	if verified.Msg.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("remaining recovery codes = %d, want %d", verified.Msg.RemainingRecoveryCodes, mfa.RecoveryCodeCount)
	}

	// The token VerifyMfa handed back is the session the login was after.
	me, err := env.authClient().GetMe(context.Background(), withBearer(&publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}, verified.Msg.AccessToken.Token))
	if err != nil {
		t.Fatalf("GetMe with the token VerifyMfa issued: %v", err)
	}
	if me.Msg.User.PublicId != tenant.User.PublicID {
		t.Fatalf("GetMe user = %q, want %q", me.Msg.User.PublicId, tenant.User.PublicID)
	}
}

// A challenge stands for half a login. Nothing that authorizes on a session
// may accept it, or the second factor would be optional in practice.
func TestAdminMfaChallengeTokenIsNotASession(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	enrollMfa(t, env, tenant)

	login := mfaLogin(t, env, tenant)
	if login.MfaChallenge == nil {
		t.Fatal("Login returned no mfa challenge")
	}

	_, err := env.authClient().GetMe(context.Background(), withBearer(&publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}, login.MfaChallenge.Token))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a challenge token = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The verify and enroll challenges are separate audiences, so the token that
// may only finish an enrollment cannot answer a verification challenge.
func TestAdminMfaVerifyChallengeCannotStartAnEnrollment(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	enrollMfa(t, env, tenant)

	login := mfaLogin(t, env, tenant)
	if login.MfaChallenge == nil {
		t.Fatal("Login returned no mfa challenge")
	}

	_, err := env.authClient().StartMfaEnrollment(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("StartMfaEnrollment with a verify challenge = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestAdminMfaVerifySpendsARecoveryCodeOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, codes := enrollMfa(t, env, tenant)
	code := codes[0]

	login := mfaLogin(t, env, tenant)
	verified, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           code,
	}))
	if err != nil {
		t.Fatalf("VerifyMfa with a recovery code: %v", err)
	}
	if !verified.Msg.RecoveryCodeUsed {
		t.Fatal("recovery_code_used = false for a recovery code")
	}
	if verified.Msg.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("remaining recovery codes = %d, want %d", verified.Msg.RemainingRecoveryCodes, mfa.RecoveryCodeCount-1)
	}

	second := mfaLogin(t, env, tenant)
	_, err = env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: second.MfaChallenge.Token,
		Code:           code,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa reusing a spent recovery code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The acceptance window is wider than one period, so a code seen over a
// shoulder is still current for a while after it was used.
func TestAdminMfaVerifyRefusesAReplayedCode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, _ := enrollMfa(t, env, tenant)
	code := mfaNextCode(t, secret)

	first := mfaLogin(t, env, tenant)
	if _, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: first.MfaChallenge.Token,
		Code:           code,
	})); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}

	second := mfaLogin(t, env, tenant)
	_, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: second.MfaChallenge.Token,
		Code:           code,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa replaying a code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// A challenge token is a signed claim, so nothing about it changes when it is
// exchanged. The spent jti recorded in user_mfa_used_challenges is what makes
// one login one session: the second exchange is refused even though the code
// it presents is a good one the account has not spent.
func TestAdminMfaVerifyRefusesAReusedChallenge(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, codes := enrollMfa(t, env, tenant)

	login := mfaLogin(t, env, tenant)
	// A recovery code for the first exchange, so the TOTP step the second one
	// presents is still unspent and the challenge is the only thing that can
	// refuse it.
	verified, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           codes[0],
	}))
	if err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}

	_, err = env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           mfaNextCode(t, secret),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa reusing a challenge = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	// The refusal is about the challenge, not the account: the session the
	// first exchange handed out keeps working.
	status, err := env.authClient().GetMfaStatus(context.Background(), withBearer(&publiraadminv1.AdminAuthServiceGetMfaStatusRequest{
		Tenant: tenant.tenantContext(),
	}, verified.Msg.AccessToken.Token))
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if status.Msg.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("remaining recovery codes = %d, want %d", status.Msg.RemainingRecoveryCodes, mfa.RecoveryCodeCount-1)
	}
}

// Two requests carrying the same code both read the step before either
// writes, so the claim on it has to be the UPDATE rather than a comparison in
// Go. Exactly one of them may end up with a session.
func TestAdminMfaVerifyAcceptsAConcurrentlyPresentedCodeOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, _ := enrollMfa(t, env, tenant)
	code := mfaNextCode(t, secret)

	challenges := []string{
		mfaLogin(t, env, tenant).MfaChallenge.Token,
		mfaLogin(t, env, tenant).MfaChallenge.Token,
	}

	var start sync.WaitGroup
	start.Add(1)
	results := make(chan error, len(challenges))
	for _, challenge := range challenges {
		go func() {
			start.Wait()
			_, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
				Tenant:         tenant.tenantContext(),
				ChallengeToken: challenge,
				Code:           code,
			}))
			results <- err
		}()
	}
	start.Done()

	accepted := 0
	for range challenges {
		if err := <-results; err == nil {
			accepted++
		} else if connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("VerifyMfa error = %v, want unauthenticated for the losing request (err=%v)", connect.CodeOf(err), err)
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted requests = %d, want exactly 1", accepted)
	}
}

func TestAdminMfaVerifyLocksTheAccountAfterRepeatedFailures(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, _ := enrollMfa(t, env, tenant)

	for attempt := 1; attempt <= mfa.MaxFailedAttempts; attempt++ {
		login := mfaLogin(t, env, tenant)
		_, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: login.MfaChallenge.Token,
			Code:           "000000",
		}))
		want := connect.CodeUnauthenticated
		wantReason := rpcerrors.ReasonMfaInvalidCode
		if attempt == mfa.MaxFailedAttempts {
			want = connect.CodeResourceExhausted
			wantReason = rpcerrors.ReasonMfaLocked
		}
		if connect.CodeOf(err) != want {
			t.Fatalf("VerifyMfa attempt %d = %v, want %v (err=%v)", attempt, connect.CodeOf(err), want, err)
		}
		if reason := mfaErrorReason(t, err); reason != wantReason {
			t.Fatalf("VerifyMfa attempt %d reason = %q, want %q", attempt, reason, wantReason)
		}
	}

	// The lock holds even for the code that would otherwise be right.
	login := mfaLogin(t, env, tenant)
	_, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           mfaCode(t, secret),
	}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("VerifyMfa while locked = %v, want resource exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

func TestAdminMfaRegenerateReplacesEveryRecoveryCode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, old := enrollMfa(t, env, tenant)

	regenerated, err := env.authClient().RegenerateMfaRecoveryCodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaNextCode(t, secret),
	}))
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	if len(regenerated.Msg.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(regenerated.Msg.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", tenant.User.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("stored recovery codes = %d, want %d", got, mfa.RecoveryCodeCount)
	}

	login := mfaLogin(t, env, tenant)
	_, err = env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           old[0],
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa with a replaced recovery code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// Only the authenticator can mint a new batch: a leaked recovery code that
// could mint ten more would never expire.
func TestAdminMfaRegenerateRefusesARecoveryCode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, codes := enrollMfa(t, env, tenant)

	_, err := env.authClient().RegenerateMfaRecoveryCodes(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest{
		Tenant: tenant.tenantContext(),
		Code:   codes[0],
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RegenerateMfaRecoveryCodes with a recovery code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", tenant.User.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("unused recovery codes = %d, want the batch untouched (%d)", got, mfa.RecoveryCodeCount)
	}
}

func TestAdminMfaDisableRemovesTheFactorAndItsRecoveryCodes(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, _ := enrollMfa(t, env, tenant)

	if _, err := env.authClient().DisableMfa(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaNextCode(t, secret),
	})); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}

	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("user_mfa_totp rows = %d, want none", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("user_mfa_recovery_codes rows = %d, want none", got)
	}

	login := mfaLogin(t, env, tenant)
	if login.MfaChallenge != nil {
		t.Fatal("Login still asks for a second factor after it was disabled")
	}
	if login.AccessToken == nil {
		t.Fatal("Login returned no access token after the factor was disabled")
	}
}

// An account whose authenticator is gone gets itself back with a recovery
// code rather than waiting for an operator.
func TestAdminMfaDisableAcceptsARecoveryCode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	_, codes := enrollMfa(t, env, tenant)

	if _, err := env.authClient().DisableMfa(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   codes[0],
	})); err != nil {
		t.Fatalf("DisableMfa with a recovery code: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", tenant.User.ID); got != 0 {
		t.Fatalf("user_mfa_totp rows = %d, want none", got)
	}
}

func TestAdminMfaStartRefusesToReplaceAConfirmedFactor(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	enrollMfa(t, env, tenant)

	_, err := env.authClient().StartMfaEnrollment(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartMfaEnrollment on an enrolled account = %v, want failed precondition (err=%v)", connect.CodeOf(err), err)
	}
}

func TestAdminMfaStatusReportsTheEnrollmentAndWhatIsLeft(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)

	before, err := env.authClient().GetMfaStatus(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceGetMfaStatusRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if before.Msg.Enabled || before.Msg.Required {
		t.Fatalf("status before enrollment = %+v, want neither enabled nor required", before.Msg)
	}

	_, codes := enrollMfa(t, env, tenant)
	login := mfaLogin(t, env, tenant)
	if _, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           codes[0],
	})); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}

	after, err := env.authClient().GetMfaStatus(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceGetMfaStatusRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if !after.Msg.Enabled || after.Msg.EnabledAt == "" {
		t.Fatalf("status after enrollment = %+v, want enabled with a timestamp", after.Msg)
	}
	if after.Msg.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("remaining recovery codes = %d, want %d", after.Msg.RemainingRecoveryCodes, mfa.RecoveryCodeCount-1)
	}
}

// With the factor required, a tenant admin that has not enrolled gets no
// session at all: the only thing its challenge can complete is the
// enrollment, and doing so finishes the login.
func TestAdminLoginForcesEnrollmentWhenTheFactorIsRequired(t *testing.T) {
	t.Setenv("PUBLIRA_MFA_REQUIRED_FOR_TENANT_ADMIN", "true")
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)

	login := mfaLogin(t, env, tenant)
	if login.AccessToken != nil {
		t.Fatal("Login issued an access token to an account that owes an enrollment")
	}
	if login.MfaChallenge == nil || login.MfaChallenge.Kind != publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		t.Fatalf("mfa challenge = %v, want an ENROLL challenge", login.MfaChallenge)
	}

	started, err := env.authClient().StartMfaEnrollment(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
	}))
	if err != nil {
		t.Fatalf("StartMfaEnrollment with an enroll challenge: %v", err)
	}

	confirmed, err := env.authClient().ConfirmMfaEnrollment(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           mfaCode(t, started.Msg.Secret),
	}))
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment with an enroll challenge: %v", err)
	}
	if confirmed.Msg.AccessToken == nil || confirmed.Msg.AccessToken.Token == "" {
		t.Fatal("ConfirmMfaEnrollment did not finish the login it was reached from")
	}
	if len(confirmed.Msg.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(confirmed.Msg.RecoveryCodes), mfa.RecoveryCodeCount)
	}

	if _, err := env.authClient().GetMe(context.Background(), withBearer(&publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()}, confirmed.Msg.AccessToken.Token)); err != nil {
		t.Fatalf("GetMe with the token ConfirmMfaEnrollment issued: %v", err)
	}
}

// Only tenant_admin is held back. An editor may enroll, and is never stopped
// from signing in for not having.
func TestAdminLoginDoesNotForceEnrollmentOnAnEditor(t *testing.T) {
	t.Setenv("PUBLIRA_MFA_REQUIRED_FOR_TENANT_ADMIN", "true")
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	editor := tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TENANTUSER02", "editor@example.com", "Editor", auth.RoleTenantEditor))

	login := mfaLogin(t, env, editor)
	if login.MfaChallenge != nil {
		t.Fatalf("mfa_challenge = %v, want none for an editor", login.MfaChallenge)
	}
	if login.AccessToken == nil {
		t.Fatal("Login returned no access token for an editor")
	}
}

func TestAdminMfaWritesTheAuditTrail(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := seedMfaTenant(t, env)
	secret, codes := enrollMfa(t, env, tenant)

	login := mfaLogin(t, env, tenant)
	if _, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: login.MfaChallenge.Token,
		Code:           codes[0],
	})); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}

	failed := mfaLogin(t, env, tenant)
	if _, err := env.authClient().VerifyMfa(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceVerifyMfaRequest{
		Tenant:         tenant.tenantContext(),
		ChallengeToken: failed.MfaChallenge.Token,
		Code:           "000000",
	})); err == nil {
		t.Fatal("VerifyMfa accepted a wrong code")
	}

	if _, err := env.authClient().DisableMfa(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaNextCode(t, secret),
	})); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}

	for _, want := range []struct {
		action  string
		outcome string
	}{
		{action: "admin_mfa_enrolled", outcome: "success"},
		{action: "admin_mfa_verified", outcome: "success"},
		{action: "admin_mfa_recovery_code_used", outcome: "success"},
		{action: "admin_mfa_verified", outcome: "failure"},
		{action: "admin_mfa_disabled", outcome: "success"},
	} {
		got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2 AND action = $3 AND outcome = $4",
			tenant.Tenant.ID, tenant.User.ID, want.action, want.outcome)
		if got == 0 {
			t.Fatalf("no audit_logs row for action %q outcome %q", want.action, want.outcome)
		}
	}
}
