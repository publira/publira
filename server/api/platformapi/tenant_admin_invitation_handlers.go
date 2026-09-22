package platformapi

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
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/tenantmembers"
)

func tenantAdminInvitationToProto(invitation dbmodels.TenantAdminInvitation, now time.Time) *publirasplatformv1.TenantAdminInvitation {
	acceptedAt := ""
	if invitation.AcceptedAt.Valid {
		acceptedAt = invitation.AcceptedAt.Time.UTC().Format(time.RFC3339)
	}
	canceledAt := ""
	if invitation.CanceledAt.Valid {
		canceledAt = invitation.CanceledAt.Time.UTC().Format(time.RFC3339)
	}

	return &publirasplatformv1.TenantAdminInvitation{
		Id:         invitation.ID.String(),
		Email:      invitation.Email,
		Status:     tenantmembers.InvitationStatus(invitation, now),
		CreatedAt:  invitation.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:  invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AcceptedAt: acceptedAt,
		CanceledAt: canceledAt,
	}
}

// tenantInvitationError maps what tenantmembers refuses to this API's codes;
// anything else is a database failure.
func (s *platformServer) tenantInvitationError(ctx context.Context, msg string, err error, keyvals ...any) error {
	switch {
	case errors.Is(err, tenantmembers.ErrEmailRequired), errors.Is(err, tenantmembers.ErrInvalidEmail):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, tenantmembers.ErrInvitationNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, tenantmembers.ErrInvitationAccepted), errors.Is(err, tenantmembers.ErrInvitationWasCanceled):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return s.internalDBError(ctx, msg, err, keyvals...)
	}
}

func (s *platformServer) ListTenantAdminInvitations(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListTenantAdminInvitationsRequest],
) (*connect.Response[publirasplatformv1.ListTenantAdminInvitationsResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultListLimit, maxListLimit)
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

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
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
	items := make([]*publirasplatformv1.TenantAdminInvitation, len(rows))
	for index, invitation := range rows {
		items[index] = tenantAdminInvitationToProto(invitation, now)
	}

	res := &publirasplatformv1.ListTenantAdminInvitationsResponse{Invitations: items}
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

func (s *platformServer) CreateTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateTenantAdminInvitationRequest],
) (*connect.Response[publirasplatformv1.CreateTenantAdminInvitationResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	if _, err := tenantmembers.NormalizeEmail(req.Msg.Email); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	invited, err := tenantmembers.Invite(ctx, tx, tenantmembers.InviteParams{TenantID: tenant.ID, Email: req.Msg.Email})
	if err != nil {
		return nil, s.tenantInvitationError(ctx, "failed to invite tenant admin", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}

	s.recordTenantInvitation(ctx, req.Header(), "tenant_admin_invited", invited.Email)

	if invited.RoleGrantedImmediately {
		return connect.NewResponse(&publirasplatformv1.CreateTenantAdminInvitationResponse{
			RoleGrantedImmediately: true,
		}), nil
	}
	return connect.NewResponse(&publirasplatformv1.CreateTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(invited.Invitation, time.Now()),
	}), nil
}

func (s *platformServer) ResendTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ResendTenantAdminInvitationRequest],
) (*connect.Response[publirasplatformv1.ResendTenantAdminInvitationResponse], error) {
	tenant, invitationID, err := s.tenantInvitationTarget(ctx, req.Msg.TenantPublicId, req.Msg.InvitationId)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	updated, err := tenantmembers.Resend(ctx, tx, tenantmembers.ResendParams{TenantID: tenant.ID, InvitationID: invitationID})
	if err != nil {
		return nil, s.tenantInvitationError(ctx, "failed to resend tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

	s.recordTenantInvitation(ctx, req.Header(), "tenant_admin_invite_resent", updated.Email)

	return connect.NewResponse(&publirasplatformv1.ResendTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

func (s *platformServer) CancelTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CancelTenantAdminInvitationRequest],
) (*connect.Response[publirasplatformv1.CancelTenantAdminInvitationResponse], error) {
	tenant, invitationID, err := s.tenantInvitationTarget(ctx, req.Msg.TenantPublicId, req.Msg.InvitationId)
	if err != nil {
		return nil, err
	}

	updated, err := tenantmembers.Cancel(ctx, s.queriesFor(ctx), tenantmembers.InvitationParams{TenantID: tenant.ID, InvitationID: invitationID})
	if err != nil {
		return nil, s.tenantInvitationError(ctx, "failed to cancel tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

	s.recordTenantInvitation(ctx, req.Header(), "tenant_admin_invite_canceled", updated.Email)

	return connect.NewResponse(&publirasplatformv1.CancelTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

func (s *platformServer) tenantInvitationTarget(ctx context.Context, rawTenantPublicID, rawInvitationID string) (dbmodels.Tenant, uuid.UUID, error) {
	tenantPublicID := strings.TrimSpace(rawTenantPublicID)
	invitationID := strings.TrimSpace(rawInvitationID)
	if tenantPublicID == "" || invitationID == "" {
		return dbmodels.Tenant{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id and invitation_id are required"))
	}
	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return dbmodels.Tenant{}, uuid.Nil, err
	}
	parsedID, err := uuid.Parse(invitationID)
	if err != nil {
		return dbmodels.Tenant{}, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid invitation_id"))
	}
	return tenant, parsedID, nil
}

func (s *platformServer) tenantByPublicID(ctx context.Context, publicID string) (dbmodels.Tenant, error) {
	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return dbmodels.Tenant{}, s.internalDBError(ctx, "failed to get tenant", err, "public_id", publicID)
	}
	return tenant, nil
}

func (s *platformServer) recordTenantInvitation(ctx context.Context, header http.Header, action, email string) {
	actor, ok := platformActorFromContext(ctx)
	if !ok {
		return
	}
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              action,
		TargetType:          "tenant_admin_invitation",
		TargetID:            email,
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(header),
	})
}
