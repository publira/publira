package platformapi

import (
	"context"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// The password the Platform Console asks for again on top of a session, as a
// caller holding the session but not the password meets it.

// newStepUpLimitedServer starts a server that lets limit passwords be tried on
// top of one operator's sessions.
func newStepUpLimitedServer(t *testing.T, limit int) (*httptest.Server, *testutil.PostgresEnv, testutil.PlatformOperator) {
	t.Helper()

	policy := platformpolicy.Defaults()
	policy.PasswordVerification = platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit}
	ts, pg := newDBIntegrationEnvWithLoginGuard(t, loginguard.New(testutil.Limiter(), platformpolicy.Fixed(policy), nil))
	return ts, pg, pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
}

func tryEmailChange(t *testing.T, ts *httptest.Server, operator testutil.PlatformOperator, password string) error {
	t.Helper()

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.RequestEmailChange(testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator)), &publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest{
		CurrentEmail:    operator.Email,
		NewEmail:        "moved@example.com",
		CurrentPassword: password,
	})
	return err
}

// Past the limit the password is not verified at all: the right one is refused
// too, and nothing is recorded for it.
func TestDBRequestEmailChangeRefusesPastThePasswordAllowance(t *testing.T) {
	t.Parallel()

	ts, pg, operator := newStepUpLimitedServer(t, 2)

	for guess := 1; guess <= 2; guess++ {
		if err := tryEmailChange(t, ts, operator, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("guess %d code = %v, want invalid_argument (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	if err := tryEmailChange(t, ts, operator, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_email_change_tokens"); got != 0 {
		t.Fatalf("email change token rows = %d, want none", got)
	}
}

// An operator who mistypes and then gets it right is not held back.
func TestDBRequestEmailChangeCorrectPasswordClearsTheCount(t *testing.T) {
	t.Parallel()

	ts, _, operator := newStepUpLimitedServer(t, 3)

	for typo := 1; typo <= 2; typo++ {
		if err := tryEmailChange(t, ts, operator, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d code = %v, want invalid_argument (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
	if err := tryEmailChange(t, ts, operator, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the last allowance: %v", err)
	}
	for typo := 1; typo <= 3; typo++ {
		if err := tryEmailChange(t, ts, operator, "not-the-password"); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("typo %d after the right password code = %v, want invalid_argument (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}

// One outstanding address change per operator, however many requests arrive at
// once: a second live request would leave two pairs of links, each pointing at
// an address change the other one does not know about.
func TestDBRequestEmailChangeKeepsOneRequestUnderConcurrentRequests(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")

	for range testutil.ConcurrentBursts {
		testutil.RunConcurrently(t, testutil.ConcurrentRequests, func() error {
			return tryEmailChange(t, ts, operator, testutil.SeededPassword)
		})
		// Every burst is checked on its own: the next burst would replace the
		// tokens a race left behind.
		live := countRows(t, pg, `
			SELECT COUNT(*) FROM platform_user_email_change_tokens
			WHERE platform_user_id = $1 AND completed_at IS NULL
		`, operator.ID)
		if live != 1 {
			t.Fatalf("live email change requests = %d, want 1", live)
		}
	}
}

// A password set while an address change waits for the account lock ends that
// change: it was authorized by a password the account no longer has. Holding
// the row from the test is what makes the order a step rather than a race.
func TestDBRequestEmailChangeEndsWhenThePasswordChangesWhileItWaits(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")

	held, err := pg.DB.Begin()
	if err != nil {
		t.Fatalf("begin the transaction holding the account: %v", err)
	}
	defer held.Rollback() //nolint:errcheck
	if _, err := held.Exec(`SELECT id FROM platform_users WHERE id = $1 FOR UPDATE`, operator.ID); err != nil {
		t.Fatalf("hold the account row: %v", err)
	}

	errs := make(chan error, 1)
	go func() {
		errs <- tryEmailChange(t, ts, operator, testutil.SeededPassword)
	}()
	testutil.WaitForBlockedBackend(t, pg.DB)

	newHash, err := auth.HashPassword("a-brand-new-password")
	if err != nil {
		t.Fatalf("hash the replacement password: %v", err)
	}
	if _, err := held.Exec(`
		UPDATE platform_users SET password_hash = $2, credentials_version = credentials_version + 1
		WHERE id = $1
	`, operator.ID, newHash); err != nil {
		t.Fatalf("set the replacement password: %v", err)
	}
	if err := held.Commit(); err != nil {
		t.Fatalf("commit the replacement password: %v", err)
	}

	// Unauthenticated, not invalid_argument: the session the request carried is
	// the thing that ended, and the operator has to sign in again.
	if err := <-errs; connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RequestEmailChange code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_email_change_tokens"); got != 0 {
		t.Fatalf("email change token rows = %d, want none", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM outbox_events"); got != 0 {
		t.Fatalf("queued mails = %d, want none", got)
	}
}
