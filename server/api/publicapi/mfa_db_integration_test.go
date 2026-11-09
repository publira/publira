package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

// The site's second factor is exercised against a real PostgreSQL: it is the
// console's rows and the console's lock, and what matters is that each side
// reads what the other leaves.

// mfaDBEnv is a storefront that can seal an authenticator's secret, with one
// reader who has a password.
type mfaDBEnv struct {
	*publicDBEnv
	tenant testutil.Tenant
	reader testutil.TenantUser
}

func newMfaDBEnv(t *testing.T) *mfaDBEnv {
	t.Helper()
	return newMfaDBEnvWithGuards(t, openReaderGuards())
}

func newMfaDBEnvWithGuards(t *testing.T, guards readerGuards) *mfaDBEnv {
	t.Helper()
	encryptor := newPublicTestEncryptor(t)
	env := newPublicDBEnvConfigured(t, guards, openMailGuard(), func(api *apiServer, _ *sql.DB) {
		api.encryptor = encryptor
	})
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "MFAREADERA01", "reader@tenant-a.example.com", "Reader")
	return &mfaDBEnv{publicDBEnv: env, tenant: tenant, reader: reader}
}

func (e *mfaDBEnv) session(t *testing.T, user testutil.TenantUser) context.Context {
	t.Helper()
	return testutil.WithBearer(context.Background(), tokenFor(t, e.tenant, user))
}

func (e *mfaDBEnv) login(t *testing.T, user testutil.TenantUser) *publirav1.LoginResponse {
	t.Helper()
	resp, err := e.authClient().Login(context.Background(), &publirav1.LoginRequest{
		Tenant:   tenantContext(e.tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	return resp
}

// challenged fails unless login answered a challenge rather than a session,
// and returns its token.
func challenged(t *testing.T, login *publirav1.LoginResponse) string {
	t.Helper()
	if login.AccessToken != nil || login.User != nil || login.MfaChallenge.GetToken() == "" || login.MfaChallenge.GetExpiresAt() == "" {
		t.Fatalf("Login = %+v, want a challenge and no session", login)
	}
	return login.MfaChallenge.GetToken()
}

func (e *mfaDBEnv) verify(challenge, code string) (*publirav1.VerifyMfaResponse, error) {
	return e.authClient().VerifyMfa(context.Background(), &publirav1.VerifyMfaRequest{
		Tenant:         tenantContext(e.tenant),
		ChallengeToken: challenge,
		Code:           code,
	})
}

func mfaCode(t *testing.T, secret string, period int) string {
	t.Helper()
	code, err := mfa.GenerateCode(secret, time.Now().Add(time.Duration(period*mfa.Period)*time.Second))
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

// enroll takes the signed-in user through a whole enrollment on the site and
// returns the secret and the recovery codes it was handed. The code that
// confirms it spends the current step.
func (e *mfaDBEnv) enroll(t *testing.T, user testutil.TenantUser) (string, []string) {
	t.Helper()
	ctx := e.session(t, user)
	started, err := e.authClient().StartMfaEnrollment(ctx, &publirav1.StartMfaEnrollmentRequest{Tenant: tenantContext(e.tenant)})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	if started.Secret == "" || started.OtpauthUri == "" {
		t.Fatalf("StartMfaEnrollment = %+v, want a secret and its URI", started)
	}
	confirmed, err := e.authClient().ConfirmMfaEnrollment(ctx, &publirav1.ConfirmMfaEnrollmentRequest{
		Tenant: tenantContext(e.tenant),
		Code:   mfaCode(t, started.Secret, 0),
	})
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment: %v", err)
	}
	if len(confirmed.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(confirmed.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	return started.Secret, confirmed.RecoveryCodes
}

func (e *mfaDBEnv) status(t *testing.T, user testutil.TenantUser) *publirav1.GetMfaStatusResponse {
	t.Helper()
	status, err := e.authClient().GetMfaStatus(e.session(t, user), &publirav1.GetMfaStatusRequest{Tenant: tenantContext(e.tenant)})
	if err != nil {
		t.Fatalf("GetMfaStatus: %v", err)
	}
	return status
}

func assertReason(t *testing.T, err error, code connect.Code, reason string) {
	t.Helper()
	if connect.CodeOf(err) != code {
		t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), code, err)
	}
	if got, _ := errorInfoReason(err); got != reason {
		t.Fatalf("reason = %q, want %q (err=%v)", got, reason, err)
	}
}

// The acceptance criterion: a reader enrolls, is asked for the code at the
// next sign-in, and passes with one.
func TestDBMfaReaderEnrollsAndIsAskedForTheCodeAtLogin(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	if status := env.status(t, env.reader); status.Enabled || status.RemainingRecoveryCodes != 0 {
		t.Fatalf("status before enrolling = %+v, want nothing", status)
	}
	secret, _ := env.enroll(t, env.reader)
	if status := env.status(t, env.reader); !status.Enabled || status.EnabledAt == "" || status.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("status after enrolling = %+v, want enabled with every recovery code", status)
	}

	challenge := challenged(t, env.login(t, env.reader))
	// A challenge is no session.
	if _, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), challenge), &publirav1.GetMeRequest{Tenant: tenantContext(env.tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the challenge = %v, want unauthenticated", err)
	}

	verified, err := env.verify(challenge, mfaCode(t, secret, 1))
	if err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	if verified.RecoveryCodeUsed || verified.User.GetPublicId() != env.reader.PublicID || verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount {
		t.Fatalf("VerifyMfa = %+v, want the reader signed in with the authenticator", verified)
	}
	me, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), verified.AccessToken.GetToken()), &publirav1.GetMeRequest{Tenant: tenantContext(env.tenant)})
	if err != nil || me.User.GetPublicId() != env.reader.PublicID {
		t.Fatalf("GetMe with the verified session = %+v, %v", me, err)
	}

	// The challenge bought one session.
	if _, err := env.verify(challenge, mfaCode(t, secret, -1)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("VerifyMfa with a spent challenge = %v, want unauthenticated", err)
	}
	if reason, _ := errorInfoReason(err); reason != "" {
		t.Fatalf("VerifyMfa with a spent challenge reason = %q, want the end of the challenge", reason)
	}
}

func TestDBMfaReaderSignsInWithARecoveryCode(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	_, codes := env.enroll(t, env.reader)

	first := env.login(t, env.reader)
	verified, err := env.verify(challenged(t, first), codes[0])
	if err != nil {
		t.Fatalf("VerifyMfa with a recovery code: %v", err)
	}
	if !verified.RecoveryCodeUsed || verified.RemainingRecoveryCodes != mfa.RecoveryCodeCount-1 || verified.AccessToken.GetToken() == "" {
		t.Fatalf("VerifyMfa = %+v, want a session and one recovery code spent", verified)
	}

	// A recovery code is good once.
	second := env.login(t, env.reader)
	_, err = env.verify(challenged(t, second), codes[0])
	assertReason(t, err, connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
}

// A wrong code counts toward the lock the console applies to the same
// account, so a code guessed on the site is one fewer the console allows.
func TestDBMfaWrongCodesLockTheAccountTheConsoleLocks(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	secret, _ := env.enroll(t, env.reader)
	login := env.login(t, env.reader)
	challenge := challenged(t, login)

	for attempt := 1; attempt < mfa.MaxFailedAttempts; attempt++ {
		_, err := env.verify(challenge, "000000")
		assertReason(t, err, connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
	}
	_, err := env.verify(challenge, "000000")
	assertReason(t, err, connect.CodeResourceExhausted, rpcerrors.ReasonMfaLocked)
	// The right code is refused as well until the lock lifts.
	_, err = env.verify(challenge, mfaCode(t, secret, 1))
	assertReason(t, err, connect.CodeResourceExhausted, rpcerrors.ReasonMfaLocked)

	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_lockouts WHERE user_id = $1 AND locked_until > now()", env.reader.ID); got != 1 {
		t.Fatalf("locked rows = %d, want the console's lock on the account", got)
	}
}

// Each code checked spends one of the account's password verifications,
// before the code is looked at.
func TestDBMfaVerifySpendsThePasswordVerifications(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnvWithGuards(t, guardsWith(func(p *platformpolicy.Policy) {
		p.PasswordVerification = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3}
	}))
	secret, _ := env.enroll(t, env.reader)
	login := env.login(t, env.reader)
	challenge := challenged(t, login)

	// The enrollment cleared what its two steps spent.
	for range 3 {
		_, err := env.verify(challenge, "000000")
		assertReason(t, err, connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
	}
	_, err := env.verify(challenge, mfaCode(t, secret, 1))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("VerifyMfa past the limit = %v, want resource_exhausted", err)
	}
	if reason, _ := errorInfoReason(err); reason == rpcerrors.ReasonMfaLocked {
		t.Fatalf("VerifyMfa past the limit reason = %q, want the rate limit rather than the lock", reason)
	}
}

func TestDBMfaLoginWithIdTokenIsAskedForTheCode(t *testing.T) {
	t.Parallel()

	identity := newIdentityDBEnv(t)
	identity.enableProviders(t)
	member := identity.PG.SeedEndUser(t, identity.tenant.ID, "MFAREADERA02", "member@tenant-a.example.com", "Member")
	env := &mfaDBEnv{publicDBEnv: identity.publicDBEnv, tenant: identity.tenant, reader: member}
	secret, codes := env.enroll(t, member)

	// The first sign-in links the provider to the account that holds its
	// address, and is asked for the code all the same.
	linked := identity.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		identity.googleToken(t, "google-subject", member.Email, "nonce-1"), "nonce-1")
	if linked.AccessToken != nil || linked.User != nil || linked.AccountCreated {
		t.Fatalf("LoginWithIdToken = %+v, want no session before the code", linked)
	}
	if linked.MfaChallenge.GetToken() == "" {
		t.Fatalf("LoginWithIdToken = %+v, want a challenge", linked)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_identities WHERE user_id = $1", member.ID); got != 1 {
		t.Fatalf("links = %d, want the provider linked with the challenge", got)
	}
	verified, err := env.verify(linked.MfaChallenge.GetToken(), mfaCode(t, secret, 1))
	if err != nil || verified.User.GetPublicId() != member.PublicID {
		t.Fatalf("VerifyMfa after LoginWithIdToken = %+v, %v", verified, err)
	}

	// And so is a sign-in through the link that exists.
	again := identity.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		identity.googleToken(t, "google-subject", member.Email, "nonce-2"), "nonce-2")
	if again.AccessToken != nil || again.MfaChallenge.GetToken() == "" {
		t.Fatalf("LoginWithIdToken through the link = %+v, want a challenge", again)
	}
	if _, err := env.verify(again.MfaChallenge.GetToken(), codes[0]); err != nil {
		t.Fatalf("VerifyMfa with a recovery code after LoginWithIdToken: %v", err)
	}
}

// A passkey sign-in is already two factors, so it asks for no code.
func TestDBMfaPasskeySignInAsksForNoCode(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")

	encryptor := newPublicTestEncryptor(t)
	passkeys := seedPasskeyReader(t, newPublicDBEnvConfigured(t, openReaderGuards(), openMailGuard(), func(api *apiServer, _ *sql.DB) {
		api.encryptor = encryptor
	}))
	env := &mfaDBEnv{publicDBEnv: passkeys.publicDBEnv, tenant: passkeys.tenant, reader: passkeys.reader}
	env.enroll(t, passkeys.reader)
	authenticator, _ := passkeys.register(t, passkeys.session(t), passkeySiteOrigin, "Phone")

	signedIn, err := passkeys.finishSignIn(passkeys.tenant, authenticator.Assert(t, passkeys.beginSignIn(t, passkeys.tenant)))
	if err != nil {
		t.Fatalf("FinishPasskeyLogin: %v", err)
	}
	if signedIn.AccessToken.GetToken() == "" {
		t.Fatalf("FinishPasskeyLogin = %+v, want a session", signedIn)
	}
	// The password still owes the code.
	login := env.login(t, passkeys.reader)
	challenged(t, login)
}

// The authenticator is the account's: one a member of staff set up in the
// console, which keeps it in the same rows, is asked for on the site.
func TestDBMfaConsoleAuthenticatorIsAskedForOnTheSite(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	staff := env.PG.SeedEndUser(t, env.tenant.ID, "MFASTAFFA001", "editor@tenant-a.example.com", "Editor")
	env.PG.SeedTenantUserRole(t, env.tenant.ID, staff.ID, auth.RoleTenantEditor)
	secret := seedConsoleAuthenticator(t, env, staff)

	login := env.login(t, staff)
	verified, err := env.verify(challenged(t, login), mfaCode(t, secret, 0))
	if err != nil {
		t.Fatalf("VerifyMfa: %v", err)
	}
	if verified.User.GetPublicId() != staff.PublicID || verified.User.GetRole() != auth.RoleTenantEditor {
		t.Fatalf("VerifyMfa = %+v, want the member of staff with their role", verified.User)
	}
	if status := env.status(t, staff); !status.Enabled {
		t.Fatalf("status = %+v, want the console's authenticator reported", status)
	}
}

// seedConsoleAuthenticator stores a confirmed authenticator for user the way
// the console's enrollment leaves it, and returns its secret.
func seedConsoleAuthenticator(t *testing.T, env *mfaDBEnv, user testutil.TenantUser) string {
	t.Helper()
	enrollment, err := mfa.GenerateEnrollment("Tenant A", user.Email)
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	sealed, err := newPublicTestEncryptor(t).EncryptString(enrollment.Secret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	q := dbmodels.New(env.PG.DB)
	ctx := context.Background()
	if _, err := q.UpsertUserMfaTotpSecret(ctx, dbmodels.UpsertUserMfaTotpSecretParams{UserID: user.ID, TenantID: env.tenant.ID, SecretEncrypted: sealed}); err != nil {
		t.Fatalf("store the authenticator: %v", err)
	}
	if _, err := q.EnableUserMfaTotp(ctx, user.ID); err != nil {
		t.Fatalf("enable the authenticator: %v", err)
	}
	return enrollment.Secret
}

func TestDBMfaChallengeRefusals(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	secret, _ := env.enroll(t, env.reader)

	t.Run("a console's challenge", func(t *testing.T) {
		token, _, err := testutil.TokenManager().IssueMFAChallengeToken(env.reader.PublicID, auth.AudienceAdminMFAVerify, env.tenant.ID.String(), env.reader.CredentialsVersion, time.Now())
		if err != nil {
			t.Fatalf("IssueMFAChallengeToken: %v", err)
		}
		if _, err := env.verify(token, mfaCode(t, secret, 1)); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("VerifyMfa with the console's challenge = %v, want unauthenticated", err)
		}
	})
	t.Run("a session", func(t *testing.T) {
		if _, err := env.verify(tokenFor(t, env.tenant, env.reader), mfaCode(t, secret, 1)); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("VerifyMfa with a session = %v, want unauthenticated", err)
		}
	})
	t.Run("a password changed since", func(t *testing.T) {
		login := env.login(t, env.reader)
		challenge := challenged(t, login)
		env.bumpCredentialsVersion(t, env.reader.ID)
		if _, err := env.verify(challenge, mfaCode(t, secret, 1)); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("VerifyMfa after a password change = %v, want unauthenticated", err)
		}
	})
}

// The acceptance criterion: turning it off asks for the password and a code,
// and the next sign-in asks for the password alone.
func TestDBMfaDisableAsksForThePasswordAndACode(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	secret, _ := env.enroll(t, env.reader)
	disable := func(password, code string) error {
		_, err := env.authClient().DisableMfa(env.session(t, env.reader), &publirav1.DisableMfaRequest{
			Tenant:   tenantContext(env.tenant),
			Password: password,
			Code:     code,
		})
		return err
	}

	if err := disable("", mfaCode(t, secret, 1)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DisableMfa with no password = %v, want invalid_argument", err)
	}
	if err := disable(testutil.SeededPassword, ""); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DisableMfa with no code = %v, want invalid_argument", err)
	}
	if err := disable("not the password", mfaCode(t, secret, 1)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DisableMfa with a wrong password = %v, want invalid_argument", err)
	}
	assertReason(t, disable(testutil.SeededPassword, "000000"), connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
	if status := env.status(t, env.reader); !status.Enabled {
		t.Fatalf("status after the refusals = %+v, want it still on", status)
	}

	if err := disable(testutil.SeededPassword, mfaCode(t, secret, 1)); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	if status := env.status(t, env.reader); status.Enabled || status.RemainingRecoveryCodes != 0 {
		t.Fatalf("status after DisableMfa = %+v, want nothing left", status)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", env.reader.ID); got != 0 {
		t.Fatalf("recovery codes left = %d, want them gone with the authenticator", got)
	}
	if login := env.login(t, env.reader); login.AccessToken.GetToken() == "" || login.MfaChallenge != nil {
		t.Fatalf("Login after DisableMfa = %+v, want a session on the password alone", login)
	}
	if err := disable(testutil.SeededPassword, mfaCode(t, secret, 2)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DisableMfa with nothing to take off = %v, want failed_precondition", err)
	}
}

// An account without a password confirms with a passkey instead, which the
// step spends before it looks at the code.
func TestDBMfaDisableWithoutAPasswordConfirmsWithAPasskey(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")

	encryptor := newPublicTestEncryptor(t)
	passkeys := seedPasskeyReader(t, newPublicDBEnvConfigured(t, openReaderGuards(), openMailGuard(), func(api *apiServer, _ *sql.DB) {
		api.encryptor = encryptor
	}))
	env := &mfaDBEnv{publicDBEnv: passkeys.publicDBEnv, tenant: passkeys.tenant, reader: passkeys.reader}
	_, codes := env.enroll(t, passkeys.reader)
	authenticator, _ := passkeys.register(t, passkeys.session(t), passkeySiteOrigin, "Phone")
	passkeys.dropPassword(t)

	disable := func(code string) error {
		_, err := env.authClient().DisableMfa(passkeys.session(t), &publirav1.DisableMfaRequest{
			Tenant:                tenantContext(passkeys.tenant),
			PasskeyCredentialJson: authenticator.Assert(t, passkeys.beginConfirmation(t, passkeys.session(t))),
			Code:                  code,
		})
		return err
	}
	assertReason(t, disable("000000"), connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
	// A lost authenticator is taken off with a recovery code.
	if err := disable(codes[0]); err != nil {
		t.Fatalf("DisableMfa with a passkey and a recovery code: %v", err)
	}
	if status := env.status(t, passkeys.reader); status.Enabled {
		t.Fatalf("status after DisableMfa = %+v, want it off", status)
	}
}

// The recovery codes stand in for a console passkey too, so they stay when
// the authenticator goes and one is left.
func TestDBMfaDisableKeepsTheCodesOfAConsolePasskey(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	staff := env.PG.SeedTenantUser(t, env.tenant.ID, "MFASTAFFA001", "admin@tenant-a.example.com", "Admin", auth.RoleTenantAdmin)
	secret, _ := env.enroll(t, staff)
	seedConsolePasskey(t, env, staff)

	if _, err := env.authClient().DisableMfa(env.session(t, staff), &publirav1.DisableMfaRequest{
		Tenant:   tenantContext(env.tenant),
		Password: testutil.SeededPassword,
		Code:     mfaCode(t, secret, 1),
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1", staff.ID); got != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes left = %d, want the console passkey's %d", got, mfa.RecoveryCodeCount)
	}
}

// A console passkey is a factor the site cannot ask for, so its session
// proves the password alone, and an authenticator set up through it would
// answer the console in the passkey's place.
func TestDBMfaEnrollmentRefusesAnAccountWithAConsolePasskey(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	staff := env.PG.SeedTenantUser(t, env.tenant.ID, "MFASTAFFA001", "admin@tenant-a.example.com", "Admin", auth.RoleTenantAdmin)
	seedConsolePasskey(t, env, staff)
	ctx := env.session(t, staff)

	_, err := env.authClient().StartMfaEnrollment(ctx, &publirav1.StartMfaEnrollmentRequest{Tenant: tenantContext(env.tenant)})
	assertReason(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonMfaSetUpInConsole)
	_, err = env.authClient().ConfirmMfaEnrollment(ctx, &publirav1.ConfirmMfaEnrollmentRequest{Tenant: tenantContext(env.tenant), Code: "000000"})
	assertReason(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonMfaSetUpInConsole)
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", staff.ID); got != 0 {
		t.Fatalf("authenticators = %d, want none stored", got)
	}
}

// An authenticator started on the site before the console's passkey was
// registered is not turned on after it.
func TestDBMfaConfirmationRefusesAConsolePasskeyRegisteredSinceTheStart(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	staff := env.PG.SeedTenantUser(t, env.tenant.ID, "MFASTAFFA001", "admin@tenant-a.example.com", "Admin", auth.RoleTenantAdmin)
	ctx := env.session(t, staff)
	started, err := env.authClient().StartMfaEnrollment(ctx, &publirav1.StartMfaEnrollmentRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	seedConsolePasskey(t, env, staff)

	_, err = env.authClient().ConfirmMfaEnrollment(ctx, &publirav1.ConfirmMfaEnrollmentRequest{Tenant: tenantContext(env.tenant), Code: mfaCode(t, started.Secret, 0)})
	assertReason(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonMfaSetUpInConsole)
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1 AND enabled_at IS NOT NULL", staff.ID); got != 0 {
		t.Fatalf("confirmed authenticators = %d, want none", got)
	}
}

func TestDBMfaRegenerateRecoveryCodesTakesTheAuthenticator(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	secret, codes := env.enroll(t, env.reader)
	regenerate := func(code string) (*publirav1.RegenerateMfaRecoveryCodesResponse, error) {
		return env.authClient().RegenerateMfaRecoveryCodes(env.session(t, env.reader), &publirav1.RegenerateMfaRecoveryCodesRequest{
			Tenant: tenantContext(env.tenant),
			Code:   code,
		})
	}

	_, err := regenerate(codes[0])
	assertReason(t, err, connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
	fresh, err := regenerate(mfaCode(t, secret, 1))
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	if len(fresh.RecoveryCodes) != mfa.RecoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(fresh.RecoveryCodes), mfa.RecoveryCodeCount)
	}
	// The batch before is gone.
	login := env.login(t, env.reader)
	_, err = env.verify(challenged(t, login), codes[1])
	assertReason(t, err, connect.CodeUnauthenticated, rpcerrors.ReasonMfaInvalidCode)
}

// The acceptance criterion: once a Tenant admin removes it, the next sign-in
// asks for the password alone.
func TestDBMfaResetLeavesThePasswordAlone(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	env.enroll(t, env.reader)

	tx, err := env.PG.DB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tenantmembers.ResetMFA(context.Background(), tx, tenantmembers.ResetMFAParams{TenantID: env.tenant.ID, UserPublicID: env.reader.PublicID}); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if login := env.login(t, env.reader); login.AccessToken.GetToken() == "" || login.MfaChallenge != nil {
		t.Fatalf("Login after the reset = %+v, want a session on the password alone", login)
	}
}

// seedConsolePasskey stores a passkey for user as the console registers one.
// Nothing here asserts with it, so its key is no real one.
func seedConsolePasskey(t *testing.T, env *mfaDBEnv, user testutil.TenantUser) {
	t.Helper()
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO user_webauthn_credentials (
			id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, sign_count, aaguid, backup_eligible, backed_up
		) VALUES (gen_random_uuid(), 'MFAPASSKEY01', $1, $2, 'admin_console', 'admin.tenant-a.example.com', '\x01', '\x01', 0, gen_random_uuid(), false, false)
	`, env.tenant.ID, user.ID); err != nil {
		t.Fatalf("seed a console passkey: %v", err)
	}
}
