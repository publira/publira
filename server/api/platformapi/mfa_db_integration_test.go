package platformapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

// The operator MFA RPCs are exercised against a real PostgreSQL rather than
// sqlmock: the flow spans an encrypted secret, a lock counter, and ten hashed
// recovery codes, and what matters about it is the state each step leaves.

type operatorMfaEnv struct {
	server   *httptest.Server
	pg       *testutil.PostgresEnv
	operator testutil.PlatformOperator
	auth     publirasplatformv1connect.PlatformAuthServiceClient
}

func newOperatorMfaEnv(t *testing.T) *operatorMfaEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), newTestEncryptor(t), nil, testutil.TokenManager(), nil, openMailGuard(), nil)
	server := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(server.Close)
	return &operatorMfaEnv{
		server:   server,
		pg:       pg,
		operator: pg.SeedPlatformOperator(t, "PLATMFA0001", "operator@example.com", "MFA Operator"),
		auth:     publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(server.Client(), server.URL))),
	}
}

func (e *operatorMfaEnv) session() context.Context {
	return testutil.WithBearer(context.Background(), issueDBIntegrationToken(e.operator))
}

func (e *operatorMfaEnv) login(t *testing.T, operator testutil.PlatformOperator) *publirasplatformv1.PlatformAuthServiceLoginResponse {
	t.Helper()

	resp, err := e.auth.Login(context.Background(), &publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: testutil.SeededPassword,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	return resp
}

// enroll takes the signed-in operator through a whole enrollment and returns
// the secret its authenticator now holds together with the recovery codes it
// was handed exactly once.
func (e *operatorMfaEnv) enroll(t *testing.T) (string, []string) {
	t.Helper()

	started, err := e.auth.StartMfaEnrollment(e.session(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	if started.Secret == "" || started.OtpauthUri == "" {
		t.Fatalf("StartMfaEnrollment returned secret=%q otpauth_uri=%q", started.Secret, started.OtpauthUri)
	}
	confirmed, err := e.auth.ConfirmMfaEnrollment(e.session(), &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest{
		Code: operatorMfaCode(t, started.Secret, 0),
	})
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment: %v", err)
	}
	if len(confirmed.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(confirmed.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	// A session enrolled voluntarily already has one; nothing new is issued.
	if confirmed.AccessToken != nil {
		t.Fatal("ConfirmMfaEnrollment issued an access token to an operator that was already signed in")
	}
	return started.Secret, confirmed.RecoveryCodes
}

// operatorMfaCode is the code for the period periods after the current one.
// A step is good once, so a test presenting a second code within the same
// period reaches for the next one rather than repeat a step already spent.
func operatorMfaCode(t *testing.T, secret string, periods int) string {
	t.Helper()

	code, err := mfa.GenerateCode(secret, time.Now().Add(time.Duration(periods*mfa.Period)*time.Second))
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

// mfaErrorReason reads the Publira ErrorInfo reason an error carries, or ""
// when it carries none. A refused code and a rejected session share the
// unauthenticated code, so the console tells them apart by this reason alone.
func mfaErrorReason(t *testing.T, err error) string {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error is not a connect error: %v", err)
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := connectproto.UnmarshalErrorDetail(detail)
		if valueErr != nil {
			continue
		}
		if info, ok := value.(*errdetails.ErrorInfo); ok && info.GetDomain() == rpcerrors.ErrorInfoDomain {
			return info.GetReason()
		}
	}
	return ""
}

func requireOperatorMfa(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()
	policy := platformpolicy.Defaults()
	policy.MFARequiredForPlatformOperator = true
	pg.SavePlatformPolicy(t, policy)
}

func TestDBOperatorLoginIssuesASessionWhenNoFactorIsEnrolled(t *testing.T) {
	env := newOperatorMfaEnv(t)

	resp := env.login(t, env.operator)
	if resp.MfaChallenge != nil {
		t.Fatalf("mfa_challenge = %v, want none", resp.MfaChallenge)
	}
	if resp.AccessToken.GetToken() == "" {
		t.Fatal("Login returned no access token")
	}
}

func TestDBOperatorMfaStoresTheSecretEncryptedAndTheCodesHashed(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, codes := env.enroll(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var stored string
	if err := env.pg.DB.QueryRowContext(ctx, "SELECT secret_encrypted FROM platform_user_mfa_totp WHERE platform_user_id = $1", env.operator.ID).Scan(&stored); err != nil {
		t.Fatalf("read stored secret: %v", err)
	}
	if stored == secret || !secretcrypto.IsEncryptedEnvelope(stored) {
		t.Fatalf("stored secret = %q, want a secretcrypto envelope", stored)
	}
	for _, code := range codes {
		if got := countRows(t, env.pg, "SELECT count(*) FROM platform_user_mfa_recovery_codes WHERE code_hash = $1", code); got != 0 {
			t.Fatalf("recovery code %q is stored as plaintext", code)
		}
	}
	if got := countRows(t, env.pg, "SELECT count(*) FROM platform_user_mfa_recovery_codes WHERE platform_user_id = $1", env.operator.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("stored recovery codes = %d, want %d", got, mfa.RecoveryCodeCount)
	}
}

func TestDBOperatorLoginStopsAtAVerifyChallengeOnceTheFactorIsEnrolled(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, codes := env.enroll(t)

	login := env.login(t, env.operator)
	if login.AccessToken != nil {
		t.Fatal("Login issued an access token before the second factor was settled")
	}
	if login.MfaChallenge.GetKind() != publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY {
		t.Fatalf("mfa challenge = %v, want a VERIFY challenge", login.MfaChallenge)
	}

	// A challenge stands for half a sign-in. Nothing that authorizes on a
	// session may accept it, or the second factor would be optional.
	if _, err := env.auth.GetMe(testutil.WithBearer(context.Background(), login.MfaChallenge.Token), &publirasplatformv1.PlatformAuthServiceGetMeRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a challenge token = %v, want unauthenticated", err)
	}

	verified, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{
		ChallengeToken: login.MfaChallenge.Token,
		Code:           operatorMfaCode(t, secret, 1),
	})
	if err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	if verified.RecoveryCodeUsed || verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("VerifyMfa = recovery_code_used %v, remaining %d; want false, %d", verified.RecoveryCodeUsed, verified.RemainingRecoveryCodes, mfa.RecoveryCodeCount)
	}
	me, err := env.auth.GetMe(testutil.WithBearer(context.Background(), verified.AccessToken.GetToken()), &publirasplatformv1.PlatformAuthServiceGetMeRequest{})
	if err != nil {
		t.Fatalf("GetMe with the token VerifyMfa issued: %v", err)
	}
	if me.User.PublicId != env.operator.PublicID {
		t.Fatalf("GetMe user = %q, want %q", me.User.PublicId, env.operator.PublicID)
	}

	// The challenge bought one session; presenting it again buys none, even
	// with a code that is good on its own.
	_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{
		ChallengeToken: login.MfaChallenge.Token,
		Code:           codes[0],
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated || mfaErrorReason(t, err) != "" {
		t.Fatalf("VerifyMfa with a spent challenge = %v, want unauthenticated with no MFA reason", err)
	}
}

// A challenge one console earned is no use at the other: the admin audience
// names a tenant, and the platform API verifies only its own.
func TestDBOperatorMfaRefusesAnAdminChallenge(t *testing.T) {
	env := newOperatorMfaEnv(t)
	env.enroll(t)

	adminChallenge, _, err := testutil.TokenManager().IssueMFAChallengeToken(env.operator.PublicID, auth.AudienceAdminMFAVerify, "tenant", env.operator.CredentialsVersion, time.Now())
	if err != nil {
		t.Fatalf("IssueMFAChallengeToken: %v", err)
	}
	_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{
		ChallengeToken: adminChallenge,
		Code:           "000000",
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa with an admin challenge = %v, want unauthenticated", err)
	}
}

func TestDBOperatorMfaSpendsARecoveryCodeOnce(t *testing.T) {
	env := newOperatorMfaEnv(t)
	_, codes := env.enroll(t)

	first := env.login(t, env.operator)
	verified, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{
		ChallengeToken: first.MfaChallenge.Token,
		Code:           codes[0],
	})
	if err != nil {
		t.Fatalf("VerifyMfa with a recovery code: %v", err)
	}
	if !verified.RecoveryCodeUsed || verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("VerifyMfa = recovery_code_used %v, remaining %d; want true, %d", verified.RecoveryCodeUsed, verified.RemainingRecoveryCodes, mfa.RecoveryCodeCount-1)
	}

	second := env.login(t, env.operator)
	_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{
		ChallengeToken: second.MfaChallenge.Token,
		Code:           codes[0],
	})
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("VerifyMfa with a spent recovery code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}
}

func TestDBOperatorMfaRefusesAReplayedCode(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, _ := env.enroll(t)
	code := operatorMfaCode(t, secret, 1)

	first := env.login(t, env.operator)
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: first.MfaChallenge.Token, Code: code}); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	second := env.login(t, env.operator)
	_, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: second.MfaChallenge.Token, Code: code})
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("VerifyMfa with a replayed code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}
}

// Two requests carrying the same code race for its step, and only one may
// have it.
func TestDBOperatorMfaAcceptsAConcurrentlyPresentedCodeOnce(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, _ := env.enroll(t)
	code := operatorMfaCode(t, secret, 1)
	challenges := []string{env.login(t, env.operator).MfaChallenge.Token, env.login(t, env.operator).MfaChallenge.Token}

	var wg sync.WaitGroup
	errs := make([]error, len(challenges))
	for i, challenge := range challenges {
		wg.Go(func() {
			_, errs[i] = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: challenge, Code: code})
		})
	}
	wg.Wait()

	accepted := 0
	for _, err := range errs {
		if err == nil {
			accepted++
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d of two concurrent presentations of one code, want 1 (errors: %v)", accepted, errs)
	}
}

func TestDBOperatorMfaLocksAfterRepeatedFailures(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, _ := env.enroll(t)

	login := env.login(t, env.operator)
	var err error
	for range mfa.MaxFailedAttempts {
		_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: "000000"})
	}
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaLocked {
		t.Fatalf("attempt %d = %v, want %s", mfa.MaxFailedAttempts, err, rpcerrors.ReasonMfaLocked)
	}
	// The lock holds against a right code as well.
	_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: operatorMfaCode(t, secret, 1)})
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaLocked {
		t.Fatalf("a right code while locked = %v, want %s", err, rpcerrors.ReasonMfaLocked)
	}
}

func TestDBOperatorMfaRegenerateReplacesEveryRecoveryCode(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, codes := env.enroll(t)

	// Only the authenticator may ask for a new batch.
	_, err := env.auth.RegenerateMfaRecoveryCodes(env.session(), &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest{Code: codes[0]})
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("RegenerateMfaRecoveryCodes with a recovery code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}

	regenerated, err := env.auth.RegenerateMfaRecoveryCodes(env.session(), &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest{Code: operatorMfaCode(t, secret, 1)})
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	if len(regenerated.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("regenerated codes = %d, want %d", len(regenerated.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	login := env.login(t, env.operator)
	_, err = env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: codes[1]})
	if mfaErrorReason(t, err) != rpcerrors.ReasonMfaInvalidCode {
		t.Fatalf("VerifyMfa with a replaced recovery code = %v, want %s", err, rpcerrors.ReasonMfaInvalidCode)
	}
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: regenerated.RecoveryCodes[0]}); err != nil {
		t.Fatalf("VerifyMfa with a regenerated recovery code: %v", err)
	}
}

func TestDBOperatorMfaDisableRemovesTheFactorAndItsRecoveryCodes(t *testing.T) {
	env := newOperatorMfaEnv(t)
	_, codes := env.enroll(t)

	// A recovery code may take the factor off: an operator whose
	// authenticator is gone has to be able to enroll a new one.
	if _, err := env.auth.DisableMfa(env.session(), &publirasplatformv1.PlatformAuthServiceDisableMfaRequest{Code: codes[0]}); err != nil {
		t.Fatalf("DisableMfa with a recovery code: %v", err)
	}
	if got := countRows(t, env.pg, "SELECT count(*) FROM platform_user_mfa_totp WHERE platform_user_id = $1", env.operator.ID); got != 0 {
		t.Fatalf("totp rows after disable = %d, want 0", got)
	}
	if got := countRows(t, env.pg, "SELECT count(*) FROM platform_user_mfa_recovery_codes WHERE platform_user_id = $1", env.operator.ID); got != 0 {
		t.Fatalf("recovery code rows after disable = %d, want 0", got)
	}
	if resp := env.login(t, env.operator); resp.MfaChallenge != nil || resp.AccessToken.GetToken() == "" {
		t.Fatalf("Login after disable = %v, want a session on the password alone", resp)
	}
}

func TestDBOperatorMfaStartRefusesToReplaceAConfirmedFactor(t *testing.T) {
	env := newOperatorMfaEnv(t)
	env.enroll(t)

	_, err := env.auth.StartMfaEnrollment(env.session(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartMfaEnrollment over a confirmed factor = %v, want failed_precondition", err)
	}
}

func TestDBOperatorMfaStatusReportsTheEnrollmentAndThePolicy(t *testing.T) {
	env := newOperatorMfaEnv(t)

	before, err := env.auth.GetMfaStatus(env.session(), &publirasplatformv1.PlatformAuthServiceGetMfaStatusRequest{})
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if before.Enabled || before.Required {
		t.Fatalf("status before enrolling = %v, want neither enabled nor required", before)
	}

	_, codes := env.enroll(t)
	login := env.login(t, env.operator)
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: codes[0]}); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	requireOperatorMfa(t, env.pg)

	after, err := env.auth.GetMfaStatus(env.session(), &publirasplatformv1.PlatformAuthServiceGetMfaStatusRequest{})
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	if !after.Enabled || after.EnabledAt == "" || !after.Required || after.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 {
		t.Fatalf("status after enrolling = %v, want enabled and required with %d codes left", after, mfa.RecoveryCodeCount-1)
	}
}

// With the factor required, an operator that has not enrolled gets no session
// at all: the only thing its challenge can complete is the enrollment, and
// doing so finishes the sign-in. Every role is held to it, an auditor too.
func TestDBOperatorLoginForcesEnrollmentWhenTheFactorIsRequired(t *testing.T) {
	env := newOperatorMfaEnv(t)
	requireOperatorMfa(t, env.pg)
	auditor := env.pg.SeedPlatformAuditor(t, "PLATMFA0002", "auditor@example.com", "MFA Auditor")

	login := env.login(t, auditor)
	if login.AccessToken != nil {
		t.Fatal("Login issued an access token to an operator that owes an enrollment")
	}
	if login.MfaChallenge.GetKind() != publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		t.Fatalf("mfa challenge = %v, want an ENROLL challenge", login.MfaChallenge)
	}

	// An enroll challenge answers no verification.
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: "000000"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa with an enroll challenge = %v, want unauthenticated", err)
	}

	started, err := env.auth.StartMfaEnrollment(context.Background(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{ChallengeToken: login.MfaChallenge.Token})
	if err != nil {
		t.Fatalf("StartMfaEnrollment with an enroll challenge: %v", err)
	}
	confirmed, err := env.auth.ConfirmMfaEnrollment(context.Background(), &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest{
		ChallengeToken: login.MfaChallenge.Token,
		Code:           operatorMfaCode(t, started.Secret, 0),
	})
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment with an enroll challenge: %v", err)
	}
	if confirmed.AccessToken.GetToken() == "" || len(confirmed.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("ConfirmMfaEnrollment = %v, want a session and %d recovery codes", confirmed, mfa.RecoveryCodeCount)
	}
	me, err := env.auth.GetMe(testutil.WithBearer(context.Background(), confirmed.AccessToken.Token), &publirasplatformv1.PlatformAuthServiceGetMeRequest{})
	if err != nil {
		t.Fatalf("GetMe with the token ConfirmMfaEnrollment issued: %v", err)
	}
	if me.User.Role != auth.RolePlatformAuditor {
		t.Fatalf("GetMe role = %q, want %s", me.User.Role, auth.RolePlatformAuditor)
	}

	// The same token cannot enroll the operator a second time.
	if _, err := env.auth.StartMfaEnrollment(context.Background(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{ChallengeToken: login.MfaChallenge.Token}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartMfaEnrollment with a used enroll challenge = %v, want failed_precondition", err)
	}
}

// A password change ends a pending challenge, as it ends a session.
func TestDBOperatorMfaChallengeEndsWithTheCredentialsVersion(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, _ := env.enroll(t)
	login := env.login(t, env.operator)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.pg.DB.ExecContext(ctx, "UPDATE platform_users SET credentials_version = credentials_version + 1 WHERE id = $1", env.operator.ID); err != nil {
		t.Fatalf("bump credentials version: %v", err)
	}
	_, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: operatorMfaCode(t, secret, 1)})
	if connect.CodeOf(err) != connect.CodeUnauthenticated || mfaErrorReason(t, err) != "" {
		t.Fatalf("VerifyMfa after a password change = %v, want unauthenticated with no MFA reason", err)
	}
}

func TestDBOperatorMfaWritesThePlatformAuditLog(t *testing.T) {
	env := newOperatorMfaEnv(t)
	secret, codes := env.enroll(t)

	login := env.login(t, env.operator)
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: login.MfaChallenge.Token, Code: codes[0]}); err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	failed := env.login(t, env.operator)
	if _, err := env.auth.VerifyMfa(context.Background(), &publirasplatformv1.PlatformAuthServiceVerifyMfaRequest{ChallengeToken: failed.MfaChallenge.Token, Code: "000000"}); err == nil {
		t.Fatal("VerifyMfa accepted a wrong code")
	}
	regenerated, err := env.auth.RegenerateMfaRecoveryCodes(env.session(), &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest{Code: operatorMfaCode(t, secret, 1)})
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	if _, err := env.auth.DisableMfa(env.session(), &publirasplatformv1.PlatformAuthServiceDisableMfaRequest{Code: regenerated.RecoveryCodes[0]}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}

	for _, want := range []struct {
		action  string
		outcome string
	}{
		{"operator_mfa_enrolled", "success"},
		{"operator_mfa_verified", "success"},
		{"operator_mfa_recovery_code_used", "success"},
		{"operator_mfa_verified", "failure"},
		{"operator_mfa_recovery_codes_regenerated", "success"},
		{"operator_mfa_disabled", "success"},
	} {
		got := countRows(t, env.pg,
			"SELECT count(*) FROM platform_audit_logs WHERE actor_platform_user_id = $1 AND action = $2 AND outcome = $3 AND target_type = 'operator' AND target_id = $4",
			env.operator.ID, want.action, want.outcome, env.operator.ID.String())
		if got == 0 {
			t.Fatalf("no platform_audit_logs row for action %q outcome %q", want.action, want.outcome)
		}
	}
}
