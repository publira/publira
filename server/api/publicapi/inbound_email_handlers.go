package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/inboundemail"
	"github.com/publira/publira/server/internal/inboundprovider"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	// maxInboundEmailWebhookPayload bounds one request. SendGrid posts a mail
	// with its attachments, and accepts mail of up to 30 MB.
	maxInboundEmailWebhookPayload = 32 << 20
	// maxInboundEmailMessageIDLength is the longest Message-ID an entry
	// keeps, the length contact_message_entries_message_id_check allows.
	maxInboundEmailMessageIDLength = 998
	// maxInboundEmailThreadIDs bounds how many ids of a mail's In-Reply-To and
	// References are looked up. A long thread names every mail before it, and
	// the most recent ones are the ones that can name an entry.
	maxInboundEmailThreadIDs = 50
)

func (s *apiServer) inboundEmailStore(ctx context.Context) *inboundemail.Store {
	return inboundemail.New(s.queriesFor(ctx), s.encryptor, s.inboundProviders, nil, s.logger)
}

// ProcessInboundEmailWebhook stores a reader's emailed reply under the contact
// message it answers.
//
// Everything that can never become storable is acknowledged rather than
// refused: a provider redelivers what it is refused, so refusing a mail that
// matches no message, or that arrived before the tenant finished setting
// inbound email up, would only have it delivered again for days. Only what the
// provider can correct — a request that does not verify, one it cannot have
// meant, an API of its that did not answer — is answered with an error.
func (s *apiServer) ProcessInboundEmailWebhook(
	ctx context.Context,
	req *connect.Request[publirav1.ProcessInboundEmailWebhookRequest],
) (*connect.Response[publirav1.ProcessInboundEmailWebhookResponse], error) {
	providerID := strings.TrimSpace(req.Msg.Provider)
	provider, ok := s.inboundProviders.Lookup(providerID)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("inbound email provider not found"))
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	acknowledged := connect.NewResponse(&publirav1.ProcessInboundEmailWebhookResponse{})

	config, credentials, err := s.inboundEmailStore(ctx).LoadEnabledSecrets(ctx, tenant.ID)
	if inboundemail.IsUnavailable(err) {
		s.logger.WarnContext(ctx, "inbound email arrived on a tenant whose inbound email is not ready and was dropped",
			"tenant_id", tenant.ID,
			"provider", providerID,
			"reason", err,
		)
		return acknowledged, nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load tenant inbound email settings", err, "tenant_id", tenant.ID.String())
	}
	if config.Provider != providerID {
		s.logger.WarnContext(ctx, "inbound email arrived from a provider the tenant does not use and was dropped",
			"tenant_id", tenant.ID,
			"provider", providerID,
			"tenant_provider", config.Provider,
		)
		return acknowledged, nil
	}
	if len(req.Msg.Payload) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid inbound email webhook payload"))
	}
	if len(req.Msg.Payload) > maxInboundEmailWebhookPayload {
		s.logger.WarnContext(ctx, "inbound email is larger than the webhook reads and was dropped",
			"tenant_id", tenant.ID,
			"provider", providerID,
			"bytes", len(req.Msg.Payload),
		)
		return acknowledged, nil
	}

	headers := make(http.Header, len(req.Msg.Headers))
	for name, value := range req.Msg.Headers {
		headers.Set(name, value)
	}
	result, err := provider.ParseWebhook(ctx, req.Msg.Payload, headers, credentials)
	switch {
	case errors.Is(err, inboundprovider.ErrInvalidSignature):
		s.logger.WarnContext(ctx, "invalid inbound email webhook signature", "tenant_id", tenant.ID, "provider", providerID)
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid inbound email webhook signature"))
	case errors.Is(err, inboundprovider.ErrMalformedRequest):
		s.logger.WarnContext(ctx, "malformed inbound email webhook", "tenant_id", tenant.ID, "provider", providerID, "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid inbound email webhook"))
	case errors.Is(err, inboundprovider.ErrProviderUnavailable):
		s.logger.WarnContext(ctx, "inbound email provider did not answer", "tenant_id", tenant.ID, "provider", providerID, "error", err)
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("inbound email provider is unavailable"))
	case err != nil:
		return nil, s.internalError(ctx, "inbound email webhook could not be processed", err, "tenant_id", tenant.ID.String(), "provider", providerID)
	}

	msg, ok := result.(inboundprovider.Message)
	if !ok {
		s.logger.InfoContext(ctx, "inbound email webhook carried no received mail",
			"tenant_id", tenant.ID,
			"provider", providerID,
			"request_id", result.RequestID(),
		)
		return acknowledged, nil
	}
	if err := s.storeInboundReply(ctx, tenant.ID, config, providerID, msg); err != nil {
		return nil, err
	}
	return acknowledged, nil
}

// storeInboundReply matches msg to its message and stores it there. A mail
// that matches nothing, or holds nothing to store, is logged and dropped.
func (s *apiServer) storeInboundReply(
	ctx context.Context,
	tenantID uuid.UUID,
	config inboundemail.PublicConfig,
	providerID string,
	msg inboundprovider.Message,
) error {
	logAttrs := []any{
		"tenant_id", tenantID,
		"provider", providerID,
		"request_id", msg.ID,
	}
	messageID, matchedBy, err := s.matchInboundReply(ctx, tenantID, config, msg)
	if err != nil {
		return s.internalDBError(ctx, "failed to match an inbound email to a contact message", err, logAttrs...)
	}
	if messageID == uuid.Nil {
		s.logger.InfoContext(ctx, "inbound email matches no contact message and was dropped", logAttrs...)
		return nil
	}
	logAttrs = append(logAttrs, "contact_message_id", messageID, "matched_by", matchedBy)

	body, truncated := inboundReplyBody(msg.Text)
	if body == "" {
		s.logger.InfoContext(ctx, "inbound email holds no text and was dropped", logAttrs...)
		return nil
	}
	if truncated {
		s.logger.InfoContext(ctx, "inbound email is longer than an entry holds and was truncated", logAttrs...)
	}
	from := strings.TrimSpace(msg.From)
	if from == "" || len(from) > maxContactReplyToBytes || !inboundprovider.ValidText(from) {
		s.logger.InfoContext(ctx, "inbound email names a sender an entry cannot hold and was dropped", logAttrs...)
		return nil
	}
	var mailID sql.NullString
	if id := msg.MessageID; id != "" && len(id) <= maxInboundEmailMessageIDLength && inboundprovider.ValidText(id) {
		mailID = sql.NullString{String: id, Valid: true}
	}

	stored, err := s.storeReaderEntry(ctx, dbmodels.CreateReaderContactMessageEntryParams{
		TenantID:         tenantID,
		ContactMessageID: messageID,
		Body:             body,
		MessageID:        mailID,
		FromEmail:        sql.NullString{String: from, Valid: true},
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to store an inbound email under its contact message", err, logAttrs...)
	}
	if !stored {
		s.logger.InfoContext(ctx, "inbound email was delivered again and is already stored", logAttrs...)
		return nil
	}
	s.logger.InfoContext(ctx, "stored an inbound email under its contact message", logAttrs...)
	return nil
}

// matchInboundReply answers the message msg replies to, and how it was found:
// by the per-message address it was sent to first, because that is the one
// answer the mail names itself, and by the entries its In-Reply-To and
// References name otherwise, most recent first. uuid.Nil means no message.
func (s *apiServer) matchInboundReply(
	ctx context.Context,
	tenantID uuid.UUID,
	config inboundemail.PublicConfig,
	msg inboundprovider.Message,
) (uuid.UUID, string, error) {
	queries := s.queriesFor(ctx)
	for _, recipient := range msg.Recipients {
		publicID, ok := config.MessagePublicID(recipient)
		if !ok {
			continue
		}
		message, err := queries.GetContactMessageByPublicIDForTenant(ctx, dbmodels.GetContactMessageByPublicIDForTenantParams{
			TenantID: tenantID,
			PublicID: publicID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return uuid.Nil, "", err
		}
		return message.ID, "address", nil
	}

	var ids []string
	for _, list := range [][]string{msg.InReplyTo, msg.References} {
		for _, id := range slices.Backward(list) {
			if id != "" && !slices.Contains(ids, id) && len(ids) < maxInboundEmailThreadIDs {
				ids = append(ids, id)
			}
		}
	}
	if len(ids) == 0 {
		return uuid.Nil, "", nil
	}
	rows, err := queries.ListContactMessageEntriesByMessageIDs(ctx, dbmodels.ListContactMessageEntriesByMessageIDsParams{
		TenantID:   tenantID,
		MessageIds: ids,
	})
	if err != nil {
		return uuid.Nil, "", err
	}
	for _, id := range ids {
		for _, row := range rows {
			if row.MessageID == id {
				return row.ContactMessageID, "thread", nil
			}
		}
	}
	return uuid.Nil, "", nil
}

// inboundReplyBody is what an entry keeps of a mail's text: the reply without
// the quotation below it, or the whole text when it is nothing but a
// quotation, cut to the length an entry holds. It reports whether it cut.
func inboundReplyBody(text string) (string, bool) {
	text = strings.ToValidUTF8(strings.ReplaceAll(text, "\x00", ""), "�")
	body := inboundprovider.StripQuoted(text)
	if body == "" {
		body = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	}
	if utf8.RuneCountInString(body) <= maxContactBodyRunes {
		return body, false
	}
	runes := []rune(body)
	return strings.TrimSpace(string(runes[:maxContactBodyRunes])), true
}

// storeReaderEntry writes the entry, puts its message back among the waiting
// ones, and queues the mail that tells staff, in one transaction, so a reply
// staff are not told about cannot be stored and a message cannot reopen for a
// reply that was not. It reports false, having written nothing, for a mail
// whose Message-ID is already stored.
func (s *apiServer) storeReaderEntry(ctx context.Context, params dbmodels.CreateReaderContactMessageEntryParams) (bool, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return false, fmt.Errorf("generate contact message entry id: %w", err)
	}
	params.ID = id

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	entry, err := txq.CreateReaderContactMessageEntry(ctx, params)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := txq.SetContactMessageHandledByIDForTenant(ctx, dbmodels.SetContactMessageHandledByIDForTenantParams{
		TenantID: params.TenantID,
		ID:       params.ContactMessageID,
		Handled:  false,
	}); err != nil {
		return false, fmt.Errorf("reopen contact message: %w", err)
	}
	payload, err := json.Marshal(outbox.ContactMessageStaffEmailPayload{
		TenantID:  params.TenantID.String(),
		MessageID: params.ContactMessageID.String(),
		EntryID:   entry.ID.String(),
	})
	if err != nil {
		return false, fmt.Errorf("marshal contact message staff email event: %w", err)
	}
	if err := insertPublicOutboxEvent(
		ctx, txq, params.TenantID, outbox.EventTypeContactMessageStaffEmail, payload,
		outbox.ContactMessageReplyStaffEmailIdempotencyKey(entry.ID),
	); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
