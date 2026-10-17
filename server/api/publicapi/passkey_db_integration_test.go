package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/tenantwebauthn"
	"github.com/publira/publira/server/internal/tenantwebauthn/webauthntest"
	"github.com/publira/publira/server/internal/testutil"
)

// The storefront's origin and RP ID for the tenant every case seeds, and the
// console's beside it.
const (
	passkeySiteOrigin    = "https://tenant-a.example.com"
	passkeySiteRPID      = "tenant-a.example.com"
	passkeyConsoleOrigin = "https://admin-tenant-a.example.com"
)

// passkeyDBEnv is a storefront with one reader signed in, who has a password.
type passkeyDBEnv struct {
	*publicDBEnv
	tenant testutil.Tenant
	reader testutil.TenantUser
}

func newPasskeyDBEnv(t *testing.T) *passkeyDBEnv {
	t.Helper()
	t.Setenv(tenantorigin.SchemeEnv, "")
	return seedPasskeyReader(t, newPublicDBEnv(t))
}

func seedPasskeyReader(t *testing.T, env *publicDBEnv) *passkeyDBEnv {
	t.Helper()
	tenant := env.seedTenant(t, "TENANTA", passkeySiteRPID, "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "PKREADER0001", "reader@example.com", "Reader")
	return &passkeyDBEnv{publicDBEnv: env, tenant: tenant, reader: reader}
}

func (e *passkeyDBEnv) session(t *testing.T) context.Context {
	t.Helper()
	return testutil.WithBearer(context.Background(), tokenFor(t, e.tenant, e.reader))
}

// register runs a whole registration for the signed-in reader on an
// authenticator made on origin.
func (e *passkeyDBEnv) register(t *testing.T, ctx context.Context, origin, name string) (*webauthntest.Authenticator, *publirav1.Passkey) {
	t.Helper()
	authenticator := webauthntest.New(t, origin)
	passkey, err := e.finishRegistration(t, ctx, authenticator, name)
	if err != nil {
		t.Fatalf("FinishPasskeyRegistration: %v", err)
	}
	return authenticator, passkey
}

func (e *passkeyDBEnv) finishRegistration(t *testing.T, ctx context.Context, authenticator *webauthntest.Authenticator, name string) (*publirav1.Passkey, error) {
	t.Helper()
	begun, err := e.authClient().BeginPasskeyRegistration(ctx, &publirav1.BeginPasskeyRegistrationRequest{Tenant: tenantContext(e.tenant)})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	resp, err := e.authClient().FinishPasskeyRegistration(ctx, &publirav1.FinishPasskeyRegistrationRequest{
		Tenant:         tenantContext(e.tenant),
		CredentialJson: authenticator.Register(t, begun.CreationOptionsJson),
		Name:           name,
	})
	if err != nil {
		return nil, err
	}
	return resp.Passkey, nil
}

// beginSignIn begins a passkey sign-in on tenant, with no session.
func (e *passkeyDBEnv) beginSignIn(t *testing.T, tenant testutil.Tenant) string {
	t.Helper()
	begun, err := e.authClient().BeginPasskeyLogin(context.Background(), &publirav1.BeginPasskeyLoginRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("BeginPasskeyLogin: %v", err)
	}
	return begun.RequestOptionsJson
}

func (e *passkeyDBEnv) finishSignIn(tenant testutil.Tenant, credentialJSON string) (*publirav1.FinishPasskeyLoginResponse, error) {
	return e.authClient().FinishPasskeyLogin(context.Background(), &publirav1.FinishPasskeyLoginRequest{
		Tenant:         tenantContext(tenant),
		CredentialJson: credentialJSON,
	})
}

func (e *passkeyDBEnv) beginConfirmation(t *testing.T, ctx context.Context) string {
	t.Helper()
	begun, err := e.authClient().BeginPasskeyConfirmation(ctx, &publirav1.BeginPasskeyConfirmationRequest{Tenant: tenantContext(e.tenant)})
	if err != nil {
		t.Fatalf("BeginPasskeyConfirmation: %v", err)
	}
	return begun.RequestOptionsJson
}

// dropPassword leaves the reader an account without a password, as a
// provider sign-in creates one.
func (e *passkeyDBEnv) dropPassword(t *testing.T) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), "UPDATE users SET password_hash = NULL WHERE id = $1", e.reader.ID); err != nil {
		t.Fatalf("drop the password: %v", err)
	}
}

func assertSignInRefused(t *testing.T, err error, what string) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("%s code = %v, want unauthenticated (err=%v)", what, connect.CodeOf(err), err)
	}
}

// The acceptance criterion: a reader registers a passkey while signed in,
// signs out, and signs back in with the passkey alone.
func TestDBPasskeySignsTheReaderInWithNoAddressTyped(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, registered := env.register(t, env.session(t), passkeySiteOrigin, "Phone")
	if registered.Name != "Phone" || registered.LastUsedAt != "" {
		t.Fatalf("registered passkey = %+v, want it named and never used", registered)
	}

	if _, err := env.authClient().Logout(context.Background(), &publirav1.LogoutRequest{Tenant: tenantContext(env.tenant)}); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	signedIn, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	if err != nil {
		t.Fatalf("FinishPasskeyLogin: %v", err)
	}
	if signedIn.User.GetPublicId() != env.reader.PublicID || signedIn.AccessToken.GetToken() == "" {
		t.Fatalf("signed in as %+v, want the reader with a session", signedIn.User)
	}
	me, err := env.authClient().GetMe(testutil.WithBearer(context.Background(), signedIn.AccessToken.Token), &publirav1.GetMeRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("GetMe with the passkey's session: %v", err)
	}
	if me.User.GetEmail() != env.reader.Email {
		t.Fatalf("GetMe = %+v, want the reader", me.User)
	}

	listed, err := env.authClient().ListMyPasskeys(env.session(t), &publirav1.ListMyPasskeysRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPasskeys: %v", err)
	}
	if len(listed.Passkeys) != 1 || listed.Passkeys[0].Id != registered.Id || listed.Passkeys[0].LastUsedAt == "" {
		t.Fatalf("passkeys = %+v, want the one registered, used once", listed.Passkeys)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE tenant_id = $1", env.tenant.ID); got != 0 {
		t.Fatalf("ceremonies left = %d, want each spent by its finish", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1 AND relying_party = 'site' AND rp_id = $2", env.reader.ID, passkeySiteRPID); got != 1 {
		t.Fatalf("storefront passkeys = %d, want 1 bound to the storefront's host", got)
	}
}

// A challenge is good for one finish, whether the same assertion is sent
// again or a new one is signed over it.
func TestDBPasskeySignInRefusesAReusedChallenge(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, _ := env.register(t, env.session(t), passkeySiteOrigin, "")

	options := env.beginSignIn(t, env.tenant)
	assertion := authenticator.Assert(t, options)
	if _, err := env.finishSignIn(env.tenant, assertion); err != nil {
		t.Fatalf("FinishPasskeyLogin: %v", err)
	}
	_, err := env.finishSignIn(env.tenant, assertion)
	assertSignInRefused(t, err, "the same assertion again")
	_, err = env.finishSignIn(env.tenant, authenticator.Assert(t, options))
	assertSignInRefused(t, err, "a new assertion over the spent challenge")
	_, err = env.finishSignIn(env.tenant, authenticator.AssertChallenge(t, "bm90LWlzc3VlZC1ieS10aGUtc2VydmVy"))
	assertSignInRefused(t, err, "an assertion over a challenge never issued")
}

// A passkey registered on another tenant's storefront signs nobody in here,
// even made on this storefront's origin for its RP ID: the credential is
// looked up within the tenant alone.
func TestDBPasskeySignInRefusesAnotherTenantsPasskey(t *testing.T) {
	env := newPasskeyDBEnv(t)
	other := env.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	otherReader := env.PG.SeedEndUser(t, other.ID, "PKREADER0002", "reader@example.com", "Reader")
	otherEnv := &passkeyDBEnv{publicDBEnv: env.publicDBEnv, tenant: other, reader: otherReader}
	authenticator, _ := otherEnv.register(t, otherEnv.session(t), "https://tenant-b.example.com", "")

	authenticator.Origin = passkeySiteOrigin
	authenticator.RPID = passkeySiteRPID
	_, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "another tenant's passkey")

	// A challenge one tenant issued is not spent by the other's finish either.
	authenticator.Origin = "https://tenant-b.example.com"
	authenticator.RPID = "tenant-b.example.com"
	_, err = otherEnv.finishSignIn(other, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "a challenge another tenant issued")
}

// A console passkey is no storefront passkey: one bound to the console's own
// host is refused, and so is one bound to a host the two share, as a console
// served on the storefront's host under another port would.
func TestDBPasskeySignInRefusesAConsolePasskey(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant, err := dbmodels.New(env.PG.DB).GetTenantByID(context.Background(), env.tenant.ID)
	if err != nil {
		t.Fatalf("GetTenantByID: %v", err)
	}
	console, err := tenantwebauthn.AdminConsole(tenant)
	if err != nil {
		t.Fatalf("AdminConsole: %v", err)
	}
	user := tenantwebauthn.User{Handle: tenantwebauthn.UserHandle(env.reader.PublicID), Name: env.reader.Email, DisplayName: "Reader"}
	authenticator := webauthntest.New(t, passkeyConsoleOrigin)
	options, ceremony, err := console.BeginRegistration(user)
	if err != nil {
		t.Fatalf("BeginRegistration on the console: %v", err)
	}
	parsed, _, err := tenantwebauthn.ParseRegistration([]byte(authenticator.Register(t, string(options))))
	if err != nil {
		t.Fatalf("ParseRegistration: %v", err)
	}
	credential, err := console.FinishRegistration(user, ceremony, parsed)
	if err != nil {
		t.Fatalf("FinishRegistration on the console: %v", err)
	}
	insertConsolePasskey := func(publicID, rpID string, credentialID []byte) {
		t.Helper()
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO user_webauthn_credentials (
				id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, sign_count, aaguid, backup_eligible, backed_up
			) VALUES ($1, $2, $3, $4, 'admin_console', $5, $6, $7, 0, $8, false, false)
		`, uuid.Must(uuid.NewV7()), publicID, env.tenant.ID, env.reader.ID, rpID, credentialID, credential.PublicKey, tenantwebauthn.AAGUID(credential)); err != nil {
			t.Fatalf("store the console passkey: %v", err)
		}
	}
	insertConsolePasskey("CONSOLEPK001", console.ID, credential.ID)

	authenticator.Origin = passkeySiteOrigin
	_, err = env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "a console passkey bound to the console's host")

	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM user_webauthn_credentials WHERE user_id = $1", env.reader.ID); err != nil {
		t.Fatalf("clear the console passkey: %v", err)
	}
	insertConsolePasskey("CONSOLEPK002", passkeySiteRPID, credential.ID)
	authenticator.RPID = passkeySiteRPID
	_, err = env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "a console passkey bound to the storefront's host")
}

// An assertion made on the console's origin is refused, even for a storefront
// passkey.
func TestDBPasskeySignInRefusesAnotherOrigin(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, _ := env.register(t, env.session(t), passkeySiteOrigin, "")

	authenticator.Origin = passkeyConsoleOrigin
	_, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "an assertion made on the console's origin")
}

// androidAppOrigin is the origin Credential Manager reports for an app signed
// with the certificate whose fingerprint is fingerprint.
func androidAppOrigin(t *testing.T, fingerprint string) string {
	t.Helper()
	origin, err := tenantwebauthn.AndroidAppOrigin(fingerprint)
	if err != nil {
		t.Fatalf("AndroidAppOrigin: %v", err)
	}
	return origin
}

// The tenant's Android app registers a passkey, signs in with it, and confirms
// an email change with it, from any certificate the tenant saved, and an app
// signed with another certificate is refused on each of those as a foreign
// site is.
func TestDBPasskeyIsUsedFromTheTenantsAndroidApp(t *testing.T) {
	env := newPasskeyDBEnv(t)
	seedMobileAppAssociation(t, env.publicDBEnv, env.tenant, "com.example.comics", []string{testFingerprintA, testFingerprintB}, "", "")
	ctx := env.session(t)
	unsaved := androidAppOrigin(t, "00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F")

	_, err := env.finishRegistration(t, ctx, webauthntest.New(t, unsaved), "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a credential made by an app signed with another certificate code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	authenticator, _ := env.register(t, ctx, androidAppOrigin(t, testFingerprintA), "Android")

	authenticator.Origin = unsaved
	_, err = env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "an assertion made by an app signed with another certificate")
	authenticator.Origin = androidAppOrigin(t, testFingerprintB)
	signedIn, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	if err != nil {
		t.Fatalf("FinishPasskeyLogin from the app: %v", err)
	}
	if signedIn.User.GetPublicId() != env.reader.PublicID {
		t.Fatalf("signed in as %+v, want the reader", signedIn.User)
	}

	env.dropPassword(t)
	request := func(newEmail string) error {
		_, err := env.authClient().RequestEmailChange(ctx, &publirav1.RequestEmailChangeRequest{
			Tenant:                tenantContext(env.tenant),
			CurrentEmail:          env.reader.Email,
			NewEmail:              newEmail,
			PasskeyCredentialJson: authenticator.Assert(t, env.beginConfirmation(t, ctx)),
		})
		return err
	}
	authenticator.Origin = unsaved
	err = request("elsewhere@example.com")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a confirmation made by an app signed with another certificate code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, passkeyConfirmationField)
	authenticator.Origin = androidAppOrigin(t, testFingerprintA)
	if err := request("next@example.com"); err != nil {
		t.Fatalf("RequestEmailChange confirmed from the app: %v", err)
	}
}

// A tenant with no Android app accepts no app's assertion, whatever
// certificate signed it.
func TestDBPasskeySignInRefusesAnAppTheTenantHasNot(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, _ := env.register(t, env.session(t), passkeySiteOrigin, "")

	authenticator.Origin = androidAppOrigin(t, testFingerprintA)
	_, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	assertSignInRefused(t, err, "an assertion made by an app the tenant has not configured")
}

// A suspended account, and one whose address is not verified, is refused as a
// password sign-in refuses it once the password verifies.
func TestDBPasskeySignInRefusesWhatLoginRefuses(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, _ := env.register(t, env.session(t), passkeySiteOrigin, "")

	env.suspendUser(t, env.reader.ID)
	_, err := env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a suspended account code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE users SET status = 'active', email_verified_at = NULL WHERE id = $1", env.reader.ID); err != nil {
		t.Fatalf("unverify the address: %v", err)
	}
	_, err = env.finishSignIn(env.tenant, authenticator.Assert(t, env.beginSignIn(t, env.tenant)))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("an unverified address code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// The storefront begins a passkey sign-in whenever its sign-in page opens, to
// offer the reader's passkeys in the browser's autofill, so most are never
// finished. Leaving any number of them unfinished spends nothing of the
// allowance that bounds failed passwords from the origin, and failed
// passwords still meet it.
func TestDBPasskeySignInsLeftUnfinishedDoNotSpendTheOriginsSignInAllowance(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	env := seedPasskeyReader(t, newPublicDBEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 2, PerDay: 2},
	)))

	for page := 1; page <= 10; page++ {
		env.beginSignIn(t, env.tenant)
	}
	if err := tryLogin(t, env.publicDBEnv, env.tenant, env.reader.Email, testutil.SeededPassword); err != nil {
		t.Fatalf("a password sign-in after ten unfinished passkey sign-ins: %v", err)
	}
	for guess := 1; guess <= 2; guess++ {
		if err := tryLogin(t, env.publicDBEnv, env.tenant, env.reader.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("wrong password %d code = %v, want unauthenticated (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, env.publicDBEnv, env.tenant, env.reader.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a wrong password past the origin's allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// What bounds the sign-in ceremonies one origin can make the server keep is
// how many it has open on the tenant: a begin past siteSignInOpenCeremonies
// drops the oldest, whose passkey is then refused, while the newest still
// signs the reader in and the origin's ceremony on another tenant stays.
func TestDBPasskeySignInKeepsOnlyTheNewestOpenCeremoniesOfAnOrigin(t *testing.T) {
	env := newPasskeyDBEnv(t)
	authenticator, _ := env.register(t, env.session(t), passkeySiteOrigin, "")
	other := env.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	env.beginSignIn(t, other)

	oldest := env.beginSignIn(t, env.tenant)
	for range siteSignInOpenCeremonies - 1 {
		env.beginSignIn(t, env.tenant)
	}
	newest := env.beginSignIn(t, env.tenant)

	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE user_id IS NULL AND tenant_id = $1", env.tenant.ID); got != siteSignInOpenCeremonies {
		t.Fatalf("open sign-in ceremonies on the tenant = %d, want %d", got, siteSignInOpenCeremonies)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE user_id IS NULL AND tenant_id = $1", other.ID); got != 1 {
		t.Fatalf("open sign-in ceremonies on the other tenant = %d, want 1", got)
	}
	_, err := env.finishSignIn(env.tenant, authenticator.Assert(t, oldest))
	assertSignInRefused(t, err, "the passkey presented to the oldest sign-in")
	if _, err := env.finishSignIn(env.tenant, authenticator.Assert(t, newest)); err != nil {
		t.Fatalf("the passkey presented to the newest sign-in: %v", err)
	}
}

func TestDBPasskeyRegistrationRefusesWhatDoesNotVerify(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)

	_, err := env.finishRegistration(t, ctx, webauthntest.New(t, passkeyConsoleOrigin), "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a credential made on the console's origin code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	unverified := webauthntest.New(t, passkeySiteOrigin)
	unverified.UserVerified = false
	_, err = env.finishRegistration(t, ctx, unverified, "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a credential made without user verification code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	authenticator, _ := env.register(t, ctx, passkeySiteOrigin, "")
	_, err = env.finishRegistration(t, ctx, authenticator, "")
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("the same credential again code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}

	_, err = env.authClient().BeginPasskeyRegistration(context.Background(), &publirav1.BeginPasskeyRegistrationRequest{Tenant: tenantContext(env.tenant)})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("a registration with no session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBPasskeyRegistrationStopsAtTheAccountsLimit(t *testing.T) {
	env := newPasskeyDBEnv(t)
	for i := range maxPasskeysPerAccount {
		if _, err := env.PG.DB.ExecContext(context.Background(), `
			INSERT INTO user_webauthn_credentials (
				id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, aaguid, backup_eligible, backed_up
			) VALUES ($1, $2, $3, $4, 'site', $5, $6, '\x00', '00000000-0000-0000-0000-000000000000', false, false)
		`, uuid.Must(uuid.NewV7()), publicIDOf("PASSKEY", i), env.tenant.ID, env.reader.ID, passkeySiteRPID, []byte{byte(i)}); err != nil {
			t.Fatalf("seed passkey %d: %v", i, err)
		}
	}
	_, err := env.authClient().BeginPasskeyRegistration(env.session(t), &publirav1.BeginPasskeyRegistrationRequest{Tenant: tenantContext(env.tenant)})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a registration past the limit code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// publicIDOf is a public ID of prefix padded with the digits of i.
func publicIDOf(prefix string, i int) string {
	id := prefix
	for digits, n := 12-len(prefix), i; digits > 0; digits-- {
		id += string(rune('0' + n%10))
		n /= 10
	}
	return id
}

// A reader renames and removes their own passkeys, and another reader's are
// not found.
func TestDBPasskeyIsRenamedAndRemovedByItsOwnerAlone(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	_, first := env.register(t, ctx, passkeySiteOrigin, "Phone")
	env.register(t, ctx, passkeySiteOrigin, "Laptop")

	renamed, err := env.authClient().RenamePasskey(ctx, &publirav1.RenamePasskeyRequest{Tenant: tenantContext(env.tenant), Id: first.Id, Name: "  Old phone  "})
	if err != nil {
		t.Fatalf("RenamePasskey: %v", err)
	}
	if renamed.Passkey.Name != "Old phone" {
		t.Fatalf("renamed = %q, want the name trimmed", renamed.Passkey.Name)
	}

	stranger := env.PG.SeedEndUser(t, env.tenant.ID, "PKREADER0003", "stranger@example.com", "Stranger")
	strangerCtx := testutil.WithBearer(context.Background(), tokenFor(t, env.tenant, stranger))
	_, err = env.authClient().RenamePasskey(strangerCtx, &publirav1.RenamePasskeyRequest{Tenant: tenantContext(env.tenant), Id: first.Id, Name: "Mine"})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("renaming another reader's passkey code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().DeletePasskey(strangerCtx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: first.Id})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("removing another reader's passkey code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: first.Id}); err != nil {
		t.Fatalf("DeletePasskey: %v", err)
	}
	listed, err := env.authClient().ListMyPasskeys(ctx, &publirav1.ListMyPasskeysRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPasskeys: %v", err)
	}
	if len(listed.Passkeys) != 1 || listed.Passkeys[0].Name != "Laptop" {
		t.Fatalf("passkeys = %+v, want the laptop's alone", listed.Passkeys)
	}
}

// An account with a password may remove every passkey, and one without keeps
// its last, as it keeps its last linked provider.
func TestDBDeletePasskeyKeepsTheLastWayIn(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	_, first := env.register(t, ctx, passkeySiteOrigin, "")
	_, second := env.register(t, ctx, passkeySiteOrigin, "")
	env.dropPassword(t)

	if _, err := env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: first.Id}); err != nil {
		t.Fatalf("DeletePasskey with another passkey left: %v", err)
	}
	_, err := env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: second.Id})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing the last way in code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// A passkey bound to a host the storefront is no longer served on signs
	// nobody in, so it does not count as another way in.
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO user_webauthn_credentials (
			id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, aaguid, backup_eligible, backed_up
		) VALUES ($1, 'DORMANTPK001', $2, $3, 'site', 'old-tenant-a.example.com', '\x01', '\x00', '00000000-0000-0000-0000-000000000000', false, false)
	`, uuid.Must(uuid.NewV7()), env.tenant.ID, env.reader.ID); err != nil {
		t.Fatalf("seed a dormant passkey: %v", err)
	}
	_, err = env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: second.Id})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing the last passkey beside a dormant one code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// An account without a password confirms closing itself with a fresh
// assertion, and one that does not verify is refused without ending the
// session.
func TestDBDeleteMeIsConfirmedByAPasskey(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	authenticator, _ := env.register(t, ctx, passkeySiteOrigin, "")
	env.dropPassword(t)

	stranger := webauthntest.New(t, passkeySiteOrigin)
	stranger.UserHandle = authenticator.UserHandle
	stranger.RPID = passkeySiteRPID
	_, err := env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{
		Tenant:                tenantContext(env.tenant),
		PasskeyCredentialJson: stranger.Assert(t, env.beginConfirmation(t, ctx)),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an assertion of another authenticator code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, passkeyConfirmationField)
	// A sign-in's challenge confirms nothing.
	_, err = env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{
		Tenant:                tenantContext(env.tenant),
		PasskeyCredentialJson: authenticator.Assert(t, env.beginSignIn(t, env.tenant)),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an assertion over a sign-in's challenge code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{
		Tenant:                tenantContext(env.tenant),
		Password:              "anything",
		PasskeyCredentialJson: authenticator.Assert(t, env.beginConfirmation(t, ctx)),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("two confirmations at once code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{
		Tenant:                tenantContext(env.tenant),
		PasskeyCredentialJson: authenticator.Assert(t, env.beginConfirmation(t, ctx)),
	}); err != nil {
		t.Fatalf("DeleteMe confirmed by a passkey: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", env.reader.ID); got != 0 {
		t.Fatalf("accounts = %d, want the account closed", got)
	}
}

// One assertion confirms one email change.
func TestDBRequestEmailChangeIsConfirmedByAPasskey(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	authenticator, _ := env.register(t, ctx, passkeySiteOrigin, "")
	env.dropPassword(t)

	request := func(newEmail, assertion string) error {
		_, err := env.authClient().RequestEmailChange(ctx, &publirav1.RequestEmailChangeRequest{
			Tenant:                tenantContext(env.tenant),
			CurrentEmail:          env.reader.Email,
			NewEmail:              newEmail,
			PasskeyCredentialJson: assertion,
		})
		return err
	}
	assertion := authenticator.Assert(t, env.beginConfirmation(t, ctx))
	if err := request("next@example.com", assertion); err != nil {
		t.Fatalf("RequestEmailChange confirmed by a passkey: %v", err)
	}
	err := request("later@example.com", assertion)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the same assertion again code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, passkeyConfirmationField)
	if got := env.countRows(t, "SELECT count(*) FROM user_email_change_tokens WHERE user_id = $1 AND new_email = 'next@example.com'", env.reader.ID); got != 1 {
		t.Fatalf("email change tokens = %d, want the one the confirmed request made", got)
	}
}

func TestDBBeginPasskeyConfirmationRefusesAReaderWithoutOne(t *testing.T) {
	env := newPasskeyDBEnv(t)
	_, err := env.authClient().BeginPasskeyConfirmation(env.session(t), &publirav1.BeginPasskeyConfirmationRequest{Tenant: tenantContext(env.tenant)})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a confirmation with no passkey code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// A reader who owes an agreement to revised terms may still close their
// account, and one with neither a password nor a linked provider confirms
// that with a passkey, so beginning the assertion is allowed too.
func TestDBDeleteMeIsConfirmedByAPasskeyWhileAnAgreementIsOwed(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	authenticator, _ := env.register(t, ctx, passkeySiteOrigin, "")
	env.dropPassword(t)
	terms := env.PG.SeedPage(t, env.tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, env.tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	nameLegalPages(t, env.publicDBEnv, env.tenant.ID, terms.ID, privacy.ID)
	publishRevision(t, env.publicDBEnv, env.tenant.ID, terms, true)

	_, err := env.authClient().RenamePasskey(ctx, &publirav1.RenamePasskeyRequest{Tenant: tenantContext(env.tenant), Id: "ANYPASSKEY01", Name: "Phone"})
	assertLegalPageAgreementRequired(t, "RenamePasskey", err)
	if _, err := env.authClient().ListMyPasskeys(ctx, &publirav1.ListMyPasskeysRequest{Tenant: tenantContext(env.tenant)}); err != nil {
		t.Fatalf("ListMyPasskeys while an agreement is owed: %v", err)
	}
	if _, err := env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{
		Tenant:                tenantContext(env.tenant),
		PasskeyCredentialJson: authenticator.Assert(t, env.beginConfirmation(t, ctx)),
	}); err != nil {
		t.Fatalf("DeleteMe confirmed by a passkey while an agreement is owed: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", env.reader.ID); got != 0 {
		t.Fatalf("accounts = %d, want the account closed", got)
	}
}

// Beginning a registration or a confirmation, renaming, and removing spend one
// allowance, so alternating them is no way around it.
func TestDBPasskeyChangesChargeThePasskeyLimit(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	env := seedPasskeyReader(t, newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.Passkey = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3}
	})))
	ctx := env.session(t)
	_, passkey := env.register(t, ctx, passkeySiteOrigin, "Phone")
	if _, err := env.authClient().RenamePasskey(ctx, &publirav1.RenamePasskeyRequest{Tenant: tenantContext(env.tenant), Id: passkey.Id, Name: "Old phone"}); err != nil {
		t.Fatalf("RenamePasskey: %v", err)
	}
	env.beginConfirmation(t, ctx)

	for name, call := range map[string]func() error{
		"BeginPasskeyRegistration": func() error {
			_, err := env.authClient().BeginPasskeyRegistration(ctx, &publirav1.BeginPasskeyRegistrationRequest{Tenant: tenantContext(env.tenant)})
			return err
		},
		"RenamePasskey": func() error {
			_, err := env.authClient().RenamePasskey(ctx, &publirav1.RenamePasskeyRequest{Tenant: tenantContext(env.tenant), Id: passkey.Id, Name: "Phone"})
			return err
		},
		"DeletePasskey": func() error {
			_, err := env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: passkey.Id})
			return err
		},
		"BeginPasskeyConfirmation": func() error {
			_, err := env.authClient().BeginPasskeyConfirmation(ctx, &publirav1.BeginPasskeyConfirmationRequest{Tenant: tenantContext(env.tenant)})
			return err
		},
	} {
		if err := call(); connect.CodeOf(err) != connect.CodeResourceExhausted {
			t.Fatalf("%s past the allowance code = %v, want resource_exhausted (err=%v)", name, connect.CodeOf(err), err)
		}
	}
	listed, err := env.authClient().ListMyPasskeys(ctx, &publirav1.ListMyPasskeysRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPasskeys: %v", err)
	}
	if len(listed.Passkeys) != 1 || listed.Passkeys[0].Name != "Old phone" {
		t.Fatalf("passkeys = %+v, want the one renamed before the allowance ran out", listed.Passkeys)
	}
}

// A sign-in ceremony keeps a digest of the origin that began it, which is what
// its open ceremonies are counted by, and no address.
func TestDBPasskeySignInCeremonyKeepsADigestOfItsOrigin(t *testing.T) {
	env := newPasskeyDBEnv(t)
	env.beginSignIn(t, env.tenant)
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE user_id IS NULL AND octet_length(source_digest) = 32"); got != 1 {
		t.Fatalf("sign-in ceremonies with a source digest = %d, want 1", got)
	}
}
