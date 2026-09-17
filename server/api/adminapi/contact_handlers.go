package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultContactMessageListLimit = int32(20)
	maxContactMessageListLimit     = int32(100)

	// The accepted values of the list filter. They are the two sides of
	// handled_at rather than a stored column, because whether a message has been
	// dealt with is the time it was dealt with.
	contactMessageStatusUnhandled = "unhandled"
	contactMessageStatusHandled   = "handled"
)

// contactMessageRow is the single shape every contact message the console reads
// arrives in.
//
// The list queries and the single-message read select the same columns in the
// same order, so sqlc emits structurally identical row types; naming one of them
// lets a list row convert into it instead of being copied field by field.
type contactMessageRow = dbmodels.GetContactMessageByPublicIDForTenantRow

func contactMessageRowsFromDesc(rows []dbmodels.ListContactMessagesByCreatedAtDescRow) []contactMessageRow {
	mapped := make([]contactMessageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, contactMessageRow(row))
	}
	return mapped
}

func contactMessageRowsFromAsc(rows []dbmodels.ListContactMessagesByCreatedAtAscRow) []contactMessageRow {
	mapped := make([]contactMessageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, contactMessageRow(row))
	}
	return mapped
}

// normalizeContactMessageStatusFilter accepts the two states and nothing else.
// An unrecognised filter is rejected rather than ignored: silently listing both
// would answer a question the caller did not ask, and staff reading what they
// believe is their queue would see messages somebody has already answered.
func normalizeContactMessageStatusFilter(raw string) (sql.NullString, error) {
	status := strings.TrimSpace(raw)
	switch status {
	case "":
		return sql.NullString{}, nil
	case contactMessageStatusUnhandled, contactMessageStatusHandled:
		return sql.NullString{String: status, Valid: true}, nil
	default:
		return sql.NullString{}, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("status is not a contact message status"),
			"status",
		)
	}
}

func contactMessageToProto(row contactMessageRow) *publiraadminv1.ContactMessage {
	message := &publiraadminv1.ContactMessage{
		PublicId:     row.PublicID,
		ReplyToEmail: row.ReplyToEmail,
		Subject:      row.Subject.String,
		Body:         row.Body,
		CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		SenderName:   row.SenderName.String,
	}
	if row.HandledAt.Valid {
		message.HandledAt = row.HandledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.SenderPublicID.Valid {
		message.SenderPublicId = row.SenderPublicID.String
	}
	return message
}

func (s *adminServer) contactMessagePage(
	ctx context.Context,
	tenantID uuid.UUID,
	status sql.NullString,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]contactMessageRow, error) {
	params := dbmodels.ListContactMessagesByCreatedAtDescParams{
		TenantID:        tenantID,
		Status:          status,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	if direction == pagination.Backward {
		rows, err := s.queriesFor(ctx).ListContactMessagesByCreatedAtAsc(ctx, dbmodels.ListContactMessagesByCreatedAtAscParams(params))
		if err != nil {
			return nil, err
		}
		return contactMessageRowsFromAsc(rows), nil
	}
	rows, err := s.queriesFor(ctx).ListContactMessagesByCreatedAtDesc(ctx, params)
	if err != nil {
		return nil, err
	}
	return contactMessageRowsFromDesc(rows), nil
}

// loadContactMessage reads one message by the identifier the console carries. A
// message of another tenant and one that never existed are a single not-found
// answer, which is also what row-level security would leave of the first.
func (s *adminServer) loadContactMessage(ctx context.Context, tenantID uuid.UUID, publicID string) (contactMessageRow, error) {
	row, err := s.queriesFor(ctx).GetContactMessageByPublicIDForTenant(ctx, dbmodels.GetContactMessageByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: publicID,
	})
	if err == nil {
		return row, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return contactMessageRow{}, connect.NewError(connect.CodeNotFound, errors.New("contact message not found"))
	}
	return contactMessageRow{}, s.internalDBError(ctx, "failed to get the contact message", err, "tenant_id", tenantID.String(), "contact_message_public_id", publicID)
}

// contactMessageActionContext resolves the three things every contact message
// RPC starts from: the tenant, the staff session acting, and the identifier the
// request named.
func (s *adminServer) contactMessageActionContext(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	rawPublicID string,
) (dbmodels.Tenant, rpcmiddleware.SessionContext, string, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", err
	}
	publicID := strings.TrimSpace(rawPublicID)
	if publicID == "" {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, "", rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			errors.New("public_id is required"),
			"public_id",
		)
	}
	return tenant, sessionCtx, publicID, nil
}

func contactMessageAuditEntry(
	headers http.Header,
	sessionCtx rpcmiddleware.SessionContext,
	action, messagePublicID string,
) auditlog.TenantEntry {
	return auditlog.TenantEntry{
		TenantID:    sessionCtx.Tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "contact_message",
		TargetID:    messagePublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	}
}

// ListContactMessages returns the messages readers sent the tenant, newest
// first.
func (s *adminServer) ListContactMessages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListContactMessagesRequest],
) (*connect.Response[publiraadminv1.ListContactMessagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	status, err := normalizeContactMessageStatusFilter(req.Msg.Status)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultContactMessageListLimit, maxContactMessageListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.contactMessagePage(ctx, tenant.ID, status, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list contact messages", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	messages := make([]*publiraadminv1.ContactMessage, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, contactMessageToProto(row))
	}

	res := &publiraadminv1.ListContactMessagesResponse{Messages: messages}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// when the recovery query is itself empty the boundary row is gone too, so
	// both tokens stay empty and the client starts over from the first page.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

// GetContactMessage returns one message in full.
func (s *adminServer) GetContactMessage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetContactMessageRequest],
) (*connect.Response[publiraadminv1.GetContactMessageResponse], error) {
	tenant, _, publicID, err := s.contactMessageActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	row, err := s.loadContactMessage(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.GetContactMessageResponse{Message: contactMessageToProto(row)}), nil
}

// MarkContactMessageHandled records that staff have dealt with one message, or
// puts it back among the ones still waiting.
//
// The state is stated rather than toggled, so an inbox two members of staff are
// working at once cannot have one of them undo the other by pressing at the
// same moment.
func (s *adminServer) MarkContactMessageHandled(
	ctx context.Context,
	req *connect.Request[publiraadminv1.MarkContactMessageHandledRequest],
) (*connect.Response[publiraadminv1.MarkContactMessageHandledResponse], error) {
	tenant, sessionCtx, publicID, err := s.contactMessageActionContext(ctx, req.Msg.Tenant, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}

	if _, err := s.queriesFor(ctx).SetContactMessageHandledByPublicIDForTenant(ctx, dbmodels.SetContactMessageHandledByPublicIDForTenantParams{
		TenantID:  tenant.ID,
		PublicID:  publicID,
		Handled:   req.Msg.Handled,
		HandledBy: uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true},
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("contact message not found"))
		}
		return nil, s.internalDBError(ctx, "failed to mark the contact message", err, "tenant_id", tenant.ID.String(), "contact_message_public_id", publicID)
	}

	// Read back rather than project the update's own row: the answer describes
	// the stored message, sender included, which the update does not return.
	updated, err := s.loadContactMessage(ctx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}

	action := "contact_message_reopened"
	if req.Msg.Handled {
		action = "contact_message_handled"
	}
	s.recorderFor(ctx).RecordTenant(ctx, contactMessageAuditEntry(req.Header(), sessionCtx, action, publicID))

	return connect.NewResponse(&publiraadminv1.MarkContactMessageHandledResponse{Message: contactMessageToProto(updated)}), nil
}
