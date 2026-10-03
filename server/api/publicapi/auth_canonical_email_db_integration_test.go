package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// An address that differs from an account's only by its sub-address tag
// reaches that account's inbox, so a tenant treats it as the account's address
// wherever an address enters an account. These cases drive the forms that do
// so against a real database.

// A sign-up with a tagged variant of a registered address is answered exactly
// as one with the address itself, opens nothing, and leaves the notice for the
// address it typed: trying tags must not become a way to learn which addresses
// are registered.
func TestDBCreateUserForATaggedVariantAnswersLikeTheRegisteredAddress(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "john@tenant-a.example.com", "John")

	for _, email := range []string{member.Email, "john+2@tenant-a.example.com"} {
		resp, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
			Tenant:   tenantContext(tenant),
			Name:     "Second John",
			Email:    email,
			Password: "another-password",
		}))
		if err != nil {
			t.Fatalf("CreateUser %s: %v", email, err)
		}
		if !resp.Msg.Accepted {
			t.Fatalf("CreateUser %s accepted = false, want the answer every sign-up gets", email)
		}
	}
	env.processReaderAuthRequests(t)

	if accounts := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, tenant.ID); accounts != 1 {
		t.Fatalf("accounts = %d, want only the one already there", accounts)
	}
	if notices := countRows(t, env, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_signup_attempt_notice_email'
			AND payload ->> 'user_id' = $1
			AND payload ->> 'email' = 'john+2@tenant-a.example.com'
	`, member.ID.String()); notices != 1 {
		t.Fatalf("notices to the tagged address = %d, want 1", notices)
	}
}

// mail.ParseAddress accepts a display name around the address. The account is
// opened with the address alone and compared on it, so a display name is not
// a way to open a second account for an inbox, nor a way to store one.
func TestDBCreateUserStoresTheAddressWithoutItsDisplayName(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "john@tenant-a.example.com", "John")

	for _, email := range []string{"John <john+2@tenant-a.example.com>", "Jane <jane@tenant-a.example.com>"} {
		if _, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
			Tenant:   tenantContext(tenant),
			Name:     "Newcomer",
			Email:    email,
			Password: "another-password",
		})); err != nil {
			t.Fatalf("CreateUser %s: %v", email, err)
		}
	}
	env.processReaderAuthRequests(t)

	if accounts := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1`, tenant.ID); accounts != 2 {
		t.Fatalf("accounts = %d, want the one already there and jane's", accounts)
	}
	if jane := countRows(t, env, `SELECT count(*) FROM users WHERE tenant_id = $1 AND email = 'jane@tenant-a.example.com'`, tenant.ID); jane != 1 {
		t.Fatal("jane's account was not stored under the address alone")
	}
	if notices := countRows(t, env, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_signup_attempt_notice_email'
			AND payload ->> 'user_id' = $1
			AND payload ->> 'email' = 'john+2@tenant-a.example.com'
	`, member.ID.String()); notices != 1 {
		t.Fatalf("notices to the tagged address = %d, want 1", notices)
	}
}

// A change to a tagged variant of another account's address is refused the
// way a change to that address itself is.
func TestDBRequestEmailChangeRefusesATaggedVariantOfAnotherAccountsAddress(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other Member")

	_, err := env.authClient().RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    member.Email,
			NewEmail:        "Other <other+news@tenant-a.example.com>",
			CurrentPassword: testutil.SeededPassword,
		},
		tokenFor(t, tenant, member),
	))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("RequestEmailChange code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
}

// The reader's own account is not another account: moving between tags of the
// inbox the account already holds is an ordinary change.
func TestDBRequestEmailChangeMovesBetweenTagsOfTheReadersOwnInbox(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	if _, err := env.authClient().RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    member.Email,
			NewEmail:        "member+news@tenant-a.example.com",
			CurrentPassword: testutil.SeededPassword,
		},
		tokenFor(t, tenant, member),
	)); err != nil {
		t.Fatalf("RequestEmailChange to a tag of the reader's own inbox: %v", err)
	}
	confirmEveryEmailChangeLink(t, env, tenant)

	if moved := countRows(t, env, `
		SELECT count(*) FROM users WHERE id = $1 AND email = 'member+news@tenant-a.example.com'
	`, member.ID); moved != 1 {
		t.Fatal("the address did not move to the tagged variant")
	}
}

// The request checked the inbox when it was made, and another account may have
// taken it by the time both links are followed. The change that would complete
// then is refused, and the address stays where it was.
func TestDBConfirmEmailChangeRefusesAnInboxAnotherAccountTookMeanwhile(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	if _, err := env.authClient().RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    member.Email,
			NewEmail:        "moved+news@tenant-a.example.com",
			CurrentPassword: testutil.SeededPassword,
		},
		tokenFor(t, tenant, member),
	)); err != nil {
		t.Fatalf("RequestEmailChange: %v", err)
	}
	env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "moved@tenant-a.example.com", "Moved Meanwhile")

	tokens := emailChangeLinks(t, env)
	if len(tokens) != 2 {
		t.Fatalf("email change links = %d, want 2", len(tokens))
	}
	if _, err := env.authClient().ConfirmEmailChange(context.Background(), connect.NewRequest(&publirav1.ConfirmEmailChangeRequest{
		Tenant: tenantContext(tenant),
		Token:  tokens[0],
	})); err != nil {
		t.Fatalf("ConfirmEmailChange with the first link: %v", err)
	}
	_, err := env.authClient().ConfirmEmailChange(context.Background(), connect.NewRequest(&publirav1.ConfirmEmailChangeRequest{
		Tenant: tenantContext(tenant),
		Token:  tokens[1],
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("ConfirmEmailChange with the second link code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if kept := countRows(t, env, `SELECT count(*) FROM users WHERE id = $1 AND email = $2`, member.ID, member.Email); kept != 1 {
		t.Fatal("the address changed to an inbox another account holds")
	}
}

// emailChangeLinks answers the secret of every confirmation link an email
// change request queued, as its mail would carry it.
func emailChangeLinks(t *testing.T, env *publicDBEnv) []string {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(context.Background(), `
		SELECT payload ->> 'token' FROM outbox_events
		WHERE event_type = 'reader_email_change_confirmation_email'
		ORDER BY id
	`)
	if err != nil {
		t.Fatalf("read the email change links: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var tokens []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			t.Fatalf("scan an email change link: %v", err)
		}
		tokens = append(tokens, token)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the email change links: %v", err)
	}
	return tokens
}

func confirmEveryEmailChangeLink(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) {
	t.Helper()

	for _, token := range emailChangeLinks(t, env) {
		if _, err := env.authClient().ConfirmEmailChange(context.Background(), connect.NewRequest(&publirav1.ConfirmEmailChangeRequest{
			Tenant: tenantContext(tenant),
			Token:  token,
		})); err != nil {
			t.Fatalf("ConfirmEmailChange: %v", err)
		}
	}
}
