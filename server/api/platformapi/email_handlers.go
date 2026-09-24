package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/emailsettings"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// errPlatformEmailSettingsConflict is what a save based on a revision the stored
// row has moved past reports.
var errPlatformEmailSettingsConflict = errors.New("platform email settings have changed since they were read")

func platformEmailSettingsToProto(config dbmodels.PlatformSmtpConfig) *publirasplatformv1.PlatformEmailSettings {
	settings := &publirasplatformv1.PlatformEmailSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
		HasPassword: strings.TrimSpace(config.PasswordEncrypted) != "",
		Revision:    config.Revision,
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

// smtpWrite is one save: the values to store, how the request stated the
// password that goes with them, and the revision they were derived from.
type smtpWrite struct {
	settings         emailsettings.SMTPSettings
	passwordMode     secretupdate.Mode
	password         string
	expectedRevision int64
}

// writePlatformSMTPConfig locks the row, compares its revision with the one the
// request states, and writes only when they match. The password a save keeps
// comes from the locked row too, so it is the one the revision was compared
// against rather than one another session has since replaced.
func (s *platformServer) writePlatformSMTPConfig(ctx context.Context, write smtpWrite) (dbmodels.PlatformSmtpConfig, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.PlatformSmtpConfig{}, s.internalDBError(ctx, "failed to begin update platform smtp config transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	var updated dbmodels.PlatformSmtpConfig
	current, err := txq.LockPlatformSMTPConfig(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if write.expectedRevision != 0 {
			return dbmodels.PlatformSmtpConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformEmailSettingsConflict)
		}
		params, paramsErr := platformSMTPConfigParams(write, "", s.encryptor)
		if paramsErr != nil {
			return dbmodels.PlatformSmtpConfig{}, paramsErr
		}
		updated, err = txq.InsertPlatformSMTPConfig(ctx, dbmodels.InsertPlatformSMTPConfigParams(params))
		if err != nil {
			// Two first saves both find nothing to lock; the primary key
			// settles which one wins.
			if dberr.IsUniqueViolation(err) {
				return dbmodels.PlatformSmtpConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformEmailSettingsConflict)
			}
			return dbmodels.PlatformSmtpConfig{}, s.internalDBError(ctx, "failed to create platform smtp config", err)
		}
	case err != nil:
		return dbmodels.PlatformSmtpConfig{}, s.internalDBError(ctx, "failed to lock platform smtp config", err)
	default:
		if write.expectedRevision != current.Revision {
			return dbmodels.PlatformSmtpConfig{}, connect.NewError(connect.CodeFailedPrecondition, errPlatformEmailSettingsConflict)
		}
		params, paramsErr := platformSMTPConfigParams(write, current.PasswordEncrypted, s.encryptor)
		if paramsErr != nil {
			return dbmodels.PlatformSmtpConfig{}, paramsErr
		}
		updated, err = txq.UpdatePlatformSMTPConfig(ctx, params)
		if err != nil {
			return dbmodels.PlatformSmtpConfig{}, s.internalDBError(ctx, "failed to update platform smtp config", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return dbmodels.PlatformSmtpConfig{}, s.internalDBError(ctx, "failed to commit platform smtp config", err)
	}
	return updated, nil
}

// platformSMTPConfigParams resolves the password the row ends up holding from
// the stored ciphertext, which is empty when nothing is saved yet.
func platformSMTPConfigParams(
	write smtpWrite,
	existingPassword string,
	encryptor emailsettings.SecretManager,
) (dbmodels.UpdatePlatformSMTPConfigParams, error) {
	encryptedPassword, hasPassword, err := emailsettings.EncryptUpdatedPassword(existingPassword, write.passwordMode, write.password, encryptor)
	if err != nil {
		return dbmodels.UpdatePlatformSMTPConfigParams{}, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if !hasPassword {
		return dbmodels.UpdatePlatformSMTPConfigParams{}, connect.NewError(connect.CodeInvalidArgument, emailsettings.ErrPasswordRequired)
	}
	normalized := emailsettings.Normalize(write.settings)
	return dbmodels.UpdatePlatformSMTPConfigParams{
		Host:              normalized.Host,
		Port:              write.settings.Port,
		Username:          normalized.Username,
		PasswordEncrypted: encryptedPassword,
		Encryption:        normalized.Encryption,
		FromAddress:       normalized.FromAddress,
		ReplyTo:           nullableString(write.settings.ReplyTo),
	}, nil
}

func (s *platformServer) UpdatePlatformEmailSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformEmailSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformEmailSettingsResponse], error) {
	settings := platformEmailSettingsFromUpdateRequest(req.Msg)
	if err := emailsettings.Validate(settings, false); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.GetExpectedRevision() < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	updated, err := s.writePlatformSMTPConfig(ctx, smtpWrite{
		settings:         settings,
		passwordMode:     secretupdate.Mode(req.Msg.GetPasswordUpdateMode()),
		password:         req.Msg.GetPassword(),
		expectedRevision: req.Msg.GetExpectedRevision(),
	})
	if err != nil {
		return nil, err
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

	password, err := emailsettings.ResolvePasswordForTest(existingPassword, secretupdate.Mode(req.Msg.PasswordUpdateMode), req.Msg.Password, s.encryptor)
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
		reason := internalsmtp.TestFailureReason(err)
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
		return nil, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			errors.New("smtp connection test failed"),
			reason,
		)
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
