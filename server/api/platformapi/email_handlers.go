package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

func platformEmailSettingsToProto(config dbmodels.PlatformSmtpConfig) *publirasplatformv1.PlatformEmailSettings {
	settings := &publirasplatformv1.PlatformEmailSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
		HasPassword: strings.TrimSpace(config.PasswordEncrypted) != "",
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func platformEmailSettingsFromUpdateRequest(req *publirasplatformv1.UpdatePlatformEmailSettingsRequest) emailsettings.SMTPSettings {
	return emailsettings.SMTPSettings{
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Encryption:  req.Encryption,
		FromAddress: req.FromAddress,
		ReplyTo:     req.ReplyTo,
	}
}

func platformEmailSettingsFromTestRequest(req *publirasplatformv1.SendPlatformSmtpTestEmailRequest, password string) emailsettings.SMTPSettings {
	return emailsettings.SMTPSettings{
		Host:        req.Host,
		Port:        req.Port,
		Username:    req.Username,
		Password:    password,
		Encryption:  req.Encryption,
		FromAddress: req.FromAddress,
		ReplyTo:     req.ReplyTo,
	}
}

func nullableString(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: trimmed, Valid: true}
}

func (s *platformServer) loadPlatformSMTPConfig(ctx context.Context) (dbmodels.PlatformSmtpConfig, bool, error) {
	config, err := s.queriesFor(ctx).GetPlatformSMTPConfig(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformSmtpConfig{}, false, nil
		}
		return dbmodels.PlatformSmtpConfig{}, false, s.internalDBError(ctx, "failed to get platform smtp config", err)
	}
	return config, true, nil
}

func (s *platformServer) GetPlatformEmailSettings(
	ctx context.Context,
	_req *connect.Request[publirasplatformv1.GetPlatformEmailSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformEmailSettingsResponse], error) {
	config, found, err := s.loadPlatformSMTPConfig(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return connect.NewResponse(&publirasplatformv1.GetPlatformEmailSettingsResponse{
			Settings: &publirasplatformv1.PlatformEmailSettings{},
		}), nil
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformEmailSettingsResponse{
		Settings: platformEmailSettingsToProto(config),
	}), nil
}

func (s *platformServer) UpdatePlatformEmailSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformEmailSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformEmailSettingsResponse], error) {
	existing, found, err := s.loadPlatformSMTPConfig(ctx)
	if err != nil {
		return nil, err
	}

	existingPassword := ""
	if found {
		existingPassword = existing.PasswordEncrypted
	}
	encryptedPassword, hasPassword, err := emailsettings.EncryptUpdatedPassword(existingPassword, int32(req.Msg.PasswordUpdateMode), req.Msg.Password, s.encryptor)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	settings := platformEmailSettingsFromUpdateRequest(req.Msg)
	if !hasPassword {
		return nil, connect.NewError(connect.CodeInvalidArgument, emailsettings.ErrPasswordRequired)
	}
	if err := emailsettings.Validate(settings, false); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpsertPlatformSMTPConfig(ctx, dbmodels.UpsertPlatformSMTPConfigParams{
		Host:              emailsettings.Normalize(settings).Host,
		Port:              settings.Port,
		Username:          emailsettings.Normalize(settings).Username,
		PasswordEncrypted: encryptedPassword,
		Encryption:        emailsettings.Normalize(settings).Encryption,
		FromAddress:       emailsettings.Normalize(settings).FromAddress,
		ReplyTo:           nullableString(settings.ReplyTo),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert platform smtp config", err)
	}

	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_email_settings_updated",
			TargetType:          "smtp_config",
			TargetID:            "platform",
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.UpdatePlatformEmailSettingsResponse{
		Settings: platformEmailSettingsToProto(updated),
	}), nil
}

func (s *platformServer) SendPlatformSmtpTestEmail(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SendPlatformSmtpTestEmailRequest],
) (*connect.Response[publirasplatformv1.SendPlatformSmtpTestEmailResponse], error) {
	actor, ok := platformActorFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeInternal, errors.New("platform actor is unavailable"))
	}
	if s.tester == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("smtp tester is unavailable"))
	}

	existing, found, err := s.loadPlatformSMTPConfig(ctx)
	if err != nil {
		return nil, err
	}
	existingPassword := ""
	if found {
		existingPassword = existing.PasswordEncrypted
	}

	password, err := emailsettings.ResolvePasswordForTest(existingPassword, int32(req.Msg.PasswordUpdateMode), req.Msg.Password, s.encryptor)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	settings := platformEmailSettingsFromTestRequest(req.Msg, password)
	if err := emailsettings.Validate(settings, true); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	recipientEmail, err := emailsettings.ResolveRecipient(int32(req.Msg.RecipientType), req.Msg.RecipientEmail, actor.Email)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	if err := s.tester.SendTestEmail(ctx, settings, recipientEmail); err != nil {
		reason := internalsmtp.UserFacingError(err)
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "platform_smtp_test_email_sent",
			TargetType:          "smtp_config",
			TargetID:            "platform",
			Outcome:             auditlog.OutcomeFailure,
			Reason:              reason,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New(reason))
	}

	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.UserID,
		ActorRole:           actor.Role,
		Action:              "platform_smtp_test_email_sent",
		TargetType:          "smtp_config",
		TargetID:            "platform",
		Outcome:             auditlog.OutcomeSuccess,
		ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publirasplatformv1.SendPlatformSmtpTestEmailResponse{
		RecipientEmail: recipientEmail,
	}), nil
}
