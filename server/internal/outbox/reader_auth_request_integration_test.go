package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// The sign-up, password reset, and verification resend forms record a request
// and answer; these handlers are where the address is looked up and the case it
// is in decides what gets written. They run as publira_outbox, the role the
// worker connects as, so the writes are checked against the grants that role
// really has.

type readerRequestEnv struct {
	pg     *testutil.PostgresEnv
	tenant testutil.Tenant
	cfg    outbox.EmailHandlerConfig
}

func newReaderRequestEnv(t *testing.T) readerRequestEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "READERREQ001", "reader-request.example.com", "Reader Request Tenant")
	return readerRequestEnv{
		pg:     pg,
		tenant: tenant,
		cfg:    outbox.EmailHandlerConfig{DB: pg.OpenOutboxDB(t)},
	}
}

func (e readerRequestEnv) count(t *testing.T, query string, args ...any) int {
	t.Helper()

	var count int
	if err := e.pg.DB.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

func (e readerRequestEnv) signupEvent(t *testing.T, payload outbox.ReaderSignupRequestPayload) dbmodels.OutboxEvent {
	t.Helper()

	payload.TenantID = e.tenant.ID.String()
	if payload.UserID == "" {
		payload.UserID = uuid.Must(uuid.NewV7()).String()
	}
	if payload.Name == "" {
		payload.Name = "Newcomer"
	}
	if payload.PasswordHash == "" {
		hash, err := auth.HashPassword("newcomer-password")
		if err != nil {
			t.Fatalf("hash password: %v", err)
		}
		payload.PasswordHash = hash
	}
	return newReaderOutboxEvent(t, e.tenant.ID, outbox.EventTypeReaderSignupRequest, payload, "test:signup-request")
}

func (e readerRequestEnv) process(t *testing.T, handler outbox.Handler, event dbmodels.OutboxEvent) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := handler(ctx, event); err != nil {
		t.Fatalf("process %s: %v", event.EventType, err)
	}
}

func TestReaderSignupRequestOpensAnInactiveAccountForAFreeAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	terms := env.pg.SeedPage(t, env.tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	userID := uuid.Must(uuid.NewV7())
	event := env.signupEvent(t, outbox.ReaderSignupRequestPayload{
		UserID:               userID.String(),
		Email:                "newcomer@reader-request.example.com",
		BirthDate:            "2000-04-02",
		AgreedPageVersionIDs: []string{terms.VersionID.String()},
	})

	env.process(t, outbox.NewReaderSignupRequestHandler(env.cfg), event)

	var status string
	var verified bool
	var birthDate sql.NullTime
	if err := env.pg.DB.QueryRow(`
		SELECT status, email_verified_at IS NOT NULL, birth_date FROM users WHERE id = $1
	`, userID).Scan(&status, &verified, &birthDate); err != nil {
		t.Fatalf("read the new account: %v", err)
	}
	if status != "inactive" || verified {
		t.Fatalf("account status = %q, verified = %v, want inactive and unverified", status, verified)
	}
	if !birthDate.Valid || birthDate.Time.Format(time.DateOnly) != "2000-04-02" {
		t.Fatalf("birth_date = %v, want 2000-04-02", birthDate)
	}
	if consents := env.count(t, `
		SELECT count(*) FROM user_page_consents WHERE user_id = $1 AND page_version_id = $2
	`, userID, terms.VersionID); consents != 1 {
		t.Fatalf("recorded consents = %d, want 1", consents)
	}
	if tokens := env.count(t, `SELECT count(*) FROM user_email_verification_tokens WHERE user_id = $1`, userID); tokens != 1 {
		t.Fatalf("verification tokens = %d, want 1", tokens)
	}
	if mails := env.count(t, `
		SELECT count(*) FROM outbox_events event
		JOIN user_email_verification_tokens token ON token.id = (event.payload ->> 'token_id')::uuid
		WHERE event.event_type = 'reader_email_verification_email' AND token.user_id = $1
	`, userID); mails != 1 {
		t.Fatalf("queued verification mails = %d, want 1", mails)
	}
}

func TestReaderSignupRequestNotifiesTheOwnerOfARegisteredAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	member := env.pg.SeedEndUser(t, env.tenant.ID, "READERREQU01", "member@reader-request.example.com", "Member")
	var before string
	if err := env.pg.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, member.ID).Scan(&before); err != nil {
		t.Fatalf("read the account: %v", err)
	}
	event := env.signupEvent(t, outbox.ReaderSignupRequestPayload{Email: member.Email})

	env.process(t, outbox.NewReaderSignupRequestHandler(env.cfg), event)

	if accounts := env.count(t, `SELECT count(*) FROM users WHERE email = $1`, member.Email); accounts != 1 {
		t.Fatalf("accounts for %s = %d, want 1", member.Email, accounts)
	}
	var after string
	if err := env.pg.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, member.ID).Scan(&after); err != nil {
		t.Fatalf("read the account: %v", err)
	}
	if after != before {
		t.Fatal("the sign-up changed the password of the account it collided with")
	}
	if notices := env.count(t, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_signup_attempt_notice_email' AND payload ->> 'user_id' = $1
	`, member.ID.String()); notices != 1 {
		t.Fatalf("queued notices = %d, want 1", notices)
	}
	if mails := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_verification_email'`); mails != 0 {
		t.Fatalf("queued verification mails = %d, want none", mails)
	}
}

// The worker is at-least-once: a request whose writes committed can be handed
// over again when marking it done failed. The retry recognises the account it
// opened instead of mistaking it for somebody else's.
func TestReaderSignupRequestRetriedAfterItCommittedChangesNothing(t *testing.T) {
	env := newReaderRequestEnv(t)
	event := env.signupEvent(t, outbox.ReaderSignupRequestPayload{Email: "newcomer@reader-request.example.com"})
	handler := outbox.NewReaderSignupRequestHandler(env.cfg)

	env.process(t, handler, event)
	env.process(t, handler, event)

	if accounts := env.count(t, `SELECT count(*) FROM users WHERE email = 'newcomer@reader-request.example.com'`); accounts != 1 {
		t.Fatalf("accounts = %d, want 1", accounts)
	}
	if mails := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_verification_email'`); mails != 1 {
		t.Fatalf("queued verification mails = %d, want 1", mails)
	}
	if notices := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_signup_attempt_notice_email'`); notices != 0 {
		t.Fatalf("queued notices = %d, want none", notices)
	}
}

// Two sign-ups for one free address: the first opens the account and the second
// finds it, so its owner hears about the second rather than getting a second
// account.
func TestReaderSignupRequestForAnAddressAnotherRequestJustTookSendsTheNotice(t *testing.T) {
	env := newReaderRequestEnv(t)
	handler := outbox.NewReaderSignupRequestHandler(env.cfg)
	first := env.signupEvent(t, outbox.ReaderSignupRequestPayload{Email: "newcomer@reader-request.example.com"})
	second := env.signupEvent(t, outbox.ReaderSignupRequestPayload{Email: "newcomer@reader-request.example.com"})

	env.process(t, handler, first)
	env.process(t, handler, second)

	if accounts := env.count(t, `SELECT count(*) FROM users WHERE email = 'newcomer@reader-request.example.com'`); accounts != 1 {
		t.Fatalf("accounts = %d, want 1", accounts)
	}
	if notices := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_signup_attempt_notice_email'`); notices != 1 {
		t.Fatalf("queued notices = %d, want 1", notices)
	}
}

func (e readerRequestEnv) addressEvent(t *testing.T, eventType, email string) dbmodels.OutboxEvent {
	t.Helper()

	return newReaderOutboxEvent(t, e.tenant.ID, eventType, map[string]string{
		"tenant_id": e.tenant.ID.String(),
		"email":     email,
	}, "test:"+eventType)
}

func TestReaderPasswordResetRequestIssuesALinkOnlyForARegisteredAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	member := env.pg.SeedEndUser(t, env.tenant.ID, "READERREQU01", "member@reader-request.example.com", "Member")
	handler := outbox.NewReaderPasswordResetRequestHandler(env.cfg)

	env.process(t, handler, env.addressEvent(t, outbox.EventTypeReaderPasswordResetRequest, "stranger@reader-request.example.com"))
	if rows := env.count(t, `SELECT count(*) FROM outbox_events`); rows != 0 {
		t.Fatalf("queued events for an unknown address = %d, want none", rows)
	}

	registered := env.addressEvent(t, outbox.EventTypeReaderPasswordResetRequest, member.Email)
	env.process(t, handler, registered)
	// A retry of the committed request finds its mail queued and stops there.
	env.process(t, handler, registered)

	if tokens := env.count(t, `
		SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1 AND id = $2
	`, member.ID, registered.ID); tokens != 1 {
		t.Fatalf("reset tokens named after the request = %d, want 1", tokens)
	}
	if mails := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_password_reset_email'`); mails != 1 {
		t.Fatalf("queued reset mails = %d, want 1", mails)
	}
}

func TestReaderEmailVerificationRequestIssuesALinkOnlyForAnUnconfirmedAccount(t *testing.T) {
	env := newReaderRequestEnv(t)
	pending := env.pg.SeedUnverifiedEndUser(t, env.tenant.ID, "READERREQU01", "pending@reader-request.example.com", "Pending")
	member := env.pg.SeedEndUser(t, env.tenant.ID, "READERREQU02", "member@reader-request.example.com", "Member")
	handler := outbox.NewReaderEmailVerificationRequestHandler(env.cfg)

	for _, email := range []string{"stranger@reader-request.example.com", member.Email, pending.Email} {
		env.process(t, handler, env.addressEvent(t, outbox.EventTypeReaderEmailVerificationRequest, email))
	}

	if tokens := env.count(t, `SELECT count(*) FROM user_email_verification_tokens WHERE user_id = $1`, member.ID); tokens != 0 {
		t.Fatalf("verification tokens for the confirmed account = %d, want none", tokens)
	}
	mails := env.count(t, `
		SELECT count(*) FROM outbox_events event
		JOIN user_email_verification_tokens token ON token.id = (event.payload ->> 'token_id')::uuid
		WHERE event.event_type = 'reader_email_verification_email' AND token.user_id = $1
	`, pending.ID)
	if mails != 1 {
		t.Fatalf("queued verification mails for the unconfirmed account = %d, want 1", mails)
	}
	if all := env.count(t, `SELECT count(*) FROM outbox_events`); all != 1 {
		t.Fatalf("queued events = %d, want only the one for the unconfirmed account", all)
	}
}

// Requests for one address handled at once still leave one live link. The
// worker runs several handlers in parallel, and a reader who submits the form
// twice is the ordinary way two of them name the same account.
func TestReaderAddressRequestsKeepOneLinkUnderConcurrentProcessing(t *testing.T) {
	cases := []struct {
		name      string
		eventType string
		handler   func(outbox.EmailHandlerConfig) outbox.Handler
		live      string
	}{
		{
			name:      "password reset",
			eventType: outbox.EventTypeReaderPasswordResetRequest,
			handler:   outbox.NewReaderPasswordResetRequestHandler,
			live:      `SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1 AND completed_at IS NULL`,
		},
		{
			name:      "email verification",
			eventType: outbox.EventTypeReaderEmailVerificationRequest,
			handler:   outbox.NewReaderEmailVerificationRequestHandler,
			live:      `SELECT count(*) FROM user_email_verification_tokens WHERE user_id = $1 AND used_at IS NULL`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := newReaderRequestEnv(t)
			pending := env.pg.SeedUnverifiedEndUser(t, env.tenant.ID, "READERREQU01", "pending@reader-request.example.com", "Pending")
			handler := tc.handler(env.cfg)

			for range testutil.ConcurrentBursts {
				testutil.RunConcurrently(t, testutil.ConcurrentRequests, func() error {
					return handler(context.Background(), env.addressEvent(t, tc.eventType, pending.Email))
				})
				// Every burst is checked on its own: the next burst would replace
				// the tokens a race left behind.
				if live := env.count(t, tc.live, pending.ID); live != 1 {
					t.Fatalf("live tokens = %d, want 1", live)
				}
			}
		})
	}
}

// A worker that dies while it holds a sign-up leaves the request behind, and
// the next worker opens the account from it. Once the request is done, the
// password hash it carried is gone from the row.
func TestReaderSignupRequestSurvivesAWorkerThatDiesHoldingIt(t *testing.T) {
	env := newReaderRequestEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	userID := uuid.Must(uuid.NewV7())
	hash, err := auth.HashPassword("newcomer-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	body, err := json.Marshal(outbox.ReaderSignupRequestPayload{
		TenantID:     env.tenant.ID.String(),
		UserID:       userID.String(),
		Email:        "newcomer@reader-request.example.com",
		Name:         "Newcomer",
		PasswordHash: hash,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	queries := dbmodels.New(env.pg.DB)
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: env.tenant.ID, Valid: true},
		EventType:      outbox.EventTypeReaderSignupRequest,
		Payload:        body,
		IdempotencyKey: "test:signup-request",
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}
	if _, err := env.pg.DB.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'processing', updated_at = NOW() - interval '1 minute'
		WHERE id = $1
	`, event.ID); err != nil {
		t.Fatalf("leave the request claimed: %v", err)
	}

	handlers := outbox.NewRegistry()
	handlers.Register(outbox.EventTypeReaderSignupRequest, outbox.NewReaderSignupRequestHandler(env.cfg))
	startTestWorker(t, env.pg.DB, outbox.Config{Handlers: handlers, StaleProcessing: 50 * time.Millisecond})
	done := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)

	if accounts := env.count(t, `SELECT count(*) FROM users WHERE id = $1`, userID); accounts != 1 {
		t.Fatalf("accounts opened from the request = %d, want 1", accounts)
	}
	if strings.Contains(string(done.Payload), "password_hash") {
		t.Fatalf("payload of the done request still holds the password hash: %s", done.Payload)
	}
}

// Sign-ups for one free address handled at once open one account, and the ones
// that lost the race reach its owner as notices.
func TestReaderSignupRequestsForOneAddressOpenOneAccountUnderConcurrentProcessing(t *testing.T) {
	env := newReaderRequestEnv(t)
	handler := outbox.NewReaderSignupRequestHandler(env.cfg)
	const email = "newcomer@reader-request.example.com"

	testutil.RunConcurrently(t, testutil.ConcurrentRequests, func() error {
		return handler(context.Background(), env.signupEvent(t, outbox.ReaderSignupRequestPayload{Email: email}))
	})

	if accounts := env.count(t, `SELECT count(*) FROM users WHERE email = $1`, email); accounts != 1 {
		t.Fatalf("accounts = %d, want 1", accounts)
	}
	if notices := env.count(t, `SELECT count(*) FROM outbox_events WHERE event_type = 'reader_signup_attempt_notice_email'`); notices != testutil.ConcurrentRequests-1 {
		t.Fatalf("queued notices = %d, want %d", notices, testutil.ConcurrentRequests-1)
	}
}
