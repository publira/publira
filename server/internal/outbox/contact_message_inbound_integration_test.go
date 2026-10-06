package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/inboundemail"
	"github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/inboundprovider/sendgrid"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretupdate"
)

// configureInbound saves the tenant's inbound email settings for SendGrid on
// reply.aoto.example.test.
func (e contactMessageEnv) configureInbound(t *testing.T, ctx context.Context, enabled bool) {
	t.Helper()

	store := inboundemail.New(e.queries, e.encryptor, providers.Registry(), nil, slog.Default())
	if _, err := store.Upsert(ctx, e.tenantID, inboundemail.UpdateInput{
		Provider: sendgrid.ID,
		Enabled:  enabled,
		Domain:   "reply.aoto.example.test",
		Fields:   []inboundemail.FieldUpdate{{Name: sendgrid.FieldWebhookToken, Mode: secretupdate.Replace, Value: "token"}},
	}, inboundemail.AuditMeta{}); err != nil {
		t.Fatalf("save inbound email settings: %v", err)
	}
}

// Once inbound email is ready, the reader's reply goes to the message's own
// address, which is how the webhook finds the message it answers.
func TestContactMessageReplyEmailNamesTheMessageAddressOnceInboundIsReady(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXIN001", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "ContactInb01",
		ReplyToEmail: "reader@example.test",
		Body:         "Episode 3 is still locked.",
	})
	author := env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXINS01", "kei@aoto.example.test", "Kei Arata")
	entry := env.storeStaffAnswer(t, ctx, author, "We have restored your purchase.")

	env.configureInbound(t, ctx, false)
	mailer := &recordingMailer{}
	if err := env.replyHandler(mailer)(ctx, env.replyEvent(t, entry.ID)); err != nil {
		t.Fatalf("contact message reply email handler: %v", err)
	}
	if got := mailer.sent[0].email.ReplyTo; got != "kei@aoto.example.test" {
		t.Fatalf("Reply-To = %q while inbound email is disabled, want the author's address", got)
	}

	env.configureInbound(t, ctx, true)
	mailer = &recordingMailer{}
	if err := env.replyHandler(mailer)(ctx, env.replyEvent(t, entry.ID)); err != nil {
		t.Fatalf("contact message reply email handler: %v", err)
	}
	if got, want := mailer.sent[0].email.ReplyTo, "contact+ContactInb01@reply.aoto.example.test"; got != want {
		t.Fatalf("Reply-To = %q, want %q", got, want)
	}
}

// A reply the reader mailed back is announced with the mail a new message
// gets, carrying what the reply says rather than the message it answers.
func TestContactMessageStaffEmailAnnouncesAReaderReply(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newContactMessageEnv(t, ctx, "OUTBOXIN002", "aoto.example.test", dbmodels.CreateContactMessageParams{
		PublicID:     "ContactInb02",
		ReplyToEmail: "reader@example.test",
		Subject:      sql.NullString{String: "About my purchase", Valid: true},
		Body:         "Episode 3 is still locked.",
	})
	env.pg.SeedTenantAdmin(t, env.tenantID, "OUTBOXINS02", "staff@aoto.example.test", "Staff")
	reply, err := env.queries.CreateReaderContactMessageEntry(ctx, dbmodels.CreateReaderContactMessageEntryParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         env.tenantID,
		ContactMessageID: env.messageID,
		Body:             "It opens now, thank you.",
		MessageID:        sql.NullString{String: "reply-1@example.net", Valid: true},
		FromEmail:        sql.NullString{String: "reader.alt@example.net", Valid: true},
	})
	if err != nil {
		t.Fatalf("CreateReaderContactMessageEntry: %v", err)
	}

	mailer := &recordingMailer{}
	if err := env.handler(mailer)(ctx, env.entryEvent(t, reply.ID)); err != nil {
		t.Fatalf("contact message staff email handler: %v", err)
	}
	if got := mailer.recipients(); len(got) != 1 || got[0] != "staff@aoto.example.test" {
		t.Fatalf("mailed %v", got)
	}
	text := mailer.sent[0].email.Text
	for _, fragment := range []string{"It opens now, thank you.", "About my purchase", "reader@example.test"} {
		if !strings.Contains(text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, text)
		}
	}
	if strings.Contains(text, "Episode 3 is still locked.") {
		t.Errorf("the mail quotes the original message instead of the reply:\n%s", text)
	}

	// An entry that is not a reader reply to this message is a row written
	// around the webhook, which no retry turns into one.
	staffEntry := env.storeEntry(t, ctx, dbmodels.CreateContactMessageEntryParams{
		Direction: "staff",
		Body:      "An answer.",
		MessageID: sql.NullString{String: "answer-1@aoto.example.test", Valid: true},
	})
	err = env.handler(&recordingMailer{})(ctx, env.entryEvent(t, staffEntry.ID))
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error for a staff entry = %v, want a permanent one", err)
	}
}

func (e contactMessageEnv) entryEvent(t *testing.T, entryID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.ContactMessageStaffEmailPayload{
		TenantID:  e.tenantID.String(),
		MessageID: e.messageID.String(),
		EntryID:   entryID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypeContactMessageStaffEmail,
		Payload:        payload,
		IdempotencyKey: outbox.ContactMessageReplyStaffEmailIdempotencyKey(entryID),
	}
}
