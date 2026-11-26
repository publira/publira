package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

// Adding a passkey, removing one, and unlinking a provider each change how the
// account is signed in to, so each asks for the account's confirmation on top
// of the session, and each tells the account's address once it is done.

// signInMethodNotices counts the notices queued for userID about change.
func signInMethodNotices(t *testing.T, env *publicDBEnv, userID, change string) int {
	t.Helper()
	return env.countRows(t, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_sign_in_method_changed_notice_email'
		AND payload ->> 'user_id' = $1
		AND payload ->> 'change' = $2
	`, userID, change)
}

func TestDBBeginPasskeyRegistrationAsksForTheAccountFirst(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	begin := func(req *publirav1.BeginPasskeyRegistrationRequest) error {
		req.Tenant = tenantContext(env.tenant)
		_, err := env.authClient().BeginPasskeyRegistration(ctx, req)
		return err
	}
	ceremonies := func() int {
		return env.countRows(t, "SELECT count(*) FROM user_webauthn_ceremonies WHERE user_id = $1 AND ceremony = 'registration'", env.reader.ID)
	}

	err := begin(&publirav1.BeginPasskeyRegistrationRequest{})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a registration on the session alone code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	err = begin(&publirav1.BeginPasskeyRegistrationRequest{Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a registration with a wrong password code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "password")
	if got := ceremonies(); got != 0 {
		t.Fatalf("registration ceremonies = %d, want none begun without a confirmation", got)
	}

	// A passkey the account holds confirms the next one, once.
	authenticator, _ := env.register(t, ctx, passkeySiteOrigin, "Phone")
	assertion := authenticator.Assert(t, env.beginConfirmation(t, ctx))
	if err := begin(&publirav1.BeginPasskeyRegistrationRequest{PasskeyCredentialJson: assertion}); err != nil {
		t.Fatalf("BeginPasskeyRegistration confirmed by a passkey: %v", err)
	}
	err = begin(&publirav1.BeginPasskeyRegistrationRequest{PasskeyCredentialJson: assertion})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the same assertion again code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, passkeyConfirmationField)
}

func TestDBFinishPasskeyRegistrationTellsTheAccountsAddress(t *testing.T) {
	env := newPasskeyDBEnv(t)
	env.register(t, env.session(t), passkeySiteOrigin, "Phone")
	env.register(t, env.session(t), passkeySiteOrigin, "Laptop")

	if got := signInMethodNotices(t, env.publicDBEnv, env.reader.ID.String(), "passkey_added"); got != 2 {
		t.Fatalf("passkey added notices = %d, want one per passkey", got)
	}
}

func TestDBDeletePasskeyAsksForTheAccountFirst(t *testing.T) {
	env := newPasskeyDBEnv(t)
	ctx := env.session(t)
	authenticator, passkey := env.register(t, ctx, passkeySiteOrigin, "Phone")
	remove := func(req *publirav1.DeletePasskeyRequest) error {
		req.Tenant = tenantContext(env.tenant)
		_, err := env.authClient().DeletePasskey(ctx, req)
		return err
	}
	held := func() int {
		return env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", env.reader.ID)
	}

	err := remove(&publirav1.DeletePasskeyRequest{Id: passkey.Id})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a removal on the session alone code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	err = remove(&publirav1.DeletePasskeyRequest{Id: passkey.Id, Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a removal with a wrong password code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "password")
	if got := held(); got != 1 {
		t.Fatalf("passkeys = %d, want the passkey kept", got)
	}

	// A removal that is refused spends nothing, so the same assertion confirms
	// the one that follows.
	assertion := authenticator.Assert(t, env.beginConfirmation(t, ctx))
	err = remove(&publirav1.DeletePasskeyRequest{Id: "NOSUCHPASSKY", PasskeyCredentialJson: assertion})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("removing a passkey that is not there code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if err := remove(&publirav1.DeletePasskeyRequest{Id: passkey.Id, PasskeyCredentialJson: assertion}); err != nil {
		t.Fatalf("DeletePasskey confirmed by the passkey it removes: %v", err)
	}
	if got := held(); got != 0 {
		t.Fatalf("passkeys = %d, want the passkey removed", got)
	}
	if got := signInMethodNotices(t, env.publicDBEnv, env.reader.ID.String(), "passkey_removed"); got != 1 {
		t.Fatalf("passkey removed notices = %d, want 1", got)
	}
}

// A password guessed through the new confirmations is charged against the
// allowance the other step-up checks spend, so they add no guesses of their own.
func TestDBPasskeyConfirmationsShareTheStepUpPasswordLimit(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	env := seedPasskeyReader(t, newStepUpLimitedEnv(t, 2))
	ctx := env.session(t)
	_, passkey := env.register(t, ctx, passkeySiteOrigin, "Phone")

	_, err := env.authClient().BeginPasskeyRegistration(ctx, &publirav1.BeginPasskeyRegistrationRequest{Tenant: tenantContext(env.tenant), Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the first guess, through BeginPasskeyRegistration, code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().DeletePasskey(ctx, &publirav1.DeletePasskeyRequest{Tenant: tenantContext(env.tenant), Id: passkey.Id, Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the second guess, through DeletePasskey, code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	_, err = env.authClient().DeleteMe(ctx, &publirav1.DeleteMeRequest{Tenant: tenantContext(env.tenant), Password: testutil.SeededPassword})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("DeleteMe past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUnlinkIdentityAsksForTheAccountFirst(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	signedIn := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "google-subject", "reader@example.com", "nonce-1"), "nonce-1")
	ctx := testutil.WithBearer(context.Background(), signedIn.AccessToken.Token)
	passwordHash, err := auth.HashPassword(testutil.SeededPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE users SET password_hash = $1 WHERE public_id = $2", passwordHash, signedIn.User.PublicId); err != nil {
		t.Fatalf("give the account a password: %v", err)
	}
	unlink := func(req *publirav1.UnlinkIdentityRequest) error {
		req.Tenant = tenantContext(env.tenant)
		req.Provider = publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE
		_, err := env.authClient().UnlinkIdentity(ctx, req)
		return err
	}
	linked := func() int {
		return env.countRows(t, "SELECT count(*) FROM user_identities WHERE subject = 'google-subject'")
	}

	err = unlink(&publirav1.UnlinkIdentityRequest{})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unlink on the session alone code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	err = unlink(&publirav1.UnlinkIdentityRequest{Password: "not-the-password"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unlink with a wrong password code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "password")
	err = unlink(&publirav1.UnlinkIdentityRequest{
		ConfirmationProvider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		IdToken:              env.googleToken(t, "another-subject", "reader@example.com", "confirm-1"),
		Nonce:                "confirm-1",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unlink confirmed by another provider account code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if got := linked(); got != 1 {
		t.Fatalf("links = %d, want the link kept", got)
	}

	if err := unlink(&publirav1.UnlinkIdentityRequest{Password: testutil.SeededPassword}); err != nil {
		t.Fatalf("UnlinkIdentity confirmed by the password: %v", err)
	}
	if got := linked(); got != 0 {
		t.Fatalf("links = %d, want the link removed", got)
	}
	notices := env.countRows(t, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_sign_in_method_changed_notice_email'
		AND payload ->> 'change' = 'identity_unlinked'
		AND payload ->> 'provider' = 'google'
	`)
	if notices != 1 {
		t.Fatalf("provider unlinked notices = %d, want 1", notices)
	}
}
