package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
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
	req *publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateRequest,
) (*publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is required")
	}

	invitation, err := s.queriesFor(ctx).GetTenantAdminInvitationByHashForTenant(ctx, dbmodels.GetTenantAdminInvitationByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "invitation not found")
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

	return &publiraadminv1.AdminAuthServiceGetTenantAdminInvitationStateResponse{
		Email:         invitation.Email,
		Status:        adminInvitationStatus(invitation, time.Now()),
		ExpiresAt:     invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AccountExists: userErr == nil,
		Role:          invitation.Role,
	}, nil
}

func (s *adminServer) AcceptTenantAdminInvitation(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationRequest,
) (*publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is required")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation acceptance", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	// The row lock makes a concurrent acceptance of the same invitation wait for
	// this one, then read it as accepted instead of creating the account twice.
	invitation, err := txq.LockTenantAdminInvitationByHashForTenant(ctx, dbmodels.LockTenantAdminInvitationByHashForTenantParams{
		TenantID:  tenant.ID,
		TokenHash: auth.HashToken(token),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "invitation not found")
		}
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String())
	}

	status := adminInvitationStatus(invitation, time.Now())
	switch status {
	case "accepted":
		return &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse{Accepted: true}, nil
	case "canceled":
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("invitation canceled"), rpcerrors.ReasonInvitationCanceled)
	case "expired":
		return nil, connect.NewError(connect.CodeFailedPrecondition, "invitation expired")
	}

	user, err := txq.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    invitation.Email,
	})
	accountCreated := false
	userID := user.ID
	role := invitation.Role
	switch {
	case errors.Is(err, sql.ErrNoRows):
		name := strings.TrimSpace(req.Name)
		password := req.Password
		if name == "" || strings.TrimSpace(password) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "name and password are required")
		}
		member, err := tenantmembers.CreateAccount(ctx, tx, tenantmembers.AccountParams{
			TenantID: tenant.ID,
			Email:    invitation.Email,
			Name:     name,
			Password: password,
			Role:     role,
		})
		if err != nil {
			// Only a sign-up with the same address can still take it here; a
			// retry finds that account and grants it the role.
			if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
				return nil, connectErr
			}
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
		// The account may have been given a role since it was invited, and
		// accepting never lowers it: an invitation as an Editor taking the role
		// from an administrator could leave the tenant with none.
		granted, err := tenantmembers.GrantAtLeast(ctx, tx, tenant.ID, user.ID, invitation.Role)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to grant invitation role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
		role = granted
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
		ActorRole:   role,
		Action:      "tenant_admin_invite_accepted",
		TargetType:  "tenant_admin_invitation",
		TargetID:    invitation.Email,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      roleGrantedReason(role),
		ClientIP:    auditlog.ClientIPFromHeader(rpcmiddleware.RequestHeader(ctx)),
	})

	return &publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse{
		Accepted:       true,
		AccountCreated: accountCreated,
	}, nil
}
