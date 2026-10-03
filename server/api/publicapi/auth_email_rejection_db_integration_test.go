package publicapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
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
	_, err := e.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Newcomer",
		Email:    email,
		Password: "newcomer-password",
	}))
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
		value, valueErr := detail.Value()
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
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.refuseEmails(t, tenant.ID, true)

	if err := env.signUp(tenant, "reader@throwaway.example"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
}

func TestDBRequestEmailChangeRefusesAnAddressTheTenantRefuses(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, member)
	env.refuseEmails(t, tenant.ID, false, "blocked.example", "john@example.com")

	requestChange := func(newEmail string) error {
		_, err := env.authClient().RequestEmailChange(context.Background(), newBearerRequest(
			&publirav1.RequestEmailChangeRequest{
				Tenant:          tenantContext(tenant),
				CurrentEmail:    member.Email,
				NewEmail:        newEmail,
				CurrentPassword: testutil.SeededPassword,
			},
			token,
		))
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
