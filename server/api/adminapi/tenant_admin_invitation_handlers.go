package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, userErr := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    invitation.Email,
	})
	if userErr != nil && !errors.Is(userErr, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeInternal, userErr)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	status := adminInvitationStatus(invitation, time.Now())
	switch status {
	case "accepted":
		return connect.NewResponse(&publiraadminv1.AdminAuthServiceAcceptTenantAdminInvitationResponse{Accepted: true}), nil
	case "canceled":
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation canceled"))
	case "expired":
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation expired"))
	}

	user, err := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    invitation.Email,
	})
	accountCreated := false
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		name := strings.TrimSpace(req.Msg.Name)
		password := strings.TrimSpace(req.Msg.Password)
		if name == "" || password == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name and password are required"))
		}
		passwordHash, hashErr := auth.HashPassword(password)
		if hashErr != nil {
			return nil, connect.NewError(connect.CodeInternal, hashErr)
		}
		userID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, connect.NewError(connect.CodeInternal, idErr)
		}
		user, err = s.queriesFor(ctx).CreateUser(ctx, dbmodels.CreateUserParams{
			ID:           userID,
			TenantID:     uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID:     generatePublicID(),
			Email:        invitation.Email,
			PasswordHash: passwordHash,
			Name:         name,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if _, err := s.queriesFor(ctx).UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
			ID:              user.ID,
			EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if _, err := s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		accountCreated = true
	} else if user.Status != "active" {
		if _, err := s.queriesFor(ctx).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	if err := s.queriesFor(ctx).DeleteTenantUserRolesByUserID(ctx, user.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	roleID, roleIDErr := uuid.NewV7()
	if roleIDErr != nil {
		return nil, connect.NewError(connect.CodeInternal, roleIDErr)
	}
	if _, err := s.queriesFor(ctx).CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:     roleID,
		UserID: user.ID,
		Role:   auth.RoleTenantAdmin,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if _, err := s.queriesFor(ctx).MarkTenantAdminInvitationAccepted(ctx, dbmodels.MarkTenantAdminInvitationAcceptedParams{
		TenantID: tenant.ID,
		ID:       invitation.ID,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: user.ID,
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
