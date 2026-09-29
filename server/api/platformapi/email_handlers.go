package platformapi

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/platformsmtp"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
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
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.As(err, &failure):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errors.New("smtp connection test failed"), failure.Reason)
	}
	return s.internalDBError(ctx, "failed to access platform smtp config", err)
}

func (s *platformServer) GetPlatformEmailSettings(
	ctx context.Context,
	_req *connect.Request[publirasplatformv1.GetPlatformEmailSettingsRequest],
) (*connect.Response[publirasplatformv1.GetPlatformEmailSettingsResponse], error) {
	config, found, err := platformsmtp.Get(ctx, s.queriesFor(ctx))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get platform smtp config", err)
	}
	settings := &publirasplatformv1.PlatformEmailSettings{}
	if found {
		settings = platformEmailSettingsToProto(config)
	}
	return connect.NewResponse(&publirasplatformv1.GetPlatformEmailSettingsResponse{Settings: settings}), nil
}

func (s *platformServer) UpdatePlatformEmailSettings(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdatePlatformEmailSettingsRequest],
) (*connect.Response[publirasplatformv1.UpdatePlatformEmailSettingsResponse], error) {
	expectedRevision := req.Msg.GetExpectedRevision()
	params := platformsmtp.SaveParams{
		Settings: emailsettings.SMTPSettings{
			Host:        req.Msg.GetHost(),
			Port:        req.Msg.GetPort(),
			Username:    req.Msg.GetUsername(),
			Encryption:  req.Msg.GetEncryption(),
			FromAddress: req.Msg.GetFromAddress(),
			ReplyTo:     req.Msg.GetReplyTo(),
		},
		PasswordMode:     secretupdate.Mode(req.Msg.GetPasswordUpdateMode()),
		Password:         req.Msg.GetPassword(),
		ExpectedRevision: &expectedRevision,
	}
	if err := params.Validate(); err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	saved, err := platformsmtp.Save(ctx, s.db, s.logger, s.encryptor, actor, params)
	if err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.UpdatePlatformEmailSettingsResponse{
		Settings: platformEmailSettingsToProto(saved),
	}), nil
}

func (s *platformServer) SendPlatformSmtpTestEmail(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SendPlatformSmtpTestEmailRequest],
) (*connect.Response[publirasplatformv1.SendPlatformSmtpTestEmailResponse], error) {
	actor, err := s.requirePlatformActor(ctx, req.Header())
	if err != nil {
		return nil, err
	}
	if s.tester == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("smtp tester is unavailable"))
	}

	tester := platformsmtp.Tester{Encryptor: s.encryptor, SMTP: s.tester, Recorder: s.recorder}
	recipient, err := tester.Send(ctx, s.queriesFor(ctx), actor.audit(req.Header()), platformsmtp.TestParams{
		Settings: emailsettings.SMTPSettings{
			Host:        req.Msg.GetHost(),
			Port:        req.Msg.GetPort(),
			Username:    req.Msg.GetUsername(),
			Encryption:  req.Msg.GetEncryption(),
			FromAddress: req.Msg.GetFromAddress(),
			ReplyTo:     req.Msg.GetReplyTo(),
		},
		PasswordMode:   secretupdate.Mode(req.Msg.GetPasswordUpdateMode()),
		Password:       req.Msg.GetPassword(),
		RecipientType:  int32(req.Msg.GetRecipientType()),
		RecipientEmail: req.Msg.GetRecipientEmail(),
		SelfEmail:      actor.Email,
	})
	if err != nil {
		return nil, s.emailSettingsError(ctx, err)
	}
	return connect.NewResponse(&publirasplatformv1.SendPlatformSmtpTestEmailResponse{
		RecipientEmail: recipient,
	}), nil
}
