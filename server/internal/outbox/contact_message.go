package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// EventTypeContactMessageStaffEmail tells a tenant's staff that a reader wrote
// in through the contact form.
//
// It is drained here rather than sent by the RPC that stored the message: the
// recipients are every member of staff the tenant has, and a reader waiting for
// their message to be accepted must not wait on a send per person or watch the
// submission fail because a mail server did.
const EventTypeContactMessageStaffEmail = "contact_message_staff_email"

// ContactMessageStaffEmailPayload names the stored message the mail is about
// and nothing else. The worker reloads it, so a message purged between the
// submission and the send cannot be mailed out after it is gone.
//
// EntryID names the reader's emailed reply the mail is about instead of the
// message itself, and is empty for the message as the reader first sent it.
type ContactMessageStaffEmailPayload struct {
	TenantID  string `json:"tenant_id"`
	MessageID string `json:"message_id"`
	EntryID   string `json:"entry_id,omitempty"`
}

// ContactMessageStaffEmailIdempotencyKey is the outbox key for one message's
// mail. It names the message, so a submission retried inside its transaction
// still announces itself once.
func ContactMessageStaffEmailIdempotencyKey(messageID uuid.UUID) string {
	return EventTypeContactMessageStaffEmail + ":" + messageID.String()
}

// ContactMessageReplyStaffEmailIdempotencyKey is the outbox key for the mail
// about one reader reply. It names the entry, so each reply is announced once
// and none of them collides with the message's own announcement.
func ContactMessageReplyStaffEmailIdempotencyKey(entryID uuid.UUID) string {
	return EventTypeContactMessageStaffEmail + ":entry:" + entryID.String()
}

// NewContactMessageStaffEmailHandler sends one tenant's staff the message a
// reader addressed to them, or the reply a reader mailed back to an answer,
// which is announced with the same mail: it is the reader writing in again,
// and the message it reopened is waiting for staff as a new one would.
//
// Every recipient gets the same mail, so it is composed once and delivered per
// address. A send that fails partway fails the event, and the retry mails the
// whole list again: a colleague receiving the same message twice is a nuisance,
// while dropping the rest of the list would leave a reader's question with
// nobody who knows it arrived.
func NewContactMessageStaffEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("contact message staff email"); err != nil {
			return err
		}
		tenantID, messageID, entryID, err := contactMessageStaffEmailIDs(event)
		if err != nil {
			return Permanent(err)
		}

		tenant, err := queries.GetTenantByID(ctx, tenantID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("contact message tenant %s no longer exists", tenantID))
		}
		if err != nil {
			return fmt.Errorf("load contact message tenant: %w", err)
		}
		message, err := queries.GetContactMessageByIDForTenant(ctx, dbmodels.GetContactMessageByIDForTenantParams{
			TenantID: tenantID,
			ID:       messageID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("contact message %s no longer exists", messageID))
		}
		if err != nil {
			return fmt.Errorf("load contact message: %w", err)
		}
		writing := contactMessageWriting{body: message.Body, receivedAt: message.CreatedAt}
		if entryID.Valid {
			entry, err := queries.GetContactMessageEntryForTenant(ctx, dbmodels.GetContactMessageEntryForTenantParams{
				TenantID: tenantID,
				ID:       entryID.UUID,
			})
			if errors.Is(err, sql.ErrNoRows) {
				return Permanent(fmt.Errorf("contact message entry %s no longer exists", entryID.UUID))
			}
			if err != nil {
				return fmt.Errorf("load contact message entry: %w", err)
			}
			if entry.Direction != "reader" || entry.ContactMessageID != messageID {
				return Permanent(fmt.Errorf("contact message entry %s is not a reader reply to message %s", entryID.UUID, messageID))
			}
			writing = contactMessageWriting{body: entry.Body, receivedAt: entry.CreatedAt}
		}

		// Before the SMTP settings, which fail retriably: a tenant locale no
		// catalog covers cannot become renderable on a later attempt, and an
		// unrelated outage must not disguise it as one that can.
		tenantLocale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return Permanent(fmt.Errorf("resolve default locale of tenant %s: %w", tenantID, err))
		}

		recipients, err := queries.ListTenantStaffContactRecipients(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("list tenant staff: %w", err)
		}
		if len(recipients) == 0 {
			// A tenant whose staff accounts were all deactivated has nobody to
			// tell. Completing is the honest answer: a retry would find the same
			// empty list, and the message itself is stored and waiting in the
			// console for whoever takes the tenant over.
			logContactMessage(ctx, cfg, event, "no staff to mail about a contact message")
			return nil
		}

		settings, err := resolveSMTPSettings(ctx, queries, tenant, cfg.Encryptor)
		if err != nil {
			return fmt.Errorf("resolve smtp settings: %w", err)
		}
		request := contactMessageStaffEmailRequest(ctx, queries, tenant, message, writing, tenantLocale)
		for _, recipient := range recipients {
			if err := deliverEmail(ctx, cfg, settings, recipient, request); err != nil {
				return err
			}
		}
		return nil
	}
}

// contactMessageStaffEmailIDs takes the tenant from the event row and checks
// the payload agrees. The table already enforces the pair, so a disagreement is
// a row written around the producer.
func contactMessageStaffEmailIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, uuid.NullUUID, error) {
	var payload ContactMessageStaffEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, uuid.NullUUID{}, fmt.Errorf("decode contact message staff email payload: %w", err)
	}
	tenantID, err := uuid.Parse(strings.TrimSpace(payload.TenantID))
	if err != nil || !event.TenantID.Valid || tenantID != event.TenantID.UUID {
		return uuid.Nil, uuid.Nil, uuid.NullUUID{}, errors.New("contact message staff email payload has an invalid tenant_id")
	}
	messageID, err := uuid.Parse(strings.TrimSpace(payload.MessageID))
	if err != nil {
		return uuid.Nil, uuid.Nil, uuid.NullUUID{}, errors.New("contact message staff email payload has an invalid message_id")
	}
	var entryID uuid.NullUUID
	if raw := strings.TrimSpace(payload.EntryID); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			return uuid.Nil, uuid.Nil, uuid.NullUUID{}, errors.New("contact message staff email payload has an invalid entry_id")
		}
		entryID = uuid.NullUUID{UUID: parsed, Valid: true}
	}
	return tenantID, messageID, entryID, nil
}

// contactMessageWriting is what the reader wrote that a staff mail announces:
// the message itself, or a reply they mailed back to an answer.
type contactMessageWriting struct {
	body       string
	receivedAt time.Time
}

// contactMessageStaffEmailRequest fills the mail in. The sender's name and the
// subject reach it as the empty string when the message carries neither, which
// is what the template leaves the matching line out on.
func contactMessageStaffEmailRequest(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenant dbmodels.Tenant,
	message dbmodels.GetContactMessageByIDForTenantRow,
	writing contactMessageWriting,
	tenantLocale string,
) emailrenderer.Request {
	tenantName := strings.TrimSpace(tenant.Name)
	if tenantName == "" {
		tenantName = "Publira"
	}
	return emailrenderer.Request{
		Template: "staff_contact_message_notice",
		Locale:   tenantLocale,
		Data: map[string]any{
			"body":           writing.body,
			"received_at":    writing.receivedAt.UTC().Format(time.RFC3339Nano),
			"reply_to_email": message.ReplyToEmail,
			"sender_name":    strings.TrimSpace(message.SenderName.String),
			"subject":        contactMessageSubjectLine(message.Subject.String),
			"tenant_name":    tenantName,
		},
		TimeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	}
}

// contactMessageSubjectLine is a reader's subject as one line. The contact
// form trims a subject but keeps what is inside it, so a stored one may hold a
// line break: a mail header cannot carry it, and the template refuses it, so a
// mail quoting it as it is would be retried until it died. Every run of
// whitespace becomes one space instead, which is how the subject reads anyway.
func contactMessageSubjectLine(subject string) string {
	return strings.Join(strings.Fields(subject), " ")
}

func logContactMessage(ctx context.Context, cfg EmailHandlerConfig, event dbmodels.OutboxEvent, message string) {
	if cfg.Logger == nil {
		return
	}
	cfg.Logger.InfoContext(ctx, message,
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	)
}
