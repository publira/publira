package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// The step-up password check as a guesser meets it. ChangePassword, DeleteMe
// and RequestEmailChange each ask for the account's password on top of the
// session, and the session they ask it on is exactly what a lifted token gives
// somebody who does not know that password. These cases drive the real
// handlers, because what has to stop at the limit is the bcrypt verification
// and the row behind it rather than the shape of the response.

// newStepUpLimitedEnv starts a server that verifies a password limit times an
// hour and refuses after that. The window is long enough that no allowance
// refills while a case runs.
func newStepUpLimitedEnv(t *testing.T, limit int) *publicDBEnv {
	t.Helper()

	return newPublicDBEnvWithGuards(t, guardsWith(map[readerAction][]ratelimit.Rule{
		actionVerifyPassword: {{Limit: limit, Window: time.Hour}},
	}))
}

func wrongPasswordChangePassword(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, token string) error {
	t.Helper()

	_, err := env.authClient().ChangePassword(context.Background(), newBearerRequest(
		&publirav1.ChangePasswordRequest{
			Tenant:          tenantContext(tenant),
			CurrentPassword: "not-the-password",
			NewPassword:     "a-brand-new-password",
		},
		token,
	))
	return err
}

// One budget covers all three RPCs. Holding one per RPC would hand a guesser
// three of them and let them rotate between the forms.
func TestDBStepUpPasswordLimitIsSharedByTheAccountRPCs(t *testing.T) {
	env := newStepUpLimitedEnv(t, 3)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	if err := wrongPasswordChangePassword(t, env, tenant, token); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the first guess, through ChangePassword, code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	_, err := client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: "not-the-password"},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the second guess, through DeleteMe, code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    user.Email,
			NewEmail:        "moved@tenant-a.example.com",
			CurrentPassword: "not-the-password",
		},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the third guess, through RequestEmailChange, code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	// The budget is spent, and every one of the three says so rather than
	// answering as though the password were merely wrong.
	if err := wrongPasswordChangePassword(t, env, tenant, token); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("ChangePassword past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: "not-the-password"},
		token,
	))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("DeleteMe past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.RequestEmailChange(context.Background(), newBearerRequest(
		&publirav1.RequestEmailChangeRequest{
			Tenant:          tenantContext(tenant),
			CurrentEmail:    user.Email,
			NewEmail:        "moved@tenant-a.example.com",
			CurrentPassword: "not-the-password",
		},
		token,
	))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RequestEmailChange past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	// The budget belongs to the account being guessed at. Every other reader of
	// the tenant still reaches their own settings.
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Another Reader")
	if err := wrongPasswordChangePassword(t, env, tenant, tokenFor(t, tenant, other)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("another reader's first guess code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

// Past the limit the password is not verified at all, which is the whole point
// of charging before the check: the guesses cost the API no bcrypt and reach
// nothing. The correct password is what proves it — an attempt that was
// verified would have gone through.
func TestDBStepUpPasswordRefusalVerifiesNothingAndWritesNothing(t *testing.T) {
	env := newStepUpLimitedEnv(t, 1)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	before := readStoredAccount(t, env, user.Email)
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	if err := wrongPasswordChangePassword(t, env, tenant, token); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the one guess the budget pays for code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	_, err := client.ChangePassword(context.Background(), newBearerRequest(
		&publirav1.ChangePasswordRequest{
			Tenant:          tenantContext(tenant),
			CurrentPassword: testutil.SeededPassword,
			NewPassword:     "a-brand-new-password",
		},
		token,
	))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("ChangePassword with the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	after := readStoredAccount(t, env, user.Email)
	if after.passwordHash != before.passwordHash {
		t.Fatal("the stored password hash changed on a refused request")
	}
	if after.credentialsVersion != before.credentialsVersion {
		t.Fatalf("credentials_version = %d, want %d — a refused request must end no session", after.credentialsVersion, before.credentialsVersion)
	}
	if notices := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_password_changed_notice_email'
	`); notices != 0 {
		t.Fatalf("queued notices after a refused request = %d, want none", notices)
	}

	_, err = client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: testutil.SeededPassword},
		token,
	))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("DeleteMe with the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if accounts := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", user.ID); accounts != 1 {
		t.Fatalf("the account after a refused DeleteMe = %d rows, want it left where it was", accounts)
	}
}

// A reader who mistypes and then gets it right is not held back: reaching the
// password proves they were not guessing, so the tries before it stop counting.
func TestDBStepUpPasswordCorrectPasswordClearsTheCount(t *testing.T) {
	env := newStepUpLimitedEnv(t, 3)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)

	for attempt := 1; attempt <= 2; attempt++ {
		if err := wrongPasswordChangePassword(t, env, tenant, token); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d code = %v, want invalid_argument (err=%v)", attempt, connect.CodeOf(err), err)
		}
	}

	const corrected = "a-brand-new-password"
	changed, err := env.authClient().ChangePassword(context.Background(), newBearerRequest(
		&publirav1.ChangePasswordRequest{
			Tenant:          tenantContext(tenant),
			CurrentPassword: testutil.SeededPassword,
			NewPassword:     corrected,
		},
		token,
	))
	if err != nil {
		t.Fatalf("ChangePassword with the right password on the last allowance: %v", err)
	}

	// The change hands back the session it ended, and the count it cleared is
	// what the next two typos spend.
	for attempt := 1; attempt <= 2; attempt++ {
		err := wrongPasswordChangePassword(t, env, tenant, changed.Msg.AccessToken.GetToken())
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d after the correct password code = %v, want invalid_argument (err=%v)", attempt, connect.CodeOf(err), err)
		}
	}
}
