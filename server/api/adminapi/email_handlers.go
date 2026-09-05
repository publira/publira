package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

func tenantAdminRoleRequiredError() error {
	return connect.NewError(connect.CodePermissionDenied, errors.New("tenant admin role required"))
}

func (s *adminServer) requireTenantAdmin(ctx context.Context) (rpcmiddleware.SessionContext, error) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, errors.New("session context is unavailable"))
	}
	if sessionCtx.Role != auth.RoleTenantAdmin {
		return rpcmiddleware.SessionContext{}, tenantAdminRoleRequiredError()
	}
	return sessionCtx, nil
}

func tenantEmailSettingsToProto(config dbmodels.TenantSmtpConfig) *publiraadminv1.TenantEmailSettings {
	settings := &publiraadminv1.TenantEmailSettings{
		SmtpOverrideEnabled: config.SmtpOverrideEnabled,
		HasPassword:         config.PasswordEncrypted.Valid && strings.TrimSpace(config.PasswordEncrypted.String) != "",
	}
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

func tenantEmailSettingsFromUpdateRequest(req *publiraadminv1.UpdateTenantEmailSettingsRequest) emailsettings.SMTPSettings {
	return emailsettings.SMTPSettings{
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Encryption:  req.Encryption,
		FromName:    req.FromName,
		FromAddress: req.FromAddress,
		ReplyTo:     req.ReplyTo,
	}
}

func tenantEmailSettingsFromTestRequest(req *publiraadminv1.SendTenantSmtpTestEmailRequest, password string) emailsettings.SMTPSettings {
	return emailsettings.SMTPSettings{
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Password:    password,
		Encryption:  req.Encryption,
		FromName:    req.FromName,
		FromAddress: req.FromAddress,
		ReplyTo:     req.ReplyTo,
	}
}

func platformEmailSettingsFromRow(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
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

func mergeTenantSettingsWithExisting(settings emailsettings.SMTPSettings, config dbmodels.TenantSmtpConfig, found bool) emailsettings.SMTPSettings {
	if !found {
		return settings
	}
	if strings.TrimSpace(settings.Host) == "" && config.Host.Valid {
		settings.Host = config.Host.String
	}
	if settings.Port == 0 && config.Port.Valid {
		settings.Port = config.Port.Int32
	}
	if strings.TrimSpace(settings.Username) == "" && config.Username.Valid {
		settings.Username = config.Username.String
	}
	if strings.TrimSpace(settings.Encryption) == "" && config.Encryption.Valid {
		settings.Encryption = config.Encryption.String
	}
	if strings.TrimSpace(settings.FromName) == "" && config.FromName.Valid {
		settings.FromName = config.FromName.String
	}
	if strings.TrimSpace(settings.FromAddress) == "" && config.FromAddress.Valid {
		settings.FromAddress = config.FromAddress.String
	}
	if strings.TrimSpace(settings.ReplyTo) == "" && config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func (s *adminServer) GetTenantEmailSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantEmailSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantEmailSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	config, err := s.queriesFor(ctx).GetTenantSMTPConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publiraadminv1.GetTenantEmailSettingsResponse{
				Settings: &publiraadminv1.TenantEmailSettings{},
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant email settings", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantEmailSettingsResponse{
		Settings: tenantEmailSettingsToProto(config),
	}), nil
}

func (s *adminServer) UpdateTenantEmailSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantEmailSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantEmailSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	existing, found, err := s.loadTenantSMTPConfigByID(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	existingPassword := ""
	if found && existing.PasswordEncrypted.Valid {
		existingPassword = existing.PasswordEncrypted.String
	}
	encryptedPassword, hasPassword, err := emailsettings.EncryptUpdatedPassword(existingPassword, int32(req.Msg.PasswordUpdateMode), req.Msg.Password, s.encryptor)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	settings := tenantEmailSettingsFromUpdateRequest(req.Msg)
	if req.Msg.SmtpOverrideEnabled {
		if !hasPassword {
			return nil, connect.NewError(connect.CodeInvalidArgument, emailsettings.ErrPasswordRequired)
		}
		if err := emailsettings.Validate(settings, false); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	} else {
		settings = mergeTenantSettingsWithExisting(settings, existing, found)
		if emailsettings.HasAnyValue(settings, hasPassword) {
			if err := emailsettings.ValidateOptional(settings, hasPassword); err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, err)
			}
		}
	}

	normalized := emailsettings.Normalize(settings)
	updated, err := s.queriesFor(ctx).UpsertTenantSMTPConfig(ctx, dbmodels.UpsertTenantSMTPConfigParams{
		TenantID:            tenant.ID,
		SmtpOverrideEnabled: req.Msg.SmtpOverrideEnabled,
		Host:                nullableString(normalized.Host),
		Port:                nullableInt32(normalized.Port),
		Username:            nullableString(normalized.Username),
		PasswordEncrypted:   nullableString(encryptedPassword),
		Encryption:          nullableString(normalized.Encryption),
		FromName:            nullableString(normalized.FromName),
		FromAddress:         nullableString(normalized.FromAddress),
		ReplyTo:             nullableString(normalized.ReplyTo),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert tenant email settings", err, "tenant_id", tenant.ID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "tenant_email_settings_updated",
		TargetType:  "smtp_config",
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.UpdateTenantEmailSettingsResponse{
		Settings: tenantEmailSettingsToProto(updated),
	}), nil
}

func (s *adminServer) SendTenantSmtpTestEmail(
	ctx context.Context,
	req *connect.Request[publiraadminv1.SendTenantSmtpTestEmailRequest],
) (*connect.Response[publiraadminv1.SendTenantSmtpTestEmailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if s.tester == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("smtp tester is unavailable"))
	}

	recipientEmail, err := emailsettings.ResolveRecipient(int32(req.Msg.RecipientType), req.Msg.RecipientEmail, sessionCtx.User.Email)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	settings, err := s.resolveTenantSMTPSettingsForTest(ctx, tenant.ID, req.Msg)
	if err != nil {
		return nil, err
	}

	if err := s.tester.SendTestEmail(ctx, settings, recipientEmail); err != nil {
		reason := internalsmtp.TestFailureReason(err)
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "tenant_smtp_test_email_sent",
			TargetType:  "smtp_config",
			TargetID:    tenant.PublicID,
			Outcome:     auditlog.OutcomeFailure,
			Reason:      reason,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
		return nil, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			errors.New("smtp connection test failed"),
			reason,
		)
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "tenant_smtp_test_email_sent",
		TargetType:  "smtp_config",
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.SendTenantSmtpTestEmailResponse{
		RecipientEmail: recipientEmail,
	}), nil
}

func (s *adminServer) loadTenantSMTPConfigByID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantSmtpConfig, bool, error) {
	config, err := s.queriesFor(ctx).GetTenantSMTPConfigByTenantID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.TenantSmtpConfig{}, false, nil
		}
		return dbmodels.TenantSmtpConfig{}, false, s.internalDBError(ctx, "failed to get tenant smtp config", err, "tenant_id", tenantID.String())
	}
	return config, true, nil
}

func (s *adminServer) loadPlatformSMTPConfigByID(ctx context.Context) (dbmodels.PlatformSmtpConfig, bool, error) {
	config, err := s.queriesFor(ctx).GetPlatformSMTPConfig(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformSmtpConfig{}, false, nil
		}
		return dbmodels.PlatformSmtpConfig{}, false, s.internalDBError(ctx, "failed to get platform smtp config", err)
	}
	return config, true, nil
}

func (s *adminServer) resolveTenantSMTPSettingsForTest(ctx context.Context, tenantID uuid.UUID, req *publiraadminv1.SendTenantSmtpTestEmailRequest) (emailsettings.SMTPSettings, error) {
	if req.SmtpOverrideEnabled {
		existing, found, err := s.loadTenantSMTPConfigByID(ctx, tenantID)
		if err != nil {
			return emailsettings.SMTPSettings{}, err
		}
		existingPassword := ""
		if found && existing.PasswordEncrypted.Valid {
			existingPassword = existing.PasswordEncrypted.String
		}
		password, err := emailsettings.ResolvePasswordForTest(existingPassword, int32(req.PasswordUpdateMode), req.Password, s.encryptor)
		if err != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInvalidArgument, err)
		}
		settings := tenantEmailSettingsFromTestRequest(req, password)
		if err := emailsettings.Validate(settings, true); err != nil {
			return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeInvalidArgument, err)
		}
		return settings, nil
	}

	platformConfig, found, err := s.loadPlatformSMTPConfigByID(ctx)
	if err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	if !found {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not configured"))
	}
	password, err := emailsettings.DecryptPassword(platformConfig.PasswordEncrypted, s.encryptor)
	if err != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("platform smtp settings are not available for testing"))
	}
	settings := platformEmailSettingsFromRow(platformConfig, password)
	if err := emailsettings.Validate(settings, true); err != nil {
		return emailsettings.SMTPSettings{}, connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return settings, nil
}

func nullableInt32(value int32) sql.NullInt32 {
	if value == 0 {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: value, Valid: true}
}

func nullableString(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: trimmed, Valid: true}
}
