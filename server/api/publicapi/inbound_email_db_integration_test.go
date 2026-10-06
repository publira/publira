package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/inboundemail"
	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/inboundprovider/inboundprovidertest"
	inboundproviders "github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/inboundprovider/providers/providerstest"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

const inboundTestDomain = "reply.example.com"

// inboundHarness delivers inbound mail to the public API over a real database,
// one fresh tenant per scenario, for every registered provider.
type inboundHarness struct {
	pg        *testutil.PostgresEnv
	encryptor inboundemail.SecretManager
	server    *apiServer
	client    publirav1connect.ContactServiceClient
	tenants   int
}

func newInboundHarness(t *testing.T) *inboundHarness {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newPublicTestEncryptor(t)
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	return &inboundHarness{
		pg:        pg,
		encryptor: encryptor,
		server:    server,
		client:    publirav1connect.NewContactServiceClient(ts.Client(), ts.URL),
	}
}

// inboundTenant is one tenant with a contact message staff answered once.
type inboundTenant struct {
	tenant          testutil.Tenant
	messageID       uuid.UUID
	messagePublicID string
	// answerMessageID is the Message-ID the staff answer went out with.
	answerMessageID string
}

func (h *inboundHarness) newTenant(t *testing.T, fixture inboundprovidertest.Fixture, enabled bool) inboundTenant {
	t.Helper()
	h.tenants++
	n := h.tenants
	tenant := h.pg.SeedTenant(t, fmt.Sprintf("INBOUND%02d", n), fmt.Sprintf("inbound-%d.example.com", n), "Inbound tenant")
	staff := h.pg.SeedTenantAdmin(t, tenant.ID, fmt.Sprintf("INBSTAFF%02d", n), fmt.Sprintf("staff-%d@example.com", n), "Staff")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	declaration := fixture.Provider().Declaration()
	var fields []inboundemail.FieldUpdate
	for name, value := range fixture.Credentials() {
		fields = append(fields, inboundemail.FieldUpdate{Name: name, Mode: secretupdate.Replace, Value: value})
	}
	store := inboundemail.New(dbmodels.New(h.pg.DB), h.encryptor, inboundproviders.Registry(), nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, inboundemail.UpdateInput{
		Provider: declaration.ID,
		Enabled:  enabled,
		Domain:   inboundTestDomain,
		Fields:   fields,
	}, inboundemail.AuditMeta{}); err != nil {
		t.Fatalf("upsert inbound email settings: %v", err)
	}

	// The message has been answered, so it is handled, and the answer is the
	// entry a reply names.
	messageID := uuid.New()
	publicID := fmt.Sprintf("InbMsg%06d", n)
	answerMessageID := fmt.Sprintf("answer-%d@inbound-%d.example.com", n, n)
	if _, err := h.pg.DB.ExecContext(ctx, `
		INSERT INTO contact_messages (id, tenant_id, public_id, reply_to_email, subject, body, handled_at, handled_by)
		VALUES ($1, $2, $3, 'reader@example.net', 'About my purchase', 'Episode 3 is still locked.', NOW(), $4)
	`, messageID, tenant.ID, publicID, staff.ID); err != nil {
		t.Fatalf("seed the contact message: %v", err)
	}
	if _, err := h.pg.DB.ExecContext(ctx, `
		INSERT INTO contact_message_entries (id, tenant_id, contact_message_id, direction, author_id, body, message_id)
		VALUES ($1, $2, $3, 'staff', $4, 'We have restored your purchase.', $5)
	`, uuid.New(), tenant.ID, messageID, staff.ID, answerMessageID); err != nil {
		t.Fatalf("seed the staff answer: %v", err)
	}
	return inboundTenant{tenant: tenant, messageID: messageID, messagePublicID: publicID, answerMessageID: answerMessageID}
}

func (h *inboundHarness) deliver(t *testing.T, tenant testutil.Tenant, providerID string, payload []byte, headers http.Header) error {
	t.Helper()
	forwarded := make(map[string]string, len(headers))
	for name := range headers {
		forwarded[name] = headers.Get(name)
	}
	_, err := h.client.ProcessInboundEmailWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessInboundEmailWebhookRequest{
		Tenant:   tenantContext(tenant),
		Provider: providerID,
		Payload:  payload,
		Headers:  forwarded,
	}))
	return err
}

type storedReaderEntry struct {
	contactMessageID uuid.UUID
	body             string
	messageID        sql.NullString
	fromEmail        string
}

func (h *inboundHarness) readerEntries(t *testing.T, tenantID uuid.UUID) []storedReaderEntry {
	t.Helper()
	rows, err := h.pg.DB.QueryContext(context.Background(), `
		SELECT contact_message_id, body, message_id, from_email
		FROM contact_message_entries
		WHERE tenant_id = $1 AND direction = 'reader'
		ORDER BY created_at
	`, tenantID)
	if err != nil {
		t.Fatalf("read reader entries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var entries []storedReaderEntry
	for rows.Next() {
		var entry storedReaderEntry
		if err := rows.Scan(&entry.contactMessageID, &entry.body, &entry.messageID, &entry.fromEmail); err != nil {
			t.Fatalf("scan reader entry: %v", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read reader entries: %v", err)
	}
	return entries
}

// staffNotices answers the payloads of the staff mails queued on tenantID.
func (h *inboundHarness) staffNotices(t *testing.T, tenantID uuid.UUID) []outbox.ContactMessageStaffEmailPayload {
	t.Helper()
	rows, err := h.pg.DB.QueryContext(context.Background(), `
		SELECT payload, idempotency_key
		FROM outbox_events
		WHERE tenant_id = $1 AND event_type = $2
	`, tenantID, outbox.EventTypeContactMessageStaffEmail)
	if err != nil {
		t.Fatalf("read queued staff mails: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var payloads []outbox.ContactMessageStaffEmailPayload
	for rows.Next() {
		var raw []byte
		var key string
		if err := rows.Scan(&raw, &key); err != nil {
			t.Fatalf("scan queued staff mail: %v", err)
		}
		var payload outbox.ContactMessageStaffEmailPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode queued staff mail: %v", err)
		}
		entryID, err := uuid.Parse(payload.EntryID)
		if err != nil || key != outbox.ContactMessageReplyStaffEmailIdempotencyKey(entryID) {
			t.Fatalf("staff mail key = %q for entry %q", key, payload.EntryID)
		}
		payloads = append(payloads, payload)
	}
	return payloads
}

func (h *inboundHarness) handledAt(t *testing.T, tenantID, messageID uuid.UUID) sql.NullTime {
	t.Helper()
	var handledAt sql.NullTime
	var handledBy uuid.NullUUID
	if err := h.pg.DB.QueryRowContext(context.Background(),
		`SELECT handled_at, handled_by FROM contact_messages WHERE tenant_id = $1 AND id = $2`,
		tenantID, messageID,
	).Scan(&handledAt, &handledBy); err != nil {
		t.Fatalf("read the contact message: %v", err)
	}
	if handledAt.Valid != handledBy.Valid {
		t.Fatalf("handled_at %v and handled_by %v disagree", handledAt, handledBy)
	}
	return handledAt
}

func TestDBEveryRegisteredInboundProviderStoresAReply(t *testing.T) {
	harness := newInboundHarness(t)
	for _, provider := range inboundproviders.Registry().Providers() {
		id := provider.Declaration().ID
		t.Run(id, func(t *testing.T) {
			fixture, ok := providerstest.Fixture(t, id)
			if !ok {
				t.Fatalf("provider %q has no contract fixture in providerstest", id)
			}
			// The server has to read the fixture's fake of the provider's API.
			harness.server.inboundProviders = inboundprovider.NewRegistry(fixture.Provider())
			runInboundScenarios(t, harness, fixture, id)
		})
	}
}

func runInboundScenarios(t *testing.T, h *inboundHarness, fixture inboundprovidertest.Fixture, providerID string) {
	credentials := fixture.Credentials()
	reply := func(seeded inboundTenant) inboundprovidertest.Mail {
		return inboundprovidertest.Mail{
			From:      "reader.alt@example.org",
			To:        "contact+" + seeded.messagePublicID + "@" + inboundTestDomain,
			Subject:   "Re: About my purchase",
			Text:      "It opens now, thank you.\n\nOn Mon, Oct 5, 2026, Inbound tenant <contact+" + seeded.messagePublicID + "@" + inboundTestDomain + "> wrote:\n> We have restored your purchase.\n",
			MessageID: "reply-" + uuid.NewString() + "@example.org",
			InReplyTo: seeded.answerMessageID,
		}
	}

	t.Run("a reply to the message's address is stored under it and reopens it once", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		mail := reply(seeded)
		mail.InReplyTo = ""
		payload, headers := fixture.Received(t, credentials, mail)
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}

		entries := h.readerEntries(t, seeded.tenant.ID)
		if len(entries) != 1 {
			t.Fatalf("stored %d reader entries, want 1", len(entries))
		}
		entry := entries[0]
		if entry.contactMessageID != seeded.messageID {
			t.Errorf("entry is under message %s, want %s", entry.contactMessageID, seeded.messageID)
		}
		if entry.body != "It opens now, thank you." {
			t.Errorf("body = %q, want the reply without the quoted answer", entry.body)
		}
		if entry.fromEmail != mail.From {
			t.Errorf("from_email = %q, want %q", entry.fromEmail, mail.From)
		}
		if entry.messageID.String != mail.MessageID {
			t.Errorf("message_id = %q, want %q", entry.messageID.String, mail.MessageID)
		}
		if handledAt := h.handledAt(t, seeded.tenant.ID, seeded.messageID); handledAt.Valid {
			t.Errorf("the message is still handled at %v, want it waiting again", handledAt.Time)
		}
		notices := h.staffNotices(t, seeded.tenant.ID)
		if len(notices) != 1 || notices[0].MessageID != seeded.messageID.String() {
			t.Fatalf("queued staff mails = %+v, want one about message %s", notices, seeded.messageID)
		}

		// A provider delivers the same mail again when it is not sure the first
		// delivery landed. It is acknowledged and changes nothing.
		payload, headers = fixture.Received(t, credentials, mail)
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook (again): %v", err)
		}
		if entries := h.readerEntries(t, seeded.tenant.ID); len(entries) != 1 {
			t.Fatalf("stored %d reader entries after a redelivery, want 1", len(entries))
		}
		if notices := h.staffNotices(t, seeded.tenant.ID); len(notices) != 1 {
			t.Fatalf("queued %d staff mails after a redelivery, want 1", len(notices))
		}
	})

	t.Run("a reply sent elsewhere is matched by the answer it names", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		mail := reply(seeded)
		mail.To = "staff-member@inbound.example.com"
		mail.InReplyTo = ""
		mail.References = []string{"unrelated@example.org", seeded.answerMessageID}
		payload, headers := fixture.Received(t, credentials, mail)
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}
		entries := h.readerEntries(t, seeded.tenant.ID)
		if len(entries) != 1 || entries[0].contactMessageID != seeded.messageID {
			t.Fatalf("reader entries = %+v, want one under message %s", entries, seeded.messageID)
		}
		if notices := h.staffNotices(t, seeded.tenant.ID); len(notices) != 1 {
			t.Fatalf("queued %d staff mails, want 1", len(notices))
		}
	})

	t.Run("a mail that matches no message is acknowledged and dropped", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		mail := reply(seeded)
		mail.To = "contact+NoSuchMsg001@" + inboundTestDomain
		mail.InReplyTo = "unknown@example.org"
		payload, headers := fixture.Received(t, credentials, mail)
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}
		h.assertNothingStored(t, seeded)
	})

	t.Run("a mail to the address on another domain is not matched by it", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		mail := reply(seeded)
		mail.To = "contact+" + seeded.messagePublicID + "@elsewhere.example.com"
		mail.InReplyTo = ""
		payload, headers := fixture.Received(t, credentials, mail)
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}
		h.assertNothingStored(t, seeded)
	})

	t.Run("a mail on a tenant whose inbound email is not ready is acknowledged and dropped", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, false)
		payload, headers := fixture.Received(t, credentials, reply(seeded))
		if err := h.deliver(t, seeded.tenant, providerID, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}
		h.assertNothingStored(t, seeded)
	})

	t.Run("a mail from another provider than the tenant's is acknowledged and dropped", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		other := "sendgrid"
		if providerID == other {
			other = "resend"
		}
		h.server.inboundProviders = inboundproviders.Registry()
		defer func() { h.server.inboundProviders = inboundprovider.NewRegistry(fixture.Provider()) }()
		payload, headers := fixture.Received(t, credentials, reply(seeded))
		if err := h.deliver(t, seeded.tenant, other, payload, headers); err != nil {
			t.Fatalf("ProcessInboundEmailWebhook: %v", err)
		}
		h.assertNothingStored(t, seeded)
	})

	t.Run("a request that does not verify stores nothing", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		payload, headers := fixture.Received(t, fixture.OtherCredentials(), reply(seeded))
		err := h.deliver(t, seeded.tenant, providerID, payload, headers)
		if connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("ProcessInboundEmailWebhook error = %v, want unauthenticated", err)
		}
		h.assertNothingStored(t, seeded)
	})

	t.Run("an unregistered provider is not found", func(t *testing.T) {
		seeded := h.newTenant(t, fixture, true)
		payload, headers := fixture.Received(t, credentials, reply(seeded))
		err := h.deliver(t, seeded.tenant, "mailgun", payload, headers)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("ProcessInboundEmailWebhook error = %v, want not_found", err)
		}
	})
}

func (h *inboundHarness) assertNothingStored(t *testing.T, seeded inboundTenant) {
	t.Helper()
	if entries := h.readerEntries(t, seeded.tenant.ID); len(entries) != 0 {
		t.Errorf("stored %d reader entries, want none", len(entries))
	}
	if notices := h.staffNotices(t, seeded.tenant.ID); len(notices) != 0 {
		t.Errorf("queued %d staff mails, want none", len(notices))
	}
	if handledAt := h.handledAt(t, seeded.tenant.ID, seeded.messageID); !handledAt.Valid {
		t.Error("the message was reopened")
	}
}
