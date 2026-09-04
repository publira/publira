package platformapi

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
)

const tenantAdminInvitationTTL = 24 * time.Hour

func tenantAdminInvitationStatus(invitation dbmodels.TenantAdminInvitation, now time.Time) string {
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
		Status:     tenantAdminInvitationStatus(invitation, now),
		CreatedAt:  invitation.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:  invitation.ExpiresAt.UTC().Format(time.RFC3339),
		AcceptedAt: acceptedAt,
		CanceledAt: canceledAt,
	}
}

func generateInvitationToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := crand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func ensureTenantAdminRole(ctx context.Context, txq *dbmodels.Queries, tenantID, userID uuid.UUID) error {
	if err := txq.DeleteTenantUserRolesByUserID(ctx, userID); err != nil {
		return err
	}
	_, err := txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenantID,
		UserID:   userID,
		Role:     auth.RoleTenantAdmin,
	})
	return err
}

func enqueueTenantAdminInvitationEmail(ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, invitation dbmodels.TenantAdminInvitation, token string) error {
	payload, err := json.Marshal(outbox.TenantAdminInvitationPayload{
		TenantID:     tenantID.String(),
		InvitationID: invitation.ID.String(),
		Token:        token,
	})
	if err != nil {
		return fmt.Errorf("marshal tenant admin invitation email event: %w", err)
	}
	_, err = queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeTenantAdminInvitationEmail,
		Payload:        payload,
		IdempotencyKey: fmt.Sprintf("tenant_admin_invitation_email:%s:%s", invitation.ID, auth.HashToken(token)),
		AvailableAt:    time.Now().UTC(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func (s *platformServer) tenantAdminInvitationPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.TenantAdminInvitation, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		return queries.ListTenantAdminInvitationsAsc(ctx, dbmodels.ListTenantAdminInvitationsAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			Limit:           limit,
		})
	}

	return queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		Limit:           limit,
	})
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

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant", err, "public_id", tenantPublicID)
	}

	rows, err := s.tenantAdminInvitationPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
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
	email := strings.TrimSpace(strings.ToLower(req.Msg.Email))
	if email == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("email is required"))
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant", err, "public_id", tenantPublicID)
	}

	user, userErr := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if userErr != nil && !errors.Is(userErr, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get user by email for tenant", userErr, "tenant_id", tenant.ID.String())
	}

	if userErr == nil {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to begin grant tenant admin role transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
		defer tx.Rollback() //nolint:errcheck

		txq := dbmodels.New(tx)
		if err := ensureTenantAdminRole(ctx, txq, tenant.ID, user.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to grant tenant admin role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
		if err := tx.Commit(); err != nil {
			return nil, s.internalDBError(ctx, "failed to commit grant tenant admin role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}

		if actor, ok := platformActorFromContext(ctx); ok {
			s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
				ActorPlatformUserID: actor.UserID,
				ActorRole:           actor.Role,
				Action:              "tenant_admin_invited",
				TargetType:          "tenant_admin_invitation",
				TargetID:            email,
				Outcome:             auditlog.OutcomeSuccess,
				ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
			})
		}

		return connect.NewResponse(&publirasplatformv1.CreateTenantAdminInvitationResponse{
			RoleGrantedImmediately: true,
		}), nil
	}

	token, err := generateInvitationToken()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	expiresAt := time.Now().Add(tenantAdminInvitationTTL)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant admin invitation transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	existing, err := txq.GetTenantAdminInvitationByTenantAndEmail(ctx, dbmodels.GetTenantAdminInvitationByTenantAndEmailParams{TenantID: tenant.ID, Email: email})
	var invitation dbmodels.TenantAdminInvitation
	if err == nil {
		invitation, err = txq.UpdateTenantAdminInvitationForResend(ctx, dbmodels.UpdateTenantAdminInvitationForResendParams{
			TenantID:  tenant.ID,
			Email:     existing.Email,
			TokenHash: auth.HashToken(token),
			ExpiresAt: expiresAt,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to resend tenant admin invitation", err, "tenant_id", tenant.ID.String())
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		invitationID, newIDErr := uuid.NewV7()
		if newIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, newIDErr)
		}
		invitation, err = txq.CreateTenantAdminInvitation(ctx, dbmodels.CreateTenantAdminInvitationParams{
			ID:        invitationID,
			TenantID:  tenant.ID,
			Email:     email,
			TokenHash: auth.HashToken(token),
			ExpiresAt: expiresAt,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to create tenant admin invitation", err, "tenant_id", tenant.ID.String())
		}
	} else {
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String())
	}
	if err := enqueueTenantAdminInvitationEmail(ctx, txq, tenant.ID, invitation, token); err != nil {
		return nil, s.internalDBError(ctx, "failed to enqueue tenant admin invitation email", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_admin_invited",
			TargetType:          "tenant_admin_invitation",
			TargetID:            email,
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.CreateTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(invitation, time.Now()),
	}), nil
}

func (s *platformServer) ResendTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ResendTenantAdminInvitationRequest],
) (*connect.Response[publirasplatformv1.ResendTenantAdminInvitationResponse], error) {
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	invitationID := strings.TrimSpace(req.Msg.InvitationId)
	if tenantPublicID == "" || invitationID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id and invitation_id are required"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant", err, "public_id", tenantPublicID)
	}

	parsedID, err := uuid.Parse(invitationID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid invitation_id"))
	}
	invitation, err := s.queriesFor(ctx).GetTenantAdminInvitationByIDForTenant(ctx, dbmodels.GetTenantAdminInvitationByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       parsedID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("invitation not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID)
	}
	if invitation.AcceptedAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation already accepted"))
	}
	if invitation.CanceledAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation already canceled"))
	}

	token, err := generateInvitationToken()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)
	updated, err := txq.UpdateTenantAdminInvitationForResend(ctx, dbmodels.UpdateTenantAdminInvitationForResendParams{
		TenantID:  tenant.ID,
		Email:     invitation.Email,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(tenantAdminInvitationTTL),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resend tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}

	if err := enqueueTenantAdminInvitationEmail(ctx, txq, tenant.ID, updated, token); err != nil {
		return nil, s.internalDBError(ctx, "failed to enqueue tenant admin invitation email", err, "tenant_id", tenant.ID.String(), "invitation_id", updated.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit resend tenant admin invitation transaction", err, "tenant_id", tenant.ID.String(), "invitation_id", updated.ID.String())
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_admin_invite_resent",
			TargetType:          "tenant_admin_invitation",
			TargetID:            updated.Email,
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.ResendTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}

func (s *platformServer) CancelTenantAdminInvitation(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CancelTenantAdminInvitationRequest],
) (*connect.Response[publirasplatformv1.CancelTenantAdminInvitationResponse], error) {
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	invitationID := strings.TrimSpace(req.Msg.InvitationId)
	if tenantPublicID == "" || invitationID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id and invitation_id are required"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant", err, "public_id", tenantPublicID)
	}
	parsedID, err := uuid.Parse(invitationID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid invitation_id"))
	}
	invitation, err := s.queriesFor(ctx).GetTenantAdminInvitationByIDForTenant(ctx, dbmodels.GetTenantAdminInvitationByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       parsedID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("invitation not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitationID)
	}
	if invitation.AcceptedAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation already accepted"))
	}

	updated, err := s.queriesFor(ctx).CancelTenantAdminInvitation(ctx, dbmodels.CancelTenantAdminInvitationParams{
		TenantID: tenant.ID,
		ID:       invitation.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to cancel tenant admin invitation", err, "tenant_id", tenant.ID.String(), "invitation_id", invitation.ID.String())
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_admin_invite_canceled",
			TargetType:          "tenant_admin_invitation",
			TargetID:            updated.Email,
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.CancelTenantAdminInvitationResponse{
		Invitation: tenantAdminInvitationToProto(updated, time.Now()),
	}), nil
}
