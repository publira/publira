package adminapi

import (
	"context"
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
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantmembers"
)

const (
	defaultTenantMemberListLimit = 20
	maxTenantMemberListLimit     = 100
)

func tenantMemberToProto(member tenantmembers.Member) *publiraadminv1.TenantMember {
	return &publiraadminv1.TenantMember{
		UserPublicId: member.PublicID,
		Name:         member.Name,
		Email:        member.Email,
		Role:         member.Role,
		Status:       member.Status,
		CreatedAt:    member.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func tenantAdminInvitationToProto(invitation dbmodels.TenantAdminInvitation, now time.Time) *publiraadminv1.TenantAdminInvitation {
	acceptedAt := ""
	if invitation.AcceptedAt.Valid {
		acceptedAt = invitation.AcceptedAt.Time.UTC().Format(time.RFC3339)
	}
	canceledAt := ""
	if invitation.CanceledAt.Valid {
		canceledAt = invitation.CanceledAt.Time.UTC().Format(time.RFC3339)
	}
	return &publiraadminv1.TenantAdminInvitation{
		Id:         invitation.ID.String(),
		Email:      invitation.Email,
		Status:     tenantmembers.InvitationStatus(invitation, now),
		CreatedAt:  invitation.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:  invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AcceptedAt: acceptedAt,
		CanceledAt: canceledAt,
	}
}

// tenantMembersError maps what tenantmembers refuses to this API's codes;
// anything else is a database failure.
func (s *adminServer) tenantMembersError(ctx context.Context, msg string, err error, keyvals ...any) error {
	var connectErr *connect.Error
	switch {
	case errors.As(err, &connectErr):
		return connectErr
	case errors.Is(err, tenantmembers.ErrLastAdmin):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, err, rpcerrors.ReasonLastTenantAdmin)
	case errors.Is(err, tenantmembers.ErrUserPublicIDRequired),
		errors.Is(err, tenantmembers.ErrInvalidRole),
		errors.Is(err, tenantmembers.ErrEmailRequired),
		errors.Is(err, tenantmembers.ErrInvalidEmail):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, tenantmembers.ErrMemberNotFound), errors.Is(err, tenantmembers.ErrInvitationNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, tenantmembers.ErrInvitationAccepted):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, tenantmembers.ErrInvitationWasCanceled):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, err, rpcerrors.ReasonInvitationCanceled)
	default:
		return s.internalDBError(ctx, msg, err, keyvals...)
	}
}

// tenantAdminSession resolves the calling tenant and refuses any session that
// is not its tenant_admin.
func (s *adminServer) tenantAdminSession(ctx context.Context, req tenantScopedRequest) (dbmodels.Tenant, rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, req.GetTenant())
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return dbmodels.Tenant{}, rpcmiddleware.SessionContext{}, err
	}
	return tenant, sessionCtx, nil
}

func (s *adminServer) recordTenantMemberChange(ctx context.Context, header http.Header, tenant dbmodels.Tenant, session rpcmiddleware.SessionContext, action, targetType, targetID string) {
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: session.User.ID,
		ActorRole:   session.Role,
		Action:      action,
		TargetType:  targetType,
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(header),
	})
}

func decodeTimeUUIDToken(token string) (pagination.Cursor, pagination.TimeUUIDKeys, error) {
	cursor, err := pagination.Decode(token)
	if err != nil {
		return pagination.Cursor{}, pagination.TimeUUIDKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return pagination.Cursor{}, pagination.TimeUUIDKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}
	return cursor, keys, nil
}

func (s *adminServer) ListTenantMembers(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListTenantMembersRequest],
) (*connect.Response[publiraadminv1.ListTenantMembersResponse], error) {
	tenant, _, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultTenantMemberListLimit, maxTenantMemberListLimit)
	cursor, keys, err := decodeTimeUUIDToken(req.Msg.Token)
	if err != nil {
		return nil, err
	}

	rows, err := tenantmembers.ListMembers(ctx, s.queriesFor(ctx), tenantmembers.ListParams{
		TenantID:  tenant.ID,
		Keys:      keys,
		Direction: cursor.Direction,
		Limit:     limit + 1,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant members", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res := &publiraadminv1.ListTenantMembersResponse{Members: make([]*publiraadminv1.TenantMember, len(rows))}
	for i, row := range rows {
		res.Members[i] = tenantMemberToProto(row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].UserID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.UserID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(res), nil
}

func (s *adminServer) UpdateTenantMemberRole(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantMemberRoleRequest],
) (*connect.Response[publiraadminv1.UpdateTenantMemberRoleResponse], error) {
	tenant, session, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update tenant member role transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.UpdateRole(ctx, tx, tenantmembers.UpdateRoleParams{
		TenantID:     tenant.ID,
		UserPublicID: req.Msg.UserPublicId,
		Role:         req.Msg.Role,
		KeepAnAdmin:  true,
	})
	if err != nil {
		return nil, s.tenantMembersError(ctx, "failed to update tenant member role", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update tenant member role", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	s.recordTenantMemberChange(ctx, req.Header(), tenant, session, "tenant_member_role_updated", "user", member.PublicID)

	return connect.NewResponse(&publiraadminv1.UpdateTenantMemberRoleResponse{Member: tenantMemberToProto(member)}), nil
}

func (s *adminServer) RemoveTenantMember(
	ctx context.Context,
	req *connect.Request[publiraadminv1.RemoveTenantMemberRequest],
) (*connect.Response[publiraadminv1.RemoveTenantMemberResponse], error) {
	tenant, session, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin remove tenant member transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.Remove(ctx, tx, tenantmembers.RemoveParams{
		TenantID:     tenant.ID,
		UserPublicID: req.Msg.UserPublicId,
		KeepAnAdmin:  true,
	})
	if err != nil {
		return nil, s.tenantMembersError(ctx, "failed to remove tenant member", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit remove tenant member", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	s.recordTenantMemberChange(ctx, req.Header(), tenant, session, "tenant_member_removed", "user", member.PublicID)

	return connect.NewResponse(&publiraadminv1.RemoveTenantMemberResponse{UserPublicId: member.PublicID}), nil
}

func (s *adminServer) ListTenantAdminInvitations(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListTenantAdminInvitationsRequest],
) (*connect.Response[publiraadminv1.ListTenantAdminInvitationsResponse], error) {
	tenant, _, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultTenantMemberListLimit, maxTenantMemberListLimit)
	cursor, keys, err := decodeTimeUUIDToken(req.Msg.Token)
	if err != nil {
		return nil, err
	}

	rows, err := tenantmembers.ListInvitations(ctx, s.queriesFor(ctx), tenantmembers.ListParams{
		TenantID:  tenant.ID,
		Keys:      keys,
		Direction: cursor.Direction,
		Limit:     limit + 1,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant admin invitations", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	now := time.Now()
	res := &publiraadminv1.ListTenantAdminInvitationsResponse{Invitations: make([]*publiraadminv1.TenantAdminInvitation, len(rows))}
	for i, row := range rows {
		res.Invitations[i] = tenantAdminInvitationToProto(row, now)
	}
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
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(res), nil
}

func (s *adminServer) CreateTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateTenantAdminInvitationRequest],
) (*connect.Response[publiraadminv1.CreateTenantAdminInvitationResponse], error) {
	tenant, session, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	invited, err := tenantmembers.Invite(ctx, tx, tenantmembers.InviteParams{
		TenantID:  tenant.ID,
		Email:     req.Msg.Email,
		AllowMail: s.allowInvitationMail(ctx, req, tenant),
	})
	if err != nil {
		return nil, s.tenantMembersError(ctx, "failed to invite tenant admin", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}

	s.recordTenantMemberChange(ctx, req.Header(), tenant, session, "tenant_admin_invited", "tenant_admin_invitation", invited.Email)

	if invited.RoleGrantedImmediately {
		return connect.NewResponse(&publiraadminv1.CreateTenantAdminInvitationResponse{RoleGrantedImmediately: true}), nil
	}
	return connect.NewResponse(&publiraadminv1.CreateTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(invited.Invitation, time.Now()),
	}), nil
}

func (s *adminServer) ResendTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ResendTenantAdminInvitationRequest],
) (*connect.Response[publiraadminv1.ResendTenantAdminInvitationResponse], error) {
	tenant, session, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	invitationID, err := parseInvitationID(req.Msg.InvitationId)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	updated, err := tenantmembers.Resend(ctx, tx, tenantmembers.ResendParams{
		TenantID:     tenant.ID,
		InvitationID: invitationID,
		AllowMail:    s.allowInvitationMail(ctx, req, tenant),
	})
	if err != nil {
		return nil, s.tenantMembersError(ctx, "failed to resend tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

	s.recordTenantMemberChange(ctx, req.Header(), tenant, session, "tenant_admin_invite_resent", "tenant_admin_invitation", updated.Email)

	return connect.NewResponse(&publiraadminv1.ResendTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

func (s *adminServer) CancelTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CancelTenantAdminInvitationRequest],
) (*connect.Response[publiraadminv1.CancelTenantAdminInvitationResponse], error) {
	tenant, session, err := s.tenantAdminSession(ctx, req.Msg)
	if err != nil {
		return nil, err
	}
	invitationID, err := parseInvitationID(req.Msg.InvitationId)
	if err != nil {
		return nil, err
	}

	updated, err := tenantmembers.Cancel(ctx, s.queriesFor(ctx), tenantmembers.InvitationParams{TenantID: tenant.ID, InvitationID: invitationID})
	if err != nil {
		return nil, s.tenantMembersError(ctx, "failed to cancel tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

	s.recordTenantMemberChange(ctx, req.Header(), tenant, session, "tenant_admin_invite_canceled", "tenant_admin_invitation", updated.Email)

	return connect.NewResponse(&publiraadminv1.CancelTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

// allowInvitationMail charges the mail guard for an invitation mail. It runs
// after the lookups that decide whether a mail goes out, since an address that
// already has an account is granted the role and mailed nothing.
func (s *adminServer) allowInvitationMail(ctx context.Context, req connect.AnyRequest, tenant dbmodels.Tenant) func(string) error {
	return func(email string) error {
		return s.mail.Allow(ctx, req, tenant.ID.String(), email)
	}
}

func parseInvitationID(raw string) (uuid.UUID, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invitation_id is required"))
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid invitation_id"))
	}
	return parsed, nil
}
