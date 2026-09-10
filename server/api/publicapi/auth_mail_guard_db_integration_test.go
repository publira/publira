package publicapi

import (
	"context"
	"log/slog"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/mailguard"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// The forms a stranger can submit — the sign-up, the password reset, the resend
// of a verification link — all end in mail the tenant's server sends. These
// cases drive them against a real database, because what has to stop when the
// limit is reached is not the response but the outbox row behind it.

// newMailLimitedEnv starts a server whose mailbox allowance is one mail per
// hour, which is the smallest policy a case can reach without describing one
// nobody would deploy.
func newMailLimitedEnv(t *testing.T) *publicDBEnv {
	t.Helper()

	return newPublicDBEnvWithMailGuard(t, mailguard.New(
		ratelimit.New(ratelimit.NewMemoryStore()),
		mailguard.Rules(1, 100),
		mailguard.Rules(1000, 1000),
		slog.Default(),
	))
}

// A stranger aiming the sign-up form at somebody's address gets one notice out
// of it and nothing after that.
func TestDBCreateUserStopsQueueingNoticesAtTheLimit(t *testing.T) {
	env := newMailLimitedEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	accepted, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Impersonating Signup",
		Email:    member.Email,
		Password: "another-password",
	}))
	if err != nil {
		t.Fatalf("the first CreateUser: %v", err)
	}
	if !accepted.Msg.Accepted {
		t.Fatal("accepted = false, want the first sign-up taken")
	}

	_, err = env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Impersonating Signup",
		Email:    member.Email,
		Password: "another-password",
	}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second CreateUser code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	notices := countRows(t, env, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_signup_attempt_notice_email'
	`)
	if notices != 1 {
		t.Fatalf("queued notices = %d, want the one the allowance paid for", notices)
	}
}

// The refusal must not become the tell the rest of the handler is written to
// avoid: a caller over the limit is answered the same way whether the address
// they named has an account or not.
func TestDBCreateUserRefusesARegisteredAddressLikeAFreeOne(t *testing.T) {
	env := newMailLimitedEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	signUp := func(email string) error {
		_, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
			Tenant:   tenantContext(tenant),
			Name:     "Signup",
			Email:    email,
			Password: "another-password",
		}))
		return err
	}

	const freeEmail = "free@tenant-a.example.com"
	for _, email := range []string{member.Email, freeEmail} {
		if err := signUp(email); err != nil {
			t.Fatalf("the first sign-up for %s: %v", email, err)
		}
	}

	registered, free := signUp(member.Email), signUp(freeEmail)
	if registered == nil || free == nil {
		t.Fatalf("refusals = %v and %v, want both refused", registered, free)
	}
	if registered.Error() != free.Error() {
		t.Fatalf("the registered address is refused with %q and the free one with %q, want one answer", registered, free)
	}

	// The free address got the account its first sign-up created, and neither
	// of the refused submissions left anything behind.
	if count := countRows(t, env, `SELECT count(*) FROM users WHERE email = $1`, freeEmail); count != 1 {
		t.Fatalf("accounts for %s = %d, want 1", freeEmail, count)
	}
	if count := countRows(t, env, `SELECT count(*) FROM outbox_events`); count != 2 {
		t.Fatalf("queued mails = %d, want the two the allowances paid for", count)
	}
}

// One mailbox holds one allowance whichever form is aimed at it, so a caller
// cannot get more mail out of a tenant by moving between them.
func TestDBTheMailFormsShareOneAllowancePerAddress(t *testing.T) {
	env := newMailLimitedEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")

	if _, err := env.authClient().RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
		Tenant: tenantContext(tenant),
		Email:  pending.Email,
	})); err != nil {
		t.Fatalf("RequestEmailVerification: %v", err)
	}

	_, err := env.authClient().RequestPasswordReset(context.Background(), connect.NewRequest(&publirav1.RequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  pending.Email,
	}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RequestPasswordReset code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	if count := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_password_reset_email'
	`); count != 0 {
		t.Fatalf("queued password reset mails = %d, want none", count)
	}
	// A refused request writes nothing at all, not even the token the mail it
	// did not queue would have carried.
	if count := countRows(t, env, `
		SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1
	`, pending.ID.String()); count != 0 {
		t.Fatalf("password reset tokens = %d, want none", count)
	}
}

// The address a member wants to move to is one nobody has confirmed, so the
// mail it receives is bounded like any other, session or no session.
func TestDBRequestEmailChangeStopsAtTheLimit(t *testing.T) {
	env := newMailLimitedEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	login, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    member.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	const newEmail = "moved@tenant-a.example.com"
	requestChange := func() error {
		_, err := env.authClient().RequestEmailChange(context.Background(), newBearerRequest(
			&publirav1.RequestEmailChangeRequest{
				Tenant:          tenantContext(tenant),
				CurrentEmail:    member.Email,
				NewEmail:        newEmail,
				CurrentPassword: testutil.SeededPassword,
			},
			login.Msg.AccessToken.Token,
		))
		return err
	}

	if err := requestChange(); err != nil {
		t.Fatalf("the first RequestEmailChange: %v", err)
	}
	if err := requestChange(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second RequestEmailChange code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	// One request queues both halves of the confirmation, so the pair that is
	// there is the one the allowance paid for.
	if count := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_change_confirmation_email'
	`); count != 2 {
		t.Fatalf("queued confirmation mails = %d, want the two the allowance paid for", count)
	}
}
