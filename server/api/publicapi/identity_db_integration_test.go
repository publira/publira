package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/signin/signintest"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	identityWebClientID = "123-web.apps.googleusercontent.com"
	identityServicesID  = "com.example.tenant-a.web"
	identityBundleID    = "com.example.tenant-a"
)

// identityDBEnv is a storefront whose readers sign in with the two fake
// providers, and the Apple token endpoints the worker would call.
type identityDBEnv struct {
	*publicDBEnv
	apple, google *signintest.Provider
	appleTokens   *signintest.AppleTokens
	encryptor     signin.SecretManager
	tenant        testutil.Tenant
}

func newIdentityDBEnv(t *testing.T) *identityDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPublicDB(t)
	encryptor := newPublicTestEncryptor(t)
	apple, google := signintest.NewProvider(t), signintest.NewProvider(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.idTokens = signintest.Verifier(apple, google)
	httpServer := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(httpServer.Close)

	env := &identityDBEnv{
		publicDBEnv: &publicDBEnv{Server: httpServer, PG: pg},
		apple:       apple,
		google:      google,
		appleTokens: &signintest.AppleTokens{RefreshToken: "apple-refresh-token"},
		encryptor:   encryptor,
	}
	env.tenant = env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	return env
}

// enableProviders turns on Google with its web client and Apple with its
// Services ID and a key.
func (e *identityDBEnv) enableProviders(t *testing.T) {
	t.Helper()
	e.saveSignInSettings(t, signin.UpdateInput{
		Apple: signin.AppleUpdate{
			Enabled:              true,
			ServicesID:           identityServicesID,
			TeamID:               "TEAM123456",
			KeyID:                "KEY1234567",
			PrivateKey:           signintest.PrivateKeyPEM(t),
			PrivateKeyUpdateMode: secretupdate.Replace,
		},
		Google: signin.GoogleUpdate{Enabled: true, WebClientID: identityWebClientID},
	})
}

func (e *identityDBEnv) saveSignInSettings(t *testing.T, input signin.UpdateInput) {
	t.Helper()
	if _, err := signin.NewSettings(dbmodels.New(e.PG.DB), e.encryptor).Update(context.Background(), e.tenant.ID, input); err != nil {
		t.Fatalf("save sign-in settings: %v", err)
	}
}

func (e *identityDBEnv) googleToken(t *testing.T, subject, email, nonce string) string {
	t.Helper()
	return e.google.Sign(t, signintest.Token{
		Issuer:   signin.GoogleIssuer,
		Subject:  subject,
		Audience: identityWebClientID,
		Email:    email,
		Name:     "Google Reader",
		Nonce:    nonce,
	})
}

func (e *identityDBEnv) appleToken(t *testing.T, subject, email, nonce string) string {
	t.Helper()
	return e.apple.Sign(t, signintest.Token{
		Issuer:        signin.AppleIssuer,
		Subject:       subject,
		Audience:      identityServicesID,
		Email:         email,
		EmailVerified: "true",
		Nonce:         nonce,
	})
}

func (e *identityDBEnv) signIn(provider publirav1.IdentityProvider, idToken, nonce string, edit ...func(*publirav1.LoginWithIdTokenRequest)) (*publirav1.LoginWithIdTokenResponse, error) {
	req := &publirav1.LoginWithIdTokenRequest{
		Tenant:   tenantContext(e.tenant),
		Provider: provider,
		IdToken:  idToken,
		Nonce:    nonce,
	}
	for _, apply := range edit {
		apply(req)
	}
	resp, err := e.authClient().LoginWithIdToken(context.Background(), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (e *identityDBEnv) mustSignIn(t *testing.T, provider publirav1.IdentityProvider, idToken, nonce string, edit ...func(*publirav1.LoginWithIdTokenRequest)) *publirav1.LoginWithIdTokenResponse {
	t.Helper()
	resp, err := e.signIn(provider, idToken, nonce, edit...)
	if err != nil {
		t.Fatalf("LoginWithIdToken: %v", err)
	}
	return resp
}

func (e *identityDBEnv) userByEmail(t *testing.T, email string) dbmodels.User {
	t.Helper()
	user, err := dbmodels.New(e.PG.DB).GetUserByEmailForTenant(context.Background(), dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: e.tenant.ID, Valid: true},
		Email:    email,
	})
	if err != nil {
		t.Fatalf("read the account of %s: %v", email, err)
	}
	return user
}

func (e *identityDBEnv) processAppleEvents(t *testing.T) {
	t.Helper()
	cfg := outbox.AppleSignInHandlerConfig{DB: e.PG.OpenOutboxDB(t), Encryptor: e.encryptor, Tokens: e.appleTokens}
	e.PG.ProcessPendingOutboxEvents(t, map[string]func(context.Context, dbmodels.OutboxEvent) error{
		outbox.EventTypeAppleSignInCodeExchange: outbox.NewAppleSignInCodeExchangeHandler(cfg),
		outbox.EventTypeAppleSignInTokenRevoke:  outbox.NewAppleSignInTokenRevokeHandler(cfg),
	})
}

func TestDBLoginWithIdTokenCreatesAnAccountAndFindsItAgain(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)

	first := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "newcomer@example.com", "nonce-1"), "nonce-1")
	if !first.AccountCreated {
		t.Fatal("account_created = false on the first sign-in, want true")
	}
	if first.User.Name != "Google Reader" || first.User.Email != "newcomer@example.com" {
		t.Fatalf("user = %+v, want the name and address the token carried", first.User)
	}
	created := env.userByEmail(t, "newcomer@example.com")
	if !created.EmailVerifiedAt.Valid || created.PasswordHash.Valid || created.Status != "active" {
		t.Fatalf("created account = %+v, want an active, verified account without a password", created)
	}
	me, err := env.authClient().GetMe(context.Background(), newBearerRequest(&publirav1.GetMeRequest{Tenant: tenantContext(env.tenant)}, first.AccessToken.Token))
	if err != nil {
		t.Fatalf("GetMe with the sign-in token: %v", err)
	}
	if me.Msg.User.PublicId != first.User.PublicId {
		t.Fatalf("GetMe public_id = %q, want %q", me.Msg.User.PublicId, first.User.PublicId)
	}

	// The provider may carry another address by now; the link is what finds
	// the account.
	again := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "renamed@example.com", "nonce-2"), "nonce-2")
	if again.AccountCreated || again.User.PublicId != first.User.PublicId {
		t.Fatalf("second sign-in = %+v, want the account the first created", again)
	}
}

func TestDBLoginWithIdTokenRefusesAReplayedNonce(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	token := env.googleToken(t, "google-subject", "reader@example.com", "only-once")
	env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token, "only-once")

	_, err := env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token, "only-once")
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("replayed sign-in code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	// A fresh token carrying a spent nonce is a replay too.
	_, err = env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "reader@example.com", "only-once"), "only-once")
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("sign-in with a spent nonce code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBLoginWithIdTokenRefusesAProviderTheTenantHasNotEnabled(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.saveSignInSettings(t, signin.UpdateInput{
		Google: signin.GoogleUpdate{Enabled: false, WebClientID: identityWebClientID},
	})

	for _, tc := range []struct {
		name     string
		provider publirav1.IdentityProvider
		token    string
	}{
		{name: "google switched off", provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token: env.googleToken(t, "g", "reader@example.com", "nonce-g")},
		{name: "apple never saved", provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE, token: env.appleToken(t, "a", "reader@example.com", "nonce-a")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			nonce := "nonce-g"
			if tc.provider == publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE {
				nonce = "nonce-a"
			}
			_, err := env.signIn(tc.provider, tc.token, nonce)
			if connect.CodeOf(err) != connect.CodeFailedPrecondition {
				t.Fatalf("sign-in code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

func TestDBLoginWithIdTokenLinksTheAccountHoldingTheVouchedAddress(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	member := env.PG.SeedEndUser(t, env.tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	resp := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", member.Email, "nonce-1"), "nonce-1")
	if resp.AccountCreated || resp.User.PublicId != member.PublicID {
		t.Fatalf("sign-in = %+v, want the existing account %s", resp, member.PublicID)
	}
	// The owner's password keeps working beside the link.
	if _, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(env.tenant),
		Email:    member.Email,
		Password: testutil.SeededPassword,
	})); err != nil {
		t.Fatalf("Login with the password after linking: %v", err)
	}
}

// Whoever registered an address nobody confirmed may not own it, so the
// provider's owner takes the account over and the password set for it goes.
func TestDBLoginWithIdTokenTakesOverAnAccountNobodyConfirmed(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	squatter := env.PG.SeedEndUser(t, env.tenant.ID, "ENDUSERA0001", "victim@example.com", "Squatter")
	if _, err := env.PG.DB.Exec(`UPDATE users SET email_verified_at = NULL, status = 'inactive' WHERE id = $1`, squatter.ID); err != nil {
		t.Fatalf("unverify the account: %v", err)
	}

	resp := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "victim@example.com", "nonce-1"), "nonce-1")
	if resp.User.PublicId != squatter.PublicID {
		t.Fatalf("signed in as %s, want the account holding the address", resp.User.PublicId)
	}
	taken := env.userByEmail(t, "victim@example.com")
	if taken.PasswordHash.Valid || !taken.EmailVerifiedAt.Valid || taken.Status != "active" {
		t.Fatalf("account = %+v, want it active, verified, and without the squatter's password", taken)
	}
	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(env.tenant),
		Email:    "victim@example.com",
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login with the squatter's password code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestDBLoginWithIdTokenRefusesAnAddressTheProviderDoesNotVouchFor(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	token := env.google.Sign(t, signintest.Token{
		Issuer:        signin.GoogleIssuer,
		Subject:       "google-subject",
		Audience:      identityWebClientID,
		Email:         "unverified@example.com",
		EmailVerified: false,
		Nonce:         "nonce-1",
	})

	_, err := env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token, "nonce-1")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("sign-in code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := dbmodels.New(env.PG.DB).GetUserByEmailForTenant(context.Background(), dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: env.tenant.ID, Valid: true},
		Email:    "unverified@example.com",
	}); err != sql.ErrNoRows {
		t.Fatalf("account for the unvouched address err = %v, want none", err)
	}
}

// A first sign-in without the consent the tenant asks for is refused without
// spending its nonce, so the reader agrees and the client sends the same token.
func TestDBLoginWithIdTokenAsksForConsentBeforeCreatingAnAccount(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	terms := env.PG.SeedPage(t, env.tenant.ID, testutil.PageSeed{Slug: "terms", Title: "Terms", Published: true})
	privacy := env.PG.SeedPage(t, env.tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy", Published: true})
	nameLegalPages(t, env.publicDBEnv, env.tenant.ID, terms.ID, privacy.ID)
	token := env.googleToken(t, "google-subject", "newcomer@example.com", "nonce-1")

	_, err := env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token, "nonce-1")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("sign-in without consent code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	resp := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token, "nonce-1", func(req *publirav1.LoginWithIdTokenRequest) {
		req.AgreedPageVersionIds = []string{terms.VersionID.String(), privacy.VersionID.String()}
	})
	if !resp.AccountCreated {
		t.Fatal("account_created = false, want true")
	}
	if got := agreedVersions(t, env.publicDBEnv, "newcomer@example.com"); !got[terms.VersionID] || !got[privacy.VersionID] {
		t.Fatalf("consents = %v, want both pages", got)
	}
}

func TestDBUnlinkIdentityKeepsTheLastWayIn(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	signedIn := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "reader@example.com", "nonce-1"), "nonce-1")
	token := signedIn.AccessToken.Token
	client := env.authClient()

	_, err := client.UnlinkIdentity(context.Background(), newBearerRequest(&publirav1.UnlinkIdentityRequest{
		Tenant:   tenantContext(env.tenant),
		Provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
	}, token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("unlinking the only way in code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// With Apple linked as well, Google may go.
	env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		env.appleToken(t, "apple-subject", "reader@example.com", "nonce-2"), "nonce-2")
	listed, err := client.ListMyIdentities(context.Background(), newBearerRequest(&publirav1.ListMyIdentitiesRequest{Tenant: tenantContext(env.tenant)}, token))
	if err != nil {
		t.Fatalf("ListMyIdentities: %v", err)
	}
	if len(listed.Msg.Identities) != 2 || listed.Msg.Identities[0].Provider != publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE || listed.Msg.Identities[1].Email != "reader@example.com" {
		t.Fatalf("identities = %+v, want apple and google", listed.Msg.Identities)
	}
	if _, err := client.UnlinkIdentity(context.Background(), newBearerRequest(&publirav1.UnlinkIdentityRequest{
		Tenant:   tenantContext(env.tenant),
		Provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
	}, token)); err != nil {
		t.Fatalf("UnlinkIdentity with another way in: %v", err)
	}
	_, err = client.UnlinkIdentity(context.Background(), newBearerRequest(&publirav1.UnlinkIdentityRequest{
		Tenant:   tenantContext(env.tenant),
		Provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
	}, token))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unlinking a provider not linked code = %v, want not_found", connect.CodeOf(err))
	}
}

// The authorization code an Apple sign-in carries becomes a refresh token the
// link keeps, and that token is revoked when the account goes.
func TestDBAppleSignInKeepsTheRefreshTokenAndRevokesItWithTheAccount(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	signedIn := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		env.appleToken(t, "apple-subject", "relay@privaterelay.appleid.com", "nonce-1"), "nonce-1",
		func(req *publirav1.LoginWithIdTokenRequest) {
			req.AuthorizationCode = "apple-code"
			req.RedirectUri = "https://tenant-a.example.com/auth/apple/callback"
			req.Name = "Apple Reader"
		})
	if signedIn.User.Name != "Apple Reader" {
		t.Fatalf("name = %q, want the one the client sent", signedIn.User.Name)
	}
	env.processAppleEvents(t)

	exchanges := env.appleTokens.Exchanges()
	if len(exchanges) != 1 || exchanges[0].Code != "apple-code" || exchanges[0].ClientID != identityServicesID ||
		exchanges[0].RedirectURI != "https://tenant-a.example.com/auth/apple/callback" || exchanges[0].Credentials.TeamID != "TEAM123456" {
		t.Fatalf("exchanges = %+v", exchanges)
	}
	user := env.userByEmail(t, "relay@privaterelay.appleid.com")
	identity, err := dbmodels.New(env.PG.DB).GetUserIdentityForUser(context.Background(), dbmodels.GetUserIdentityForUserParams{
		TenantID: env.tenant.ID,
		UserID:   user.ID,
		Provider: signin.ProviderApple,
	})
	if err != nil {
		t.Fatalf("read the link: %v", err)
	}
	if identity.RefreshTokenEncrypted.String == "" || identity.RefreshTokenEncrypted.String == "apple-refresh-token" {
		t.Fatalf("stored refresh token = %q, want it sealed", identity.RefreshTokenEncrypted.String)
	}

	// The account has no password, so a fresh Apple sign-in confirms the
	// deletion.
	_, err = env.authClient().DeleteMe(context.Background(), newBearerRequest(&publirav1.DeleteMeRequest{
		Tenant:   tenantContext(env.tenant),
		Provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		IdToken:  env.appleToken(t, "another-subject", "relay@privaterelay.appleid.com", "nonce-2"),
		Nonce:    "nonce-2",
	}, signedIn.AccessToken.Token))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeleteMe confirmed by another Apple account code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if _, err := env.authClient().DeleteMe(context.Background(), newBearerRequest(&publirav1.DeleteMeRequest{
		Tenant:   tenantContext(env.tenant),
		Provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		IdToken:  env.appleToken(t, "apple-subject", "relay@privaterelay.appleid.com", "nonce-3"),
		Nonce:    "nonce-3",
	}, signedIn.AccessToken.Token)); err != nil {
		t.Fatalf("DeleteMe: %v", err)
	}
	env.processAppleEvents(t)

	revocations := env.appleTokens.Revocations()
	if len(revocations) != 1 || revocations[0].RefreshToken != "apple-refresh-token" || revocations[0].ClientID != identityServicesID {
		t.Fatalf("revocations = %+v, want the stored refresh token", revocations)
	}
}

// GetTenant answers the providers a client can offer, with the client IDs it
// signs in through, and nothing of the key.
func TestDBGetTenantAnswersTheProvidersReadersCanSignInWith(t *testing.T) {
	env := newIdentityDBEnv(t)
	tenantClient := env.tenantAPIClient()

	resp, err := tenantClient.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{Tenant: tenantContext(env.tenant)}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.AppleSignIn != nil || resp.Msg.GoogleSignIn != nil {
		t.Fatalf("providers of a tenant that saved none = %v / %v, want none", resp.Msg.AppleSignIn, resp.Msg.GoogleSignIn)
	}

	env.enableProviders(t)
	resp, err = tenantClient.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{Tenant: tenantContext(env.tenant)}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.AppleSignIn.GetServicesId() != identityServicesID || resp.Msg.GoogleSignIn.GetWebClientId() != identityWebClientID {
		t.Fatalf("providers = %v / %v", resp.Msg.AppleSignIn, resp.Msg.GoogleSignIn)
	}
}
