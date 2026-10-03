package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultContactMessageListLimit = int32(20)
	maxContactMessageListLimit     = int32(100)

	// Where a message stands, which is both ContactMessage.status and the
	// accepted values of the list filter. They are derived from handled_at and
	// assigned_to rather than stored, because whether a message has been dealt
	// with is the time it was dealt with and whether somebody is on it is who
	// that is: a column of its own could only drift from the two.
	contactMessageStatusUnhandled  = "unhandled"
	contactMessageStatusInProgress = "in_progress"
	contactMessageStatusHandled    = "handled"

	// The length contact_messages_staff_note_check enforces, in characters as
	// PostgreSQL counts them.
	maxContactMessageStaffNoteRunes = 4000
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

// contactMessageStatus derives where a message stands, by the same rule the
// list queries filter on.
//
// Handled wins over assigned: a message keeps its assignee once it is dealt
// with, and handled_by, not the assignee, records who dealt with it. Putting
// the message back clears handled_at alone, so it returns to in_progress for as
// long as it has an assignee.
func contactMessageStatus(row contactMessageRow) string {
	switch {
	case row.HandledAt.Valid:
		return contactMessageStatusHandled
	case row.AssignedTo.Valid:
		return contactMessageStatusInProgress
	default:
		return contactMessageStatusUnhandled
	}
}

// normalizeContactMessageStatusFilter accepts the three states and nothing else.
// An unrecognised filter is rejected rather than ignored: silently listing
// every message would answer a question the caller did not ask, and staff
// reading what they believe is their queue would see messages somebody has
// already answered.
func normalizeContactMessageStatusFilter(raw string) (sql.NullString, error) {
	status := strings.TrimSpace(raw)
	switch status {
	case "":
		return sql.NullString{}, nil
	case contactMessageStatusUnhandled, contactMessageStatusInProgress, contactMessageStatusHandled:
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
		Id:           row.ID.String(),
		PublicId:     row.PublicID,
		ReplyToEmail: row.ReplyToEmail,
		Subject:      row.Subject.String,
		Body:         row.Body,
		CreatedAt:    row.CreatedAt.UTC().Format(time.RFC3339),
		SenderName:   row.SenderName.String,
		Status:       contactMessageStatus(row),
	}
	if row.HandledAt.Valid {
		message.HandledAt = row.HandledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.SenderPublicID.Valid {
		message.SenderPublicId = row.SenderPublicID.String
	}
	if row.AssignedTo.Valid {
		message.AssigneeUserId = row.AssignedTo.UUID.String()
		message.AssigneePublicId = row.AssigneePublicID.String
		message.AssigneeName = row.AssigneeName.String
	}
	message.StaffNote = row.StaffNote.String
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

// contactMessageLookupError reads a failed single-message read. A message of
// another tenant and one that never existed are a single not-found answer,
// which is also what row-level security would leave of the first.
func (s *adminServer) contactMessageLookupError(ctx context.Context, tenantID uuid.UUID, err error, identifier ...any) error {
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, errors.New("contact message not found"))
	}
	return s.internalDBError(ctx, "failed to get the contact message", err, append([]any{"tenant_id", tenantID.String()}, identifier...)...)
}

// loadContactMessageByPublicID reads the message a URL names.
func (s *adminServer) loadContactMessageByPublicID(ctx context.Context, tenantID uuid.UUID, publicID string) (contactMessageRow, error) {
	row, err := s.queriesFor(ctx).GetContactMessageByPublicIDForTenant(ctx, dbmodels.GetContactMessageByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: publicID,
	})
	if err != nil {
		return contactMessageRow{}, s.contactMessageLookupError(ctx, tenantID, err, "contact_message_public_id", publicID)
	}
	return row, nil
}

// loadContactMessageByID reads the message an action addresses.
func (s *adminServer) loadContactMessageByID(ctx context.Context, tenantID, messageID uuid.UUID) (contactMessageRow, error) {
	row, err := s.queriesFor(ctx).GetContactMessageByIDForTenant(ctx, dbmodels.GetContactMessageByIDForTenantParams{
		TenantID: tenantID,
		ID:       messageID,
	})
	if err != nil {
		return contactMessageRow{}, s.contactMessageLookupError(ctx, tenantID, err, "contact_message_id", messageID.String())
	}
	return contactMessageRow(row), nil
}

// requiredContactMessageField reads the identifier a request names, which is
// required whichever of the two it is.
func requiredContactMessageField(raw, field string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New(field+" is required"), field)
	}
	return value, nil
}

// requiredContactMessageID reads the primary key an action addresses a message
// by.
func requiredContactMessageID(raw string) (uuid.UUID, error) {
	value, err := requiredContactMessageField(raw, "contact_message_id")
	if err != nil {
		return uuid.Nil, err
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("contact_message_id is not an identifier"), "contact_message_id")
	}
	return id, nil
}

// contactMessageUpdateError reads a failed update of one message, which finds
// no row for a message of another tenant exactly as for one that never existed.
func (s *adminServer) contactMessageUpdateError(ctx context.Context, tenantID, messageID uuid.UUID, err error, what string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, errors.New("contact message not found"))
	}
	return s.internalDBError(ctx, "failed to "+what, err, "tenant_id", tenantID.String(), "contact_message_id", messageID.String())
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
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	publicID, err := requiredContactMessageField(req.Msg.PublicId, "public_id")
	if err != nil {
		return nil, err
	}
	row, err := s.loadContactMessageByPublicID(ctx, tenant.ID, publicID)
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
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	messageID, err := requiredContactMessageID(req.Msg.ContactMessageId)
	if err != nil {
		return nil, err
	}

	if _, err := s.queriesFor(ctx).SetContactMessageHandledByIDForTenant(ctx, dbmodels.SetContactMessageHandledByIDForTenantParams{
		TenantID:  tenant.ID,
		ID:        messageID,
		Handled:   req.Msg.Handled,
		HandledBy: uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true},
	}); err != nil {
		return nil, s.contactMessageUpdateError(ctx, tenant.ID, messageID, err, "mark the contact message")
	}

	// Read back rather than project the update's own row: the answer describes
	// the stored message, sender included, which the update does not return.
	updated, err := s.loadContactMessageByID(ctx, tenant.ID, messageID)
	if err != nil {
		return nil, err
	}

	action := "contact_message_reopened"
	if req.Msg.Handled {
		action = "contact_message_handled"
	}
	s.recorderFor(ctx).RecordTenant(ctx, contactMessageAuditEntry(req.Header(), sessionCtx, action, updated.PublicID))

	return connect.NewResponse(&publiraadminv1.MarkContactMessageHandledResponse{Message: contactMessageToProto(updated)}), nil
}

// contactMessageAssignee reads the account a request assigns a message to, or
// no account for an empty identifier, which clears the assignment.
func (s *adminServer) contactMessageAssignee(ctx context.Context, tenantID uuid.UUID, raw string) (uuid.NullUUID, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return uuid.NullUUID{}, nil
	}
	// A malformed identifier, another tenant's account, a reader, and a member
	// who cannot open the inbox are one answer: none of them can take the
	// message.
	notAssignable := rpcerrors.NewFieldViolationError(
		connect.CodeInvalidArgument,
		errors.New("assignee_user_id is not an active tenant_admin of the tenant"),
		"assignee_user_id",
	)
	userID, err := uuid.Parse(value)
	if err != nil {
		return uuid.NullUUID{}, notAssignable
	}
	if _, err := s.queriesFor(ctx).GetContactMessageAssignableStaffForTenant(ctx, dbmodels.GetContactMessageAssignableStaffForTenantParams{
		TenantID: tenantID,
		UserID:   userID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.NullUUID{}, notAssignable
		}
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to look up the contact message assignee", err, "tenant_id", tenantID.String(), "assignee_user_id", userID.String())
	}
	return uuid.NullUUID{UUID: userID, Valid: true}, nil
}

// AssignContactMessage hands one message to a member of staff, moves it to
// another, or clears the assignment.
func (s *adminServer) AssignContactMessage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AssignContactMessageRequest],
) (*connect.Response[publiraadminv1.AssignContactMessageResponse], error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	messageID, err := requiredContactMessageID(req.Msg.ContactMessageId)
	if err != nil {
		return nil, err
	}
	assignee, err := s.contactMessageAssignee(ctx, tenant.ID, req.Msg.AssigneeUserId)
	if err != nil {
		return nil, err
	}

	if _, err := s.queriesFor(ctx).SetContactMessageAssigneeByIDForTenant(ctx, dbmodels.SetContactMessageAssigneeByIDForTenantParams{
		TenantID:   tenant.ID,
		ID:         messageID,
		AssignedTo: assignee,
	}); err != nil {
		return nil, s.contactMessageUpdateError(ctx, tenant.ID, messageID, err, "assign the contact message")
	}

	// Read back for the assignee's name, which the update does not return.
	updated, err := s.loadContactMessageByID(ctx, tenant.ID, messageID)
	if err != nil {
		return nil, err
	}

	action := "contact_message_unassigned"
	if assignee.Valid {
		action = "contact_message_assigned"
	}
	s.recorderFor(ctx).RecordTenant(ctx, contactMessageAuditEntry(req.Header(), sessionCtx, action, updated.PublicID))

	return connect.NewResponse(&publiraadminv1.AssignContactMessageResponse{Message: contactMessageToProto(updated)}), nil
}

// UpdateContactMessageStaffNote saves, replaces, or clears the internal note on
// one message.
func (s *adminServer) UpdateContactMessageStaffNote(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateContactMessageStaffNoteRequest],
) (*connect.Response[publiraadminv1.UpdateContactMessageStaffNoteResponse], error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	messageID, err := requiredContactMessageID(req.Msg.ContactMessageId)
	if err != nil {
		return nil, err
	}
	note := strings.TrimSpace(req.Msg.StaffNote)
	if utf8.RuneCountInString(note) > maxContactMessageStaffNoteRunes {
		return nil, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			fmt.Errorf("the note must be at most %d characters", maxContactMessageStaffNoteRunes),
			"staff_note",
		)
	}

	if _, err := s.queriesFor(ctx).SetContactMessageStaffNoteByIDForTenant(ctx, dbmodels.SetContactMessageStaffNoteByIDForTenantParams{
		TenantID:  tenant.ID,
		ID:        messageID,
		StaffNote: sql.NullString{String: note, Valid: note != ""},
	}); err != nil {
		return nil, s.contactMessageUpdateError(ctx, tenant.ID, messageID, err, "update the contact message staff note")
	}

	updated, err := s.loadContactMessageByID(ctx, tenant.ID, messageID)
	if err != nil {
		return nil, err
	}
	s.recorderFor(ctx).RecordTenant(ctx, contactMessageAuditEntry(req.Header(), sessionCtx, "contact_message_staff_note_updated", updated.PublicID))

	return connect.NewResponse(&publiraadminv1.UpdateContactMessageStaffNoteResponse{Message: contactMessageToProto(updated)}), nil
}
