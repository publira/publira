package platformapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformtenants"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
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
	listKey := pagination.NewListKey("created_at_desc").Value("tenant_public_id", tenantPublicID)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
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
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
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
	params := tenantmembers.InviteParams{Email: req.Msg.Email, AllowMail: s.allowInvitationMail(ctx, req)}
	if err := params.Validate(); err != nil {
		return nil, s.tenantError(ctx, "invalid tenant admin invitation request", err)
	}
	actor, err := s.tenantActor(ctx, req)
	if err != nil {
		return nil, err
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	invited, err := platformtenants.Invite(ctx, tx, s.logger, actor, params)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to invite tenant admin", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}

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
	actor, err := s.tenantActor(ctx, req)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	updated, err := platformtenants.ResendInvitation(ctx, tx, s.logger, actor, tenantmembers.ResendParams{
		TenantID:     tenant.ID,
		InvitationID: invitationID,
		AllowMail:    s.allowInvitationMail(ctx, req),
	})
	if err != nil {
		return nil, s.tenantError(ctx, "failed to resend tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

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
	actor, err := s.tenantActor(ctx, req)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin cancel tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	updated, err := platformtenants.CancelInvitation(ctx, tx, s.logger, actor, tenantmembers.InvitationParams{TenantID: tenant.ID, InvitationID: invitationID})
	if err != nil {
		return nil, s.tenantError(ctx, "failed to cancel tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit cancel tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID.String())
	}

	return connect.NewResponse(&publirasplatformv1.CancelTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

// allowInvitationMail charges the console's mail allowance for an invitation
// sent to an address nobody has confirmed.
func (s *platformServer) allowInvitationMail(ctx context.Context, req connect.AnyRequest) func(string) error {
	return func(email string) error {
		return s.mail.Allow(ctx, req, mailguard.PlatformScope, email)
	}
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
	parsedID, err := tenantmembers.ParseInvitationID(invitationID)
	if err != nil {
		return dbmodels.Tenant{}, uuid.Nil, s.tenantError(ctx, "invalid invitation_id", err)
	}
	return tenant, parsedID, nil
}

func (s *platformServer) tenantByPublicID(ctx context.Context, publicID string) (dbmodels.Tenant, error) {
	tenant, err := platformtenants.Get(ctx, s.queriesFor(ctx), publicID)
	if err != nil {
		return dbmodels.Tenant{}, s.tenantError(ctx, "failed to get tenant", err, "public_id", publicID)
	}
	return tenant, nil
}
