package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantmembers"
)

func adminInvitationStatus(invitation dbmodels.TenantAdminInvitation, now time.Time) string {
	if invitation.AcceptedAt.Valid {
		return "accepted"
	}
	if invitation.CanceledAt.Valid {
		return "canceled"
	}
	if !invitation.ExpiresAt.After(now) {
		return "expired"
	}
	return "pending"
}

func (s *adminServer) GetTenantAdminInvitationState(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}

	invitation, err := s.queriesFor(ctx).GetTenantAdminInvitationByHashForTenant(ctx, dbmodels.GetTenantAdminInvitationByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("invitation not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String())
	}

	_, userErr := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    invitation.Email,
	})
	if userErr != nil && !errors.Is(userErr, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get invitation user", userErr, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateResponse{
		Email:         invitation.Email,
		Status:        adminInvitationStatus(invitation, time.Now()),
		ExpiresAt:     invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AccountExists: userErr == nil,
	}), nil
}

func (s *adminServer) AcceptTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Msg.Token)
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}

	invitation, err := s.queriesFor(ctx).GetTenantAdminInvitationByHashForTenant(ctx, dbmodels.GetTenantAdminInvitationByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("invitation not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String())
	}

	status := adminInvitationStatus(invitation, time.Now())
	switch status {
	case "accepted":
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse{Accepted: true}), nil
	case "canceled":
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("invitation canceled"), rpcerrors.ReasonInvitationCanceled)
	case "expired":
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation expired"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation acceptance", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	user, err := txq.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    invitation.Email,
	})
	accountCreated := false
	userID := user.ID
	switch {
	case errors.Is(err, sql.ErrNoRows):
		name := strings.TrimSpace(req.Msg.Name)
		password := req.Msg.Password
		if name == "" || strings.TrimSpace(password) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name and password are required"))
		}
		member, err := tenantmembers.CreateAccount(ctx, tx, tenantmembers.AccountParams{
			TenantID: tenant.ID,
			Email:    invitation.Email,
			Name:     name,
			Password: password,
			Role:     auth.RoleTenantAdmin,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to create invitation user", err, "tenant_id", tenant.ID.String())
		}
		userID = member.UserID
		accountCreated = true
	case err != nil:
		return nil, s.internalDBError(ctx, "failed to get invitation user", err, "tenant_id", tenant.ID.String())
	default:
		if user.Status != "active" {
			if _, err := txq.UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
				return nil, s.internalDBError(ctx, "failed to activate invitation user", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
			}
		}
		if err := tenantmembers.ReplaceRole(ctx, txq, tenant.ID, user.ID, auth.RoleTenantAdmin); err != nil {
			return nil, s.internalDBError(ctx, "failed to grant invitation tenant admin role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
	}

	if _, err := txq.MarkTenantAdminInvitationAccepted(ctx, dbmodels.MarkTenantAdminInvitationAcceptedParams{
		TenantID: tenant.ID,
		ID:       invitation.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to mark tenant admin invitation accepted", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant admin invitation acceptance", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: userID,
		ActorRole:   auth.RoleTenantAdmin,
		Action:      "tenant_admin_invite_accepted",
		TargetType:  "tenant_admin_invitation",
		TargetID:    invitation.Email,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse{
		Accepted:       true,
		AccountCreated: accountCreated,
	}), nil
}
