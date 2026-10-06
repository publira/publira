package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

// storeStaffAnswer writes a staff entry the way ReplyToContactMessage does,
// Message-ID included, and returns it.
func (e contactMessageEnv) storeStaffAnswer(t *testing.T, ctx context.Context, author testutil.TenantUser, body string) dbmodels.ContactMessageEntry {
	t.Helper()

	tenant, err := e.queries.GetTenantByID(ctx, e.tenantID)
	if err != nil {
		t.Fatalf("GetTenantByID: %v", err)
	}
	messageID, err := outbox.NewContactMessageReplyMessageID(tenant)
	if err != nil {
		t.Fatalf("NewContactMessageReplyMessageID: %v", err)
	}
	return e.storeEntry(t, ctx, dbmodels.CreateContactMessageEntryParams{
		Direction: "staff",
		AuthorID:  uuid.NullUUID{UUID: author.ID, Valid: true},
		Body:      body,
		MessageID: sql.NullString{String: messageID, Valid: true},
	})
}

func (e contactMessageEnv) storeEntry(t *testing.T, ctx context.Context, params dbmodels.CreateContactMessageEntryParams) dbmodels.ContactMessageEntry {
	t.Helper()

	params.ID = uuid.Must(uuid.NewV7())
	params.TenantID = e.tenantID
	params.ContactMessageID = e.messageID
	entry, err := e.queries.CreateContactMessageEntry(ctx, params)
	if err != nil {
		t.Fatalf("CreateContactMessageEntry: %v", err)
	}
	return entry
}

func (e contactMessageEnv) replyEvent(t *testing.T, entryID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.ContactMessageReplyEmailPayload{
		TenantID: e.tenantID.String(),
		EntryID:  entryID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypeContactMessageReplyEmail,
		Payload:        payload,
		IdempotencyKey: outbox.ContactMessageReplyEmailIdempotencyKey(entryID),
	}
}

func (e contactMessageEnv) replyHandler(mailer internalsmtp.RenderedSender) outbox.Handler {
	return outbox.NewContactMessageReplyEmailHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer,
	})
}

func TestContactMessageReplyEmailAnswersTheReaderFromTheTenant(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXRP001", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTRPL01",
		ReplyToEmail: "reader@example.test",
		Subject:      sql.NullString{String: "Wrong date of birth", Valid: true},
		Body:         "The date of birth on my account is wrong.",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS01", "kei@aoto.example.test", "Kei Arata")
	entry := env.storeStaffAnswer(t, ctx, author, "We have corrected it.")

	mailer := &recordingMailer{}
	if err := env.replyHandler(mailer)(ctx, env.replyEvent(t, entry.ID)); err != nil {
		t.Fatalf("contact message reply email handler: %v", err)
	}

	if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
		t.Fatalf("mailed %v, want the reader's reply-to address alone", got)
	}
	sent := mailer.sent[0].email
	if sent.Subject != "Re: Wrong date of birth" {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{"We have corrected it.", "> The date of birth on my account is wrong."} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}
	// The reader's reply goes to the person who answered, not to the tenant's
	// shared Reply-To.
	if sent.ReplyTo != "kei@aoto.example.test" {
		t.Errorf("Reply-To = %q, want the author's account address", sent.ReplyTo)
	}
	if sent.MessageID != entry.MessageID.String || !strings.HasSuffix(sent.MessageID, "@aoto.example.test") {
		t.Errorf("Message-ID = %q, want the stored %q on the tenant's domain", sent.MessageID, entry.MessageID.String)
	}
	// The first answer follows a message that came in through the form, which
	// carried no Message-ID, so it starts the thread.
	if sent.InReplyTo != "" || len(sent.References) != 0 {
		t.Errorf("In-Reply-To = %q, References = %v, want neither on the first answer", sent.InReplyTo, sent.References)
	}
}

// A later answer names the entries before it, so the reader's mail client
// shows the exchange as one thread.
func TestContactMessageReplyEmailThreadsUnderTheEarlierEntries(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXRP002", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTRPL02",
		ReplyToEmail: "reader@example.test",
		Body:         "Which episodes can I read without an account?",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS02", "kei@aoto.example.test", "Kei Arata")
	first := env.storeStaffAnswer(t, ctx, author, "Every episode marked free.")
	// A reader entry that came in without a Message-ID has nothing to name.
	env.storeEntry(t, ctx, dbmodels.CreateContactMessageEntryParams{Direction: "reader", Body: "And on the app?"})
	reply := env.storeEntry(t, ctx, dbmodels.CreateContactMessageEntryParams{
		Direction: "reader",
		Body:      "Thank you.",
		MessageID: sql.NullString{String: "reply-1@reader.example.test", Valid: true},
	})
	second := env.storeStaffAnswer(t, ctx, author, "The app shows the same episodes.")

	mailer := &recordingMailer{}
	if err := env.replyHandler(mailer)(ctx, env.replyEvent(t, second.ID)); err != nil {
		t.Fatalf("contact message reply email handler: %v", err)
	}

	sent := mailer.sent[0].email
	// The seeded tenant writes in Japanese.
	if sent.Subject != "Re: Aoto Pressへのお問い合わせ" {
		t.Errorf("subject = %q, want the subject for a message the reader titled nothing", sent.Subject)
	}
	if sent.InReplyTo != reply.MessageID.String {
		t.Errorf("In-Reply-To = %q, want the latest entry before the answer, %q", sent.InReplyTo, reply.MessageID.String)
	}
	if want := []string{first.MessageID.String, reply.MessageID.String}; !slices.Equal(sent.References, want) {
		t.Errorf("References = %v, want %v", sent.References, want)
	}
}

// An author who can no longer sign in names nobody, and the tenant's own
// Reply-To takes the reader's reply instead.
func TestContactMessageReplyEmailFallsBackWhenTheAuthorIsGone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, test := range []struct {
		name  string
		leave string
	}{
		{name: "suspended", leave: `UPDATE users SET status = 'suspended' WHERE id = $1`},
		{name: "deleted", leave: `DELETE FROM users WHERE id = $1`},
	} {
		t.Run(test.name, func(t *testing.T) {
			env := newContactMessageEnv(t, ctx, "OUTBOXRP003", "aoto.example.test", dbmodels.CreateContactMessageParams{
				PublicID:     "CONTACTRPL03",
				ReplyToEmail: "reader@example.test",
				Body:         "A question.",
			})
			author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS03", "kei@aoto.example.test", "Kei Arata")
			entry := env.storeStaffAnswer(t, ctx, author, "An answer.")
			if _, err := env.pg.DB.ExecContext(ctx, test.leave, author.ID); err != nil {
				t.Fatalf("take the author's account away: %v", err)
			}

			mailer := &recordingMailer{}
			if err := env.replyHandler(mailer)(ctx, env.replyEvent(t, entry.ID)); err != nil {
				t.Fatalf("contact message reply email handler: %v", err)
			}
			if got := mailer.sent[0].email.ReplyTo; got != "" {
				t.Errorf("Reply-To = %q, want none so the settings' address is used", got)
			}
		})
	}
}

func TestContactMessageReplyEmailRetriesAFailedSend(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXRP004", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTRPL04",
		ReplyToEmail: "reader@example.test",
		Body:         "A question.",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS04", "kei@aoto.example.test", "Kei Arata")
	entry := env.storeStaffAnswer(t, ctx, author, "An answer.")

	err := env.replyHandler(&recordingMailer{fail: errors.New("smtp unavailable")})(ctx, env.replyEvent(t, entry.ID))
	if err == nil {
		t.Fatal("a failed send completed the event")
	}
	if outbox.IsPermanent(err) {
		t.Fatalf("a failed send is permanent: %v", err)
	}
}

// A message purged before the send takes its entries with it, and no retry
// can bring the answer back.
func TestContactMessageReplyEmailIsPermanentForAnAnswerThatIsGone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXRP005", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTRPL05",
		ReplyToEmail: "reader@example.test",
		Body:         "A question.",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS05", "kei@aoto.example.test", "Kei Arata")
	entry := env.storeStaffAnswer(t, ctx, author, "An answer.")
	if _, err := env.pg.DB.ExecContext(ctx, `DELETE FROM contact_messages WHERE id = $1`, env.messageID); err != nil {
		t.Fatalf("delete the contact message: %v", err)
	}

	err := env.replyHandler(&recordingMailer{})(ctx, env.replyEvent(t, entry.ID))
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler = %v, want a permanent error", err)
	}
}

// flakyMailer refuses its first mail and takes every one after it, which is a
// mail server that was down for one attempt.
type flakyMailer struct {
	mu       sync.Mutex
	attempts int
	sent     []internalsmtp.RenderedEmail
}

func (m *flakyMailer) SendRenderedEmail(_ context.Context, _ emailsettings.SMTPSettings, _ string, email internalsmtp.RenderedEmail) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.attempts++
	if m.attempts == 1 {
		return errors.New("smtp unavailable")
	}
	m.sent = append(m.sent, email)
	return nil
}

func (m *flakyMailer) delivered() []internalsmtp.RenderedEmail {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.sent)
}

// One answer is one mail through the worker: queueing it again is a no-op,
// the attempt that fails is retried, and the event the retry completes is not
// sent again, all with the Message-ID the entry stores.
func TestContactMessageReplyEmailIsDeliveredOnceThroughRetries(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXRP006", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTRPL06",
		ReplyToEmail: "reader@example.test",
		Body:         "A question.",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXRPS06", "kei@aoto.example.test", "Kei Arata")
	entry := env.storeStaffAnswer(t, ctx, author, "An answer.")

	event := env.replyEvent(t, entry.ID)
	var queued dbmodels.OutboxEvent
	for range 2 {
		inserted, err := env.queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
			ID:             uuid.Must(uuid.NewV7()),
			TenantID:       event.TenantID,
			EventType:      event.EventType,
			Payload:        event.Payload,
			IdempotencyKey: event.IdempotencyKey,
			AvailableAt:    time.Now().UTC().Add(-time.Second),
		})
		switch {
		case err == nil:
			queued = inserted
		case !errors.Is(err, sql.ErrNoRows):
			t.Fatalf("InsertOutboxEvent: %v", err)
		}
	}

	mailer := &flakyMailer{}
	handlers := outbox.NewRegistry()
	handlers.Register(outbox.EventTypeContactMessageReplyEmail, env.replyHandler(mailer))
	startTestWorker(t, env.pg.DB, outbox.Config{Handlers: handlers})
	done := waitStatus(t, ctx, env.queries, queued.ID, outbox.StatusDone)
	if done.Attempts != 1 {
		t.Errorf("attempts = %d, want the one failed attempt before the send", done.Attempts)
	}

	delivered := mailer.delivered()
	if len(delivered) != 1 {
		t.Fatalf("delivered %d mails for one answer, want 1", len(delivered))
	}
	if delivered[0].MessageID != entry.MessageID.String {
		t.Errorf("Message-ID = %q, want the stored %q", delivered[0].MessageID, entry.MessageID.String)
	}
}
