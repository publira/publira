package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

// recordingMailer keeps every mail it was handed, so a test can say who heard
// about a contact message and what they were told.
type recordingMailer struct {
	mu   sync.Mutex
	sent []sentMail
	fail error
}

type sentMail struct {
	recipient string
	email     internalsmtp.RenderedEmail
}

func (m *recordingMailer) SendRenderedEmail(_ context.Context, _ emailsettings.SMTPSettings, recipient string, email internalsmtp.RenderedEmail) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return m.fail
	}
	m.sent = append(m.sent, sentMail{recipient: recipient, email: email})
	return nil
}

func (m *recordingMailer) recipients() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	addresses := make([]string, 0, len(m.sent))
	for _, mail := range m.sent {
		addresses = append(addresses, mail.recipient)
	}
	sort.Strings(addresses)
	return addresses
}

// contactMessageEnv is a tenant with SMTP configured and one stored message, in
// the shape the staff mail handler reads them back.
type contactMessageEnv struct {
	pg        *testutil.PostgresEnv
	queries   *dbmodels.Queries
	encryptor emailsettings.SecretManager
	tenantID  uuid.UUID
	messageID uuid.UUID
}

func newContactMessageEnv(t *testing.T, ctx context.Context, tenantPublicID, domain string, message dbmodels.CreateContactMessageParams) contactMessageEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, tenantPublicID, domain, "Aoto Press")
	queries := dbmodels.New(pg.DB)

	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := queries.UpsertPlatformSMTPConfig(ctx, dbmodels.UpsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("UpsertPlatformSMTPConfig: %v", err)
	}

	message.ID = uuid.Must(uuid.NewV7())
	message.TenantID = tenant.ID
	stored, err := queries.CreateContactMessage(ctx, message)
	if err != nil {
		t.Fatalf("CreateContactMessage: %v", err)
	}
	return contactMessageEnv{pg: pg, queries: queries, encryptor: encryptor, tenantID: tenant.ID, messageID: stored.ID}
}

func (e contactMessageEnv) event(t *testing.T) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.ContactMessageStaffEmailPayload{
		TenantID:  e.tenantID.String(),
		MessageID: e.messageID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypeContactMessageStaffEmail,
		Payload:        payload,
		IdempotencyKey: outbox.ContactMessageStaffEmailIdempotencyKey(e.messageID),
	}
}

func (e contactMessageEnv) handler(mailer internalsmtp.RenderedSender) outbox.Handler {
	// No renderer: the plain-text alternative is composed from the catalogs, so
	// what the mail says is this package's own and testable without one.
	return outbox.NewContactMessageStaffEmailHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer,
	})
}

func TestContactMessageStaffEmailReachesEveryActiveStaffAccount(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXCT001", "outbox-contact1.example.com", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTMSG01",
		ReplyToEmail: "reader@example.test",
		Subject:      sql.NullString{String: "Wrong date of birth", Valid: true},
		Body:         "The date of birth on my account is wrong.\nCould you correct it?",
	})
	env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXSTF01", "first@aoto.example.com", "First")
	env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXSTF02", "second@aoto.example.com", "Second")
	// A reader of the same tenant holds no staff role and hears nothing.
	env.pg.SeedEndUser(t, env.tenantID, "OUTBOXRDR01", "reader@aoto.example.com", "Reader")
	// A staff account that was deactivated cannot sign in to work the message,
	// so it is not one of the people told about it either.
	suspended := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXSTF03", "gone@aoto.example.com", "Gone")
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, suspended.ID); err != nil {
		t.Fatalf("suspend the staff account: %v", err)
	}

	mailer := &recordingMailer{}
	if err := env.handler(mailer)(ctx, env.event(t)); err != nil {
		t.Fatalf("contact message staff email handler: %v", err)
	}

	got := mailer.recipients()
	want := []string{"first@aoto.example.com", "second@aoto.example.com"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("mailed %v, want %v", got, want)
	}

	sent := mailer.sent[0].email
	if !strings.Contains(sent.Subject, "Aoto Press") {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{
		"reader@example.test",
		"Wrong date of birth",
		"Could you correct it?",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}
}

// A tenant whose staff were all deactivated has nobody to tell, and a retry
// would find the same empty list. The message itself is stored and waiting.
func TestContactMessageStaffEmailCompletesWithNobodyToTell(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXCT002", "outbox-contact2.example.com", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTMSG02",
		ReplyToEmail: "reader@example.test",
		Body:         "Is anybody there?",
	})

	mailer := &recordingMailer{}
	if err := env.handler(mailer)(ctx, env.event(t)); err != nil {
		t.Fatalf("contact message staff email handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("mailed %d recipients on a tenant with no staff", len(mailer.sent))
	}
}

// A mail server that is down is an attempt to repeat, not a message to drop:
// the failure has to reach the worker so the event is retried.
func TestContactMessageStaffEmailRetriesAFailedSend(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXCT003", "outbox-contact3.example.com", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTMSG03",
		ReplyToEmail: "reader@example.test",
		Body:         "A question.",
	})
	env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXSTF04", "staff@aoto.example.com", "Staff")

	err := env.handler(&recordingMailer{fail: errors.New("smtp unavailable")})(ctx, env.event(t))
	if err == nil {
		t.Fatal("a failed send completed the event")
	}
	if outbox.IsPermanent(err) {
		t.Fatalf("a failed send is permanent: %v", err)
	}
}

// A message deleted between the submission and the send has nothing left to
// announce, and no retry can bring it back.
func TestContactMessageStaffEmailIsPermanentForAMessageThatIsGone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXCT004", "outbox-contact4.example.com", dbmodels.CreateContactMessageParams{
		PublicID:     "CONTACTMSG04",
		ReplyToEmail: "reader@example.test",
		Body:         "A question.",
	})
	env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXSTF05", "staff@aoto.example.com", "Staff")
	if _, err := env.pg.DB.ExecContext(ctx, `DELETE FROM contact_messages WHERE id = $1`, env.messageID); err != nil {
		t.Fatalf("delete the contact message: %v", err)
	}

	err := env.handler(&recordingMailer{})(ctx, env.event(t))
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler = %v, want a permanent error", err)
	}
}
