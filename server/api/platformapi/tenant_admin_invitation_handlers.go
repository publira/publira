package platformapi

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
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

func tenantEmailSettingsFromConfig(config dbmodels.TenantSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{Password: password}
	if config.Host.Valid {
		settings.Host = config.Host.String
	}
	if config.Port.Valid {
		settings.Port = config.Port.Int32
	}
	if config.Username.Valid {
		settings.Username = config.Username.String
	}
	if config.Encryption.Valid {
		settings.Encryption = config.Encryption.String
	}
	if config.FromName.Valid {
		settings.FromName = config.FromName.String
	}
	if config.FromAddress.Valid {
		settings.FromAddress = config.FromAddress.String
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func platformEmailSettingsFromConfig(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Password:    password,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func (s *platformServer) resolveSMTPSettingsForTenant(ctx context.Context, tenantID uuid.UUID) (emailsettings.SMTPSettings, error) {
	tenantConfig, err := s.queriesFor(ctx).GetTenantSMTPConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInternal, err)
	}
	if err == nil && tenantConfig.SmtpOverrideEnabled {
		password, decryptErr := emailsettings.DecryptPassword(tenantConfig.PasswordEncrypted.String, s.encryptor)
		if decryptErr != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("tenant smtp settings are not configured"))
		}
		settings := tenantEmailSettingsFromConfig(tenantConfig, password)
		if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
		}
		return settings, nil
	}

	platformConfig, err := s.queriesFor(ctx).GetPlatformSMTPConfig(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not configured"))
		}
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInternal, err)
	}
	password, decryptErr := emailsettings.DecryptPassword(platformConfig.PasswordEncrypted, s.encryptor)
	if decryptErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not configured"))
	}
	settings := platformEmailSettingsFromConfig(platformConfig, password)
	if validateErr := emailsettings.Validate(settings, true); validateErr != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, validateErr)
	}
	return settings, nil
}

func tenantAdminInvitationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	if tenant.AdminDomain.Valid && strings.TrimSpace(tenant.AdminDomain.String) != "" {
		domain = strings.TrimSpace(tenant.AdminDomain.String)
	} else if domain != "" {
		domain = "admin." + domain
	}
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return "", errors.New("tenant admin domain is not configured")
	}
	return "https://" + domain + "/accept-invite?token=" + url.QueryEscape(token), nil
}

func (s *platformServer) sendTenantAdminInvitationEmail(ctx context.Context, tenant dbmodels.Tenant, recipientEmail string, token string) error {
	if s.mailer == nil {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("smtp sender is not configured"))
	}
	settings, err := s.resolveSMTPSettingsForTenant(ctx, tenant.ID)
	if err != nil {
		return err
	}
	inviteURL, err := tenantAdminInvitationURL(tenant, token)
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	subjectPrefix := strings.TrimSpace(tenant.Name)
	if subjectPrefix == "" {
		subjectPrefix = "Publira"
	}
	subject := subjectPrefix + " 管理者招待"
	body := "Publira 管理画面への招待を受け付けました。\r\n" +
		"以下のリンクを開いて、テナント管理者の招待を承諾してください。\r\n\r\n" +
		inviteURL + "\r\n\r\n" +
		"このリンクの有効期限は24時間です。\r\n" +
		"心当たりがない場合、このメールは破棄してください。\r\n"
	if err := s.mailer.SendEmail(ctx, settings, recipientEmail, subject, body); err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	return nil
}

func ensureTenantAdminRole(ctx context.Context, txq *dbmodels.Queries, userID uuid.UUID) error {
	if err := txq.DeleteTenantUserRolesByUserID(ctx, userID); err != nil {
		return err
	}
	_, err := txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:     uuid.Must(uuid.NewV7()),
		UserID: userID,
		Role:   auth.RoleTenantAdmin,
	})
	return err
}

func (s *platformServer) ListTenantAdminInvitations(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListTenantAdminInvitationsRequest],
) (*connect.Response[publirasplatformv1.ListTenantAdminInvitationsResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rows, err := s.queriesFor(ctx).ListTenantAdminInvitations(ctx, dbmodels.ListTenantAdminInvitationsParams{
		TenantID: tenant.ID,
		Limit:    limit,
		// The keyset query and token handling are introduced in #746. Until
		// then, preserve the current client's first-page behavior.
		Offset: 0,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	now := time.Now()
	items := make([]*publirasplatformv1.TenantAdminInvitation, len(rows))
	for index, invitation := range rows {
		items[index] = tenantAdminInvitationToProto(invitation, now)
	}

	return connect.NewResponse(&publirasplatformv1.ListTenantAdminInvitationsResponse{Invitations: items}), nil
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, userErr := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    email,
	})
	if userErr != nil && !errors.Is(userErr, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeInternal, userErr)
	}

	if userErr == nil {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		defer tx.Rollback() //nolint:errcheck

		txq := dbmodels.New(tx)
		if err := ensureTenantAdminRole(ctx, txq, user.ID); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if err := tx.Commit(); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
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

	existing, err := s.queriesFor(ctx).GetTenantAdminInvitationByTenantAndEmail(ctx, dbmodels.GetTenantAdminInvitationByTenantAndEmailParams{
		TenantID: tenant.ID,
		Email:    email,
	})
	var invitation dbmodels.TenantAdminInvitation
	if err == nil {
		invitation, err = s.queriesFor(ctx).UpdateTenantAdminInvitationForResend(ctx, dbmodels.UpdateTenantAdminInvitationForResendParams{
			TenantID:  tenant.ID,
			Email:     existing.Email,
			TokenHash: auth.HashToken(token),
			ExpiresAt: expiresAt,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		invitationID, newIDErr := uuid.NewV7()
		if newIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, newIDErr)
		}
		invitation, err = s.queriesFor(ctx).CreateTenantAdminInvitation(ctx, dbmodels.CreateTenantAdminInvitationParams{
			ID:        invitationID,
			TenantID:  tenant.ID,
			Email:     email,
			TokenHash: auth.HashToken(token),
			ExpiresAt: expiresAt,
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendTenantAdminInvitationEmail(ctx, tenant, email, token); err != nil {
		return nil, err
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
	updated, err := s.queriesFor(ctx).UpdateTenantAdminInvitationForResend(ctx, dbmodels.UpdateTenantAdminInvitationForResendParams{
		TenantID:  tenant.ID,
		Email:     invitation.Email,
		TokenHash: auth.HashToken(token),
		ExpiresAt: time.Now().Add(tenantAdminInvitationTTL),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.sendTenantAdminInvitationEmail(ctx, tenant, updated.Email, token); err != nil {
		return nil, err
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if invitation.AcceptedAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("invitation already accepted"))
	}

	updated, err := s.queriesFor(ctx).CancelTenantAdminInvitation(ctx, dbmodels.CancelTenantAdminInvitationParams{
		TenantID: tenant.ID,
		ID:       invitation.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
