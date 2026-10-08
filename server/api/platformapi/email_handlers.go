package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/platformsmtp"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/secretupdate"
)

func platformEmailSettingsToProto(config dbmodels.PlatformSmtpConfig) *publirasplatformv1.PlatformEmailSettings {
	settings := &publirasplatformv1.PlatformEmailSettings{
		Host:        config.Host,
		Port:        config.Port,
		Username:    config.Username,
		Encryption:  config.Encryption,
		FromAddress: config.FromAddress,
		HasPassword: platformsmtp.HasPassword(config),
		Revision:    config.Revision,
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

// emailSettingsError maps what platformsmtp refuses to this API's codes,
// naming the request field when the refusal has one.
func (s *platformServer) emailSettingsError(ctx context.Context, err error) error {
	if connectErr := rpcerrors.FromFieldError(err); connectErr != nil {
		return connectErr
	}
	var failure *platformsmtp.TestFailure
	switch {
	case errors.Is(err, platformsmtp.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, err.Error()).WithCause(err)
	case errors.As(err, &failure):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("smtp connection test failed"), failure.Reason)
	}
	return s.internalDBError(ctx, "failed to access platform smtp config", err)
}

func (s *platformServer) GetPlatformEmailSettings(
	ctx context.Context,
	_req *publirasplatformv1.GetPlatformEmailSettingsRequest,
) (*publirasplatformv1.GetPlatformEmailSettingsResponse, error) {
	config, found, err := platformsmtp.Get(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get platform smtp config", err)
	}
	settings := &publirasplatformv1.PlatformEmailSettings{}
	if found {
		settings = platformEmailSettingsToProto(config)
	}
	return &publirasplatformv1.GetPlatformEmailSettingsResponse{Settings: settings}, nil
}

func (s *platformServer) UpdatePlatformEmailSettings(
	ctx context.Context,
	req *publirasplatformv1.UpdatePlatformEmailSettingsRequest,
) (*publirasplatformv1.UpdatePlatformEmailSettingsResponse, error) {
	expectedRevision := req.GetExpectedRevision()
	params := platformsmtp.SaveParams{
		Settings: emailsettings.SMTPSettings{
			Host:        req.GetHost(),
			Port:        req.GetPort(),
			Username:    req.GetUsername(),
			Encryption:  req.GetEncryption(),
			FromAddress: req.GetFromAddress(),
			ReplyTo:     req.GetReplyTo(),
		},
		PasswordMode:     secretupdate.Mode(req.GetPasswordUpdateMode()),
		Password:         req.GetPassword(),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx)
	if err != nil {
		return nil, err
	}

	saved, err := platformsmtp.Save(ctx, s.db, s.logger, s.encryptor, actor, params)
	if err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	return &publirasplatformv1.UpdatePlatformEmailSettingsResponse{
		Settings: platformEmailSettingsToProto(saved),
	}, nil
}

func (s *platformServer) SendPlatformSmtpTestEmail(
	ctx context.Context,
	req *publirasplatformv1.SendPlatformSmtpTestEmailRequest,
) (*publirasplatformv1.SendPlatformSmtpTestEmailResponse, error) {
	actor, err := s.requirePlatformActor(ctx, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if s.tester == nil {
		return nil, connect.NewError(connect.CodeInternal, "smtp tester is unavailable")
	}

	tester := platformsmtp.Tester{Encryptor: s.encryptor, SMTP: s.tester, Recorder: s.recorder}
	recipient, err := tester.Send(ctx, s.queriesFor(ctx), actor.audit(ctx), platformsmtp.TestParams{
		Settings: emailsettings.SMTPSettings{
			Host:        req.GetHost(),
			Port:        req.GetPort(),
			Username:    req.GetUsername(),
			Encryption:  req.GetEncryption(),
			FromAddress: req.GetFromAddress(),
			ReplyTo:     req.GetReplyTo(),
		},
		PasswordMode:   secretupdate.Mode(req.GetPasswordUpdateMode()),
		Password:       req.GetPassword(),
		RecipientType:  int32(req.GetRecipientType()),
		RecipientEmail: req.GetRecipientEmail(),
		SelfEmail:      actor.Email,
	})
	if err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	return &publirasplatformv1.SendPlatformSmtpTestEmailResponse{
		RecipientEmail: recipient,
	}, nil
}
