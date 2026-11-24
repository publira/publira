package publicapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// refuseEmails stores what a tenant refuses, as the console would.
func (e *publicDBEnv) refuseEmails(t *testing.T, tenantID uuid.UUID, rejectDisposable bool, entries ...string) {
	t.Helper()
	if _, err := e.PG.DB.Exec(`
		INSERT INTO tenant_email_rejection_settings (tenant_id, reject_disposable_domains) VALUES ($1, $2)
	`, tenantID, rejectDisposable); err != nil {
		t.Fatalf("seed the email rejection settings: %v", err)
	}
	for _, entry := range entries {
		if _, err := e.PG.DB.Exec(`
			INSERT INTO tenant_email_rejection_entries (tenant_id, entry) VALUES ($1, $2)
		`, tenantID, entry); err != nil {
			t.Fatalf("seed the email rejection entry %q: %v", entry, err)
		}
	}
}

func (e *publicDBEnv) signUp(tenant testutil.Tenant, email string) error {
	_, err := e.authClient().CreateUser(context.Background(), &publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Newcomer",
		Email:    email,
		Password: "newcomer-password",
	})
	return err
}

func assertEmailRefused(t *testing.T, err error, wantField, wantReason string) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error type = %T, want *connect.Error", err)
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := connectproto.UnmarshalErrorDetail(detail)
		if valueErr != nil {
			continue
		}
		badRequest, ok := value.(*errdetails.BadRequest)
		if !ok || len(badRequest.FieldViolations) != 1 {
			continue
		}
		violation := badRequest.FieldViolations[0]
		if violation.Field != wantField || violation.Reason != wantReason {
			t.Fatalf("field violation = %s/%s, want %s/%s", violation.Field, violation.Reason, wantField, wantReason)
		}
		return
	}
	t.Fatalf("no field violation on %v", err)
}

func TestDBCreateUserRefusesAnAddressOrDomainTheTenantLists(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant, other := env.seedTwoTenants(t)
	env.refuseEmails(t, tenant.ID, false, "john@example.com", "blocked.example")

	for _, email := range []string{
		"john@example.com",
		"John@Example.com",
		// The tag is dropped for the comparison, so a refused mailbox does not
		// come back with one added.
		"john+2@example.com",
		"reader@blocked.example",
		"reader@mail.blocked.example",
		// A quoted local part holding an @ is still on the listed domain.
		`"a@b"@blocked.example`,
	} {
		t.Run(email, func(t *testing.T) {
			assertEmailRefused(t, env.signUp(tenant, email), "email", rpcerrors.FieldReasonEmailRefused)
		})
	}

	accepted := []string{
		"reader@unlisted.example",
		// A different mailbox on a domain that is not listed keeps its tag.
		"jane+news@example.com",
	}
	for _, email := range accepted {
		if err := env.signUp(tenant, email); err != nil {
			t.Fatalf("CreateUser(%q): %v", email, err)
		}
	}
	// The list is the tenant's own: another storefront accepts the address.
	if err := env.signUp(other, "john@example.com"); err != nil {
		t.Fatalf("CreateUser at another tenant: %v", err)
	}
	env.processReaderAuthRequests(t)

	if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, tenant.ID); count != len(accepted) {
		t.Fatalf("accounts = %d, want only the %d accepted sign-ups", count, len(accepted))
	}
	// The address is stored as typed, tag and all.
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1 AND email = $2`, tenant.ID, "jane+news@example.com"); count != 1 {
		t.Fatalf("accounts stored as jane+news@example.com = %d, want 1", count)
	}
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1 AND email = $2`, other.ID, "john@example.com"); count != 1 {
		t.Fatalf("accounts at the other tenant = %d, want 1", count)
	}
}

// A refusal rests on the address alone, so it is answered before the mail
// guard is charged: a refused address costs the caller no allowance.
func TestDBCreateUserRefusalSpendsNoMailAllowance(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnvWithMailGuard(t, mailGuardWith(
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 1, PerDay: 1},
	))
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.refuseEmails(t, tenant.ID, false, "blocked.example")

	for range 3 {
		assertEmailRefused(t, env.signUp(tenant, "reader@blocked.example"), "email", rpcerrors.FieldReasonEmailRefused)
	}
	if err := env.signUp(tenant, "reader@tenant-a.example.com"); err != nil {
		t.Fatalf("CreateUser after the refusals: %v", err)
	}
}

func TestDBCreateUserRefusesADisposableDomainOnlyWhileTheTenantSwitchesTheListOn(t *testing.T) {
	t.Parallel()

	list := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("throwaway.example\n"))
	}))
	t.Cleanup(list.Close)
	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.DisposableEmailDomainsURL = list.URL
	}))
	on, off := env.seedTwoTenants(t)
	env.refuseEmails(t, on.ID, true)
	env.refuseEmails(t, off.ID, false)

	assertEmailRefused(t, env.signUp(on, "reader@throwaway.example"), "email", rpcerrors.FieldReasonEmailDisposableDomain)
	assertEmailRefused(t, env.signUp(on, "reader@mail.throwaway.example"), "email", rpcerrors.FieldReasonEmailDisposableDomain)
	if err := env.signUp(on, "reader@example.com"); err != nil {
		t.Fatalf("CreateUser on a domain the list does not name: %v", err)
	}
	if err := env.signUp(off, "reader@throwaway.example"); err != nil {
		t.Fatalf("CreateUser with the list switched off: %v", err)
	}
}

// With the switch on and no list named by the platform, nothing is refused.
func TestDBCreateUserRefusesNoDisposableDomainWithoutAList(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.refuseEmails(t, tenant.ID, true)

	if err := env.signUp(tenant, "reader@throwaway.example"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
}

func TestDBRequestEmailChangeRefusesAnAddressTheTenantRefuses(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, member)
	env.refuseEmails(t, tenant.ID, false, "blocked.example", "john@example.com")

	requestChange := func(newEmail string) error {
		_, err := env.authClient().RequestEmailChange(testutil.WithBearer(context.Background(), token), &publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    member.Email,
			NewEmail:        newEmail,
			CurrentPassword: testutil.SeededPassword,
		})
		return err
	}

	assertEmailRefused(t, requestChange("moved@blocked.example"), "new_email", rpcerrors.FieldReasonEmailRefused)
	assertEmailRefused(t, requestChange("john+moved@example.com"), "new_email", rpcerrors.FieldReasonEmailRefused)
	if count := countRows(t, env, `SELECT count(*) FROM user_email_change_tokens WHERE user_id = $1`, member.ID); count != 0 {
		t.Fatalf("email change requests after the refusals = %d, want 0", count)
	}

	if err := requestChange("moved@tenant-a.example.com"); err != nil {
		t.Fatalf("RequestEmailChange to an accepted address: %v", err)
	}
}

// A provider sign-in that would open an account is refused for the address
// CreateUser refuses, and only that one: the reader whose provider account is
// linked, and the reader whose account holds a refused address, both sign in.
func TestDBLoginWithIdTokenOpensNoAccountForAnAddressTheTenantRefuses(t *testing.T) {
	t.Parallel()

	env := newIdentityDBEnv(t)
	env.enableProviders(t)
	linked := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "linked-subject", "linked@blocked.example", "nonce-linked"), "nonce-linked")
	member := env.PG.SeedEndUser(t, env.tenant.ID, "ENDUSERA0001", "member@blocked.example", "Member")
	env.refuseEmails(t, env.tenant.ID, false, "john@example.com", "blocked.example")

	refused := []struct {
		name     string
		provider publirav1.IdentityProvider
		token    func(t *testing.T, nonce string) string
	}{
		{name: "listed address through Google", provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token: func(t *testing.T, nonce string) string {
			return env.googleToken(t, "john-google", "John@Example.com", nonce)
		}},
		{name: "listed address under a tag through Apple", provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE, token: func(t *testing.T, nonce string) string {
			return env.appleToken(t, "john-apple", "john+again@example.com", nonce)
		}},
		{name: "listed domain", provider: publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE, token: func(t *testing.T, nonce string) string {
			return env.googleToken(t, "newcomer-google", "newcomer@mail.blocked.example", nonce)
		}},
	}
	for i, tc := range refused {
		nonce := fmt.Sprintf("nonce-refused-%d", i)
		t.Run(tc.name, func(t *testing.T) {
			_, err := env.signIn(tc.provider, tc.token(t, nonce), nonce)
			assertEmailRefused(t, err, "id_token", rpcerrors.FieldReasonEmailRefused)
		})
	}
	if count := countRows(t, env.publicDBEnv, `SELECT count(*) FROM users WHERE tenant_id = $1`, env.tenant.ID); count != 2 {
		t.Fatalf("accounts = %d, want only the linked reader and the member", count)
	}
	if count := countRows(t, env.publicDBEnv, `SELECT count(*) FROM user_identities WHERE tenant_id = $1`, env.tenant.ID); count != 1 {
		t.Fatalf("linked provider accounts = %d, want only the one linked before the refusal", count)
	}

	again := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "linked-subject", "linked@blocked.example", "nonce-linked-2"), "nonce-linked-2")
	if again.AccountCreated || again.User.PublicId != linked.User.PublicId {
		t.Fatalf("linked sign-in = %+v, want the account opened before the refusal", again)
	}
	linking := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE,
		env.appleToken(t, "member-subject", member.Email, "nonce-member"), "nonce-member")
	if linking.AccountCreated || linking.User.PublicId != member.PublicID {
		t.Fatalf("sign-in to the account holding the address = %+v, want %s", linking, member.PublicID)
	}
}

func TestDBLoginWithIdTokenOpensNoAccountOnADisposableDomain(t *testing.T) {
	t.Parallel()

	list := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("throwaway.example\n"))
	}))
	t.Cleanup(list.Close)
	env := newIdentityDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.DisposableEmailDomainsURL = list.URL
	}), openMailGuard())
	env.enableProviders(t)
	env.refuseEmails(t, env.tenant.ID, true)

	_, err := env.signIn(publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "throwaway-subject", "reader@throwaway.example", "nonce-throwaway"), "nonce-throwaway")
	assertEmailRefused(t, err, "id_token", rpcerrors.FieldReasonEmailDisposableDomain)
	if count := countRows(t, env.publicDBEnv, `SELECT count(*) FROM users WHERE tenant_id = $1`, env.tenant.ID); count != 0 {
		t.Fatalf("accounts = %d, want 0", count)
	}

	if resp := env.mustSignIn(t, publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE,
		env.googleToken(t, "reader-subject", "reader@example.com", "nonce-reader"), "nonce-reader"); !resp.AccountCreated {
		t.Fatal("account_created = false on a domain the list does not name, want true")
	}
}
