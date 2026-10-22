package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// saveSignUp stores whether the tenant accepts new readers, as the console
// would.
func (e *publicDBEnv) saveSignUp(t *testing.T, tenantID uuid.UUID, open bool, message string) {
	t.Helper()
	if _, err := e.PG.DB.Exec(`
		INSERT INTO tenant_sign_up_settings (tenant_id, sign_up_open, closed_message) VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id) DO UPDATE SET sign_up_open = EXCLUDED.sign_up_open, closed_message = EXCLUDED.closed_message
	`, tenantID, open, message); err != nil {
		t.Fatalf("save the sign-up settings: %v", err)
	}
}

func assertSignUpClosed(t *testing.T, err error) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if reason, _ := errorInfoReason(err); reason != rpcerrors.ReasonSignUpClosed {
		t.Fatalf("reason = %q, want %q (err=%v)", reason, rpcerrors.ReasonSignUpClosed, err)
	}
}

func TestDBCreateUserIsRefusedWhileSignUpIsClosed(t *testing.T) {
	env := newPublicDBEnv(t)
	closed, other := env.seedTwoTenants(t)
	env.saveSignUp(t, closed.ID, false, "Sign-up reopens at launch.")

	assertSignUpClosed(t, env.signUp(closed, "newcomer@example.com"))
	// The refusal says nothing about the address, so a malformed one gets it
	// too rather than a different answer.
	assertSignUpClosed(t, env.signUp(closed, "not an address"))
	// The setting is the tenant's own: another storefront accepts the address.
	if err := env.signUp(other, "newcomer@example.com"); err != nil {
		t.Fatalf("CreateUser at another tenant: %v", err)
	}

	if count := countRows(t, env, `SELECT count(*) FROM outbox_events WHERE tenant_id = $1`, closed.ID); count != 0 {
		t.Fatalf("outbox events at the closed tenant = %d, want nothing recorded to mail", count)
	}
	env.processReaderAuthRequests(t)
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, closed.ID); count != 0 {
		t.Fatalf("accounts at the closed tenant = %d, want 0", count)
	}
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, other.ID); count != 1 {
		t.Fatalf("accounts at the other tenant = %d, want 1", count)
	}
}

// A closed sign-up mails nothing, so it is answered before the mail guard is
// charged and costs the address none of its allowance.
func TestDBCreateUserRefusedWhileSignUpIsClosedSpendsNoMailAllowance(t *testing.T) {
	env := newPublicDBEnvWithMailGuard(t, mailGuardWith(
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 1, PerDay: 1},
	))
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.saveSignUp(t, tenant.ID, false, "")

	for range 3 {
		assertSignUpClosed(t, env.signUp(tenant, "newcomer@example.com"))
	}
	env.saveSignUp(t, tenant.ID, true, "")
	if err := env.signUp(tenant, "newcomer@example.com"); err != nil {
		t.Fatalf("CreateUser once sign-up reopened: %v", err)
	}
}

func TestDBCreateUserOpensAnAccountWhileSignUpIsOpen(t *testing.T) {
	env := newPublicDBEnv(t)
	unsaved, open := env.seedTwoTenants(t)
	// A message kept from an earlier closing does not close anything.
	env.saveSignUp(t, open.ID, true, "Sign-up reopens at launch.")

	for _, tenant := range []testutil.Tenant{unsaved, open} {
		if err := env.signUp(tenant, "newcomer@example.com"); err != nil {
			t.Fatalf("CreateUser at %s: %v", tenant.PublicID, err)
		}
	}
	env.processReaderAuthRequests(t)
	for _, tenant := range []testutil.Tenant{unsaved, open} {
		if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, tenant.ID); count != 1 {
			t.Fatalf("accounts at %s = %d, want 1", tenant.PublicID, count)
		}
	}
}

// The setting is read when a sign-up arrives. One accepted while sign-up was
// open completes after it closes: the worker opens its account, and the link it
// was mailed activates it.
func TestDBSignUpAcceptedWhileOpenCompletesAfterSignUpCloses(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	client := env.authClient()

	if err := env.signUp(tenant, "newcomer@example.com"); err != nil {
		t.Fatalf("CreateUser while open: %v", err)
	}
	env.saveSignUp(t, tenant.ID, false, "")
	env.processReaderAuthRequests(t)

	var token string
	if err := env.PG.DB.QueryRow(`
		SELECT payload ->> 'token' FROM outbox_events
		WHERE tenant_id = $1 AND event_type = 'reader_email_verification_email'
	`, tenant.ID).Scan(&token); err != nil {
		t.Fatalf("read the queued verification link: %v", err)
	}
	verified, err := client.VerifyUserEmail(context.Background(), &publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  token,
	})
	if err != nil {
		t.Fatalf("VerifyUserEmail after sign-up closed: %v", err)
	}
	if !verified.Verified {
		t.Fatal("verified = false, want true")
	}
	if account := readStoredAccount(t, env, "newcomer@example.com"); !account.verified {
		t.Fatal("the account is still unconfirmed after its link was opened")
	}
	if _, err := client.Login(context.Background(), &publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    "newcomer@example.com",
		Password: "newcomer-password",
	}); err != nil {
		t.Fatalf("Login after sign-up closed: %v", err)
	}
}

// A closed sign-up refuses the sign-in that would open an account, and only
// that one: the reader whose provider account is linked, and the reader whose
// account holds the address the provider vouches for, both sign in.
func TestDBLoginWithIdTokenOpensNoAccountWhileSignUpIsClosed(t *testing.T) {
	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	linked := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "linked-subject", "linked@example.com", "nonce-linked"), "nonce-linked")
	member := env.PG.SeedEndUser(t, env.tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.saveSignUp(t, env.tenant.ID, false, "")

	newcomer := env.googleToken(t, "newcomer-subject", "newcomer@example.com", "nonce-newcomer")
	_, err := env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, newcomer, "nonce-newcomer")
	assertSignUpClosed(t, err)
	_, err = env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		env.appleToken(t, "apple-newcomer", "apple-newcomer@example.com", "nonce-apple"), "nonce-apple")
	assertSignUpClosed(t, err)
	if count := countRows(t, env.publicDBEnv, `SELECT count(*) FROM users WHERE tenant_id = $1 AND email IN ('newcomer@example.com', 'apple-newcomer@example.com')`, env.tenant.ID); count != 0 {
		t.Fatalf("accounts opened while closed = %d, want 0", count)
	}

	again := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "linked-subject", "linked@example.com", "nonce-linked-2"), "nonce-linked-2")
	if again.AccountCreated || again.User.PublicId != linked.User.PublicId {
		t.Fatalf("linked sign-in = %+v, want the account opened before closing", again)
	}
	linking := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "member-subject", member.Email, "nonce-member"), "nonce-member")
	if linking.AccountCreated || linking.User.PublicId != member.PublicID {
		t.Fatalf("sign-in to the account holding the address = %+v, want %s", linking, member.PublicID)
	}

	// The refusal left the nonce unspent, so once sign-up reopens the same
	// token opens the account.
	env.saveSignUp(t, env.tenant.ID, true, "")
	if resp := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, newcomer, "nonce-newcomer"); !resp.AccountCreated {
		t.Fatal("account_created = false once sign-up reopened, want true")
	}
}

func TestDBGetTenantAnswersTheSignUpSetting(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, other := env.seedTwoTenants(t)
	client := env.tenantAPIClient()
	read := func(tenant testutil.Tenant) *publirav1.GetTenantResponse {
		t.Helper()
		resp, err := client.GetTenant(context.Background(), &publirav1.GetTenantRequest{Tenant: tenantContext(tenant)})
		if err != nil {
			t.Fatalf("GetTenant: %v", err)
		}
		return resp
	}

	if resp := read(tenant); !resp.SignUpOpen || resp.SignUpClosedMessage != "" {
		t.Fatalf("sign-up of a tenant that saved nothing = %v / %q, want open with no message", resp.SignUpOpen, resp.SignUpClosedMessage)
	}

	env.saveSignUp(t, tenant.ID, false, "Sign-up reopens at launch.")
	if resp := read(tenant); resp.SignUpOpen || resp.SignUpClosedMessage != "Sign-up reopens at launch." {
		t.Fatalf("sign-up = %v / %q, want closed with the tenant's message", resp.SignUpOpen, resp.SignUpClosedMessage)
	}
	if resp := read(other); !resp.SignUpOpen || resp.SignUpClosedMessage != "" {
		t.Fatalf("sign-up of the other tenant = %v / %q, want open with no message", resp.SignUpOpen, resp.SignUpClosedMessage)
	}

	// The message stays stored while sign-up is open, and is not a visitor's.
	env.saveSignUp(t, tenant.ID, true, "Sign-up reopens at launch.")
	if resp := read(tenant); !resp.SignUpOpen || resp.SignUpClosedMessage != "" {
		t.Fatalf("sign-up after reopening = %v / %q, want open with no message", resp.SignUpOpen, resp.SignUpClosedMessage)
	}
}
