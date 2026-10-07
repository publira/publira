package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/inboundemail"
	inboundproviders "github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// EventTypeContactMessageReplyEmail takes an answer staff wrote in the console
// to the reader who sent the message.
//
// It is drained here rather than sent by the RPC that stored the answer: the
// member of staff would otherwise wait on the mail server, and a send that
// failed would lose an answer that is already written.
const EventTypeContactMessageReplyEmail = "contact_message_reply_email"

// ContactMessageReplyEmailPayload names the stored entry the mail sends. The
// worker reloads it, so a message purged before the send is not mailed out
// after it is gone.
type ContactMessageReplyEmailPayload struct {
	TenantID string `json:"tenant_id"`
	EntryID  string `json:"entry_id"`
}

// ContactMessageReplyEmailIdempotencyKey is the outbox key for one answer's
// mail. It names the entry, so however often the event is retried or queued
// again, one answer is one mail.
func ContactMessageReplyEmailIdempotencyKey(entryID uuid.UUID) string {
	return EventTypeContactMessageReplyEmail + ":" + entryID.String()
}

// NewContactMessageReplyMessageID is the Message-ID an answer goes out with,
// without its angle brackets, on the host of the tenant's storefront.
//
// It is made when the answer is stored rather than when the mail is sent, and
// stored with it: every attempt then sends the same id, so a mail delivered by
// an attempt the worker never heard back from is one a mail client can
// recognise when the retry arrives, and the reader's reply can be matched to
// the entry by its In-Reply-To. The left part is random rather than the
// entry's id, so it says nothing about when the answer was written.
func NewContactMessageReplyMessageID(tenant dbmodels.Tenant) (string, error) {
	host := strings.TrimSpace(tenant.Domain)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")
	if withoutPort, _, err := net.SplitHostPort(host); err == nil {
		host = withoutPort
	}
	if host == "" {
		return "", errors.New("tenant domain is not configured")
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return "", fmt.Errorf("generate message id: %w", err)
	}
	return id.String() + "@" + host, nil
}

// NewContactMessageReplyEmailHandler sends the reader one answer staff wrote.
//
// It goes out from the tenant's SMTP settings like every other mail of the
// tenant. The Message-ID is the one stored on the entry, and In-Reply-To and
// References name the entries before it, so the reader's mail client threads
// the answers to one message together.
func NewContactMessageReplyEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("contact message reply email"); err != nil {
			return err
		}
		tenantID, entryID, err := contactMessageReplyEmailIDs(event)
		if err != nil {
			return Permanent(err)
		}

		tenant, err := queries.GetTenantByID(ctx, tenantID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("contact message reply tenant %s no longer exists", tenantID))
		}
		if err != nil {
			return fmt.Errorf("load contact message reply tenant: %w", err)
		}
		entry, err := queries.GetContactMessageEntryForTenant(ctx, dbmodels.GetContactMessageEntryForTenantParams{
			TenantID: tenantID,
			ID:       entryID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("contact message entry %s no longer exists", entryID))
		}
		if err != nil {
			return fmt.Errorf("load contact message entry: %w", err)
		}
		if entry.Direction != "staff" || !entry.MessageID.Valid {
			return Permanent(fmt.Errorf("contact message entry %s is not a staff answer", entryID))
		}
		message, err := queries.GetContactMessageByIDForTenant(ctx, dbmodels.GetContactMessageByIDForTenantParams{
			TenantID: tenantID,
			ID:       entry.ContactMessageID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("contact message %s no longer exists", entry.ContactMessageID))
		}
		if err != nil {
			return fmt.Errorf("load contact message: %w", err)
		}

		// Before the SMTP settings, which fail retriably, for the reason the
		// staff notice gives.
		tenantLocale, err := locale.Resolve(tenant.DefaultLocale)
		if err != nil {
			return Permanent(fmt.Errorf("resolve default locale of tenant %s: %w", tenantID, err))
		}

		earlier, err := queries.ListContactMessageEntryMessageIDsBefore(ctx, dbmodels.ListContactMessageEntryMessageIDsBeforeParams{
			TenantID:         tenantID,
			ContactMessageID: entry.ContactMessageID,
			BeforeCreatedAt:  entry.CreatedAt,
			BeforeID:         entry.ID,
		})
		if err != nil {
			return fmt.Errorf("list earlier contact message entries: %w", err)
		}
		inbound, err := inboundemail.New(queries, nil, inboundproviders.Registry(), nil, cfg.Logger).GetPublic(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("load tenant inbound email settings: %w", err)
		}
		headers := mailHeaders{
			ReplyTo:   contactMessageReplyTo(entry, message.PublicID, inbound),
			MessageID: entry.MessageID.String,
		}
		if len(earlier) > 0 {
			headers.InReplyTo = earlier[len(earlier)-1]
			headers.References = earlier
		}

		settings, err := resolveSMTPSettings(ctx, queries, tenant, cfg.Encryptor)
		if err != nil {
			return fmt.Errorf("resolve smtp settings: %w", err)
		}
		request := contactMessageReplyEmailRequest(ctx, queries, tenant, message, entry, tenantLocale)
		return deliverEmailWithHeaders(ctx, cfg, settings, message.ReplyToEmail, request, headers)
	}
}

// contactMessageReplyTo is where the reader's reply to an answer goes.
//
// On a tenant whose inbound email is ready it is the message's own address on
// the inbound domain, which is what lets the reply be stored under the
// message whatever headers the reader's mail client keeps.
//
// Otherwise it is the account address of the member of staff who wrote the
// answer, so the exchange carries on with the person who answered. An author
// whose account was deleted or can no longer sign in names nobody, and the
// mail falls back on the Reply-To of the tenant's SMTP settings, as every
// other mail of the tenant does.
func contactMessageReplyTo(entry dbmodels.GetContactMessageEntryForTenantRow, messagePublicID string, inbound inboundemail.PublicConfig) string {
	if inbound.Ready {
		return inbound.ReplyAddress(messagePublicID)
	}
	if !entry.AuthorEmail.Valid || entry.AuthorStatus.String != "active" {
		return ""
	}
	return strings.TrimSpace(entry.AuthorEmail.String)
}

// contactMessageReplyEmailIDs takes the tenant from the event row and checks
// the payload agrees, as contactMessageStaffEmailIDs does.
func contactMessageReplyEmailIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, error) {
	var payload ContactMessageReplyEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("decode contact message reply email payload: %w", err)
	}
	tenantID, err := uuid.Parse(strings.TrimSpace(payload.TenantID))
	if err != nil || !event.TenantID.Valid || tenantID != event.TenantID.UUID {
		return uuid.Nil, uuid.Nil, errors.New("contact message reply email payload has an invalid tenant_id")
	}
	entryID, err := uuid.Parse(strings.TrimSpace(payload.EntryID))
	if err != nil {
		return uuid.Nil, uuid.Nil, errors.New("contact message reply email payload has an invalid entry_id")
	}
	return tenantID, entryID, nil
}

// contactMessageReplyEmailRequest fills the mail in. The original subject
// reaches it as the empty string for a message the reader gave none, which is
// what the copy picks its other subject line on.
func contactMessageReplyEmailRequest(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenant dbmodels.Tenant,
	message dbmodels.GetContactMessageByIDForTenantRow,
	entry dbmodels.GetContactMessageEntryForTenantRow,
	tenantLocale string,
) emailrenderer.Request {
	tenantName := strings.TrimSpace(tenant.Name)
	if tenantName == "" {
		tenantName = "Publira"
	}
	return emailrenderer.Request{
		Template: "staff_contact_reply",
		Locale:   tenantLocale,
		Data: map[string]any{
			"body":                 entry.Body,
			"original_body":        message.Body,
			"original_received_at": message.CreatedAt.UTC().Format(time.RFC3339Nano),
			"original_subject":     contactMessageSubjectLine(message.Subject.String),
			"tenant_name":          tenantName,
		},
		TimeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	}
}
