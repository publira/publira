package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/signin"
)

// tenantSignInRevalidateTags names the public tenant read, which answers the
// providers a reader can sign in with.
func tenantSignInRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func tenantSignInSettingsToProto(cfg signin.Config) *publiraadminv1.TenantSignInSettings {
	return &publiraadminv1.TenantSignInSettings{
		Apple: &publiraadminv1.TenantAppleSignInSettings{
			Enabled:              cfg.Apple.Enabled,
			ServicesId:           cfg.Apple.ServicesID,
			TeamId:               cfg.Apple.TeamID,
			KeyId:                cfg.Apple.KeyID,
			PrivateKeyConfigured: cfg.Apple.PrivateKeyConfigured,
			PrivateKeyHint:       cfg.Apple.PrivateKeyHint,
			BundleIdentifier:     cfg.Apple.BundleIdentifier,
			Ready:                cfg.Apple.Ready,
		},
		Google: &publiraadminv1.TenantGoogleSignInSettings{
			Enabled:     cfg.Google.Enabled,
			WebClientId: cfg.Google.WebClientID,
			IosClientId: cfg.Google.IOSClientID,
			Ready:       cfg.Google.Ready,
		},
	}
}

func mapSignInSettingsUpdateError(err error) error {
	switch {
	case errors.Is(err, signin.ErrInvalidServicesID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "apple.services_id")
	case errors.Is(err, signin.ErrInvalidTeamID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "apple.team_id")
	case errors.Is(err, signin.ErrInvalidKeyID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "apple.key_id")
	case errors.Is(err, signin.ErrInvalidPrivateKey), errors.Is(err, signin.ErrPrivateKeyRequired):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "apple.private_key")
	case errors.Is(err, secretupdate.ErrInvalidMode):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "apple.private_key_update_mode")
	case errors.Is(err, signin.ErrInvalidGoogleClientID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "google")
	case errors.Is(err, signin.ErrAppleCredentialsRequired),
		errors.Is(err, signin.ErrGoogleClientRequired):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return nil
	}
}

func (s *adminServer) GetTenantSignInSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantSignInSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantSignInSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	cfg, err := signin.NewSettings(s.queriesFor(ctx), s.encryptor).Get(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant sign-in settings", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantSignInSettingsResponse{Settings: tenantSignInSettingsToProto(cfg)}), nil
}

func (s *adminServer) UpdateTenantSignInSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantSignInSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantSignInSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	apple := req.Msg.GetApple()
	google := req.Msg.GetGoogle()
	input := signin.UpdateInput{
		Apple: signin.AppleUpdate{
			Enabled:              apple.GetEnabled(),
			ServicesID:           apple.GetServicesId(),
			TeamID:               apple.GetTeamId(),
			KeyID:                apple.GetKeyId(),
			PrivateKey:           apple.GetPrivateKey(),
			PrivateKeyUpdateMode: secretupdate.Mode(apple.GetPrivateKeyUpdateMode()),
		},
		Google: signin.GoogleUpdate{
			Enabled:     google.GetEnabled(),
			WebClientID: google.GetWebClientId(),
			IOSClientID: google.GetIosClientId(),
		},
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant sign-in settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	cfg, err := signin.NewSettings(txq, s.encryptor).Update(ctx, tenant.ID, input)
	if err != nil {
		if mapped := mapSignInSettingsUpdateError(err); mapped != nil {
			return nil, mapped
		}
		return nil, s.internalDBError(ctx, "failed to update tenant sign-in settings", err, "tenant_id", tenant.ID.String())
	}
	if err := auditlog.WriteTenant(ctx, txq, s.logger, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: session.User.ID,
		ActorRole:   session.Role,
		Action:      signin.ActionSettingsUpdated,
		TargetType:  "tenant_sign_in_settings",
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      signInSettingsAuditReason(input),
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to audit tenant sign-in settings", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant sign-in settings", err, "tenant_id", tenant.ID.String())
	}
	s.revalidateTags(ctx, tenant.ID, tenantSignInRevalidateTags(tenant.ID.String()))
	return connect.NewResponse(&publiraadminv1.UpdateTenantSignInSettingsResponse{Settings: tenantSignInSettingsToProto(cfg)}), nil
}

// signInSettingsAuditReason names what the update left enabled and what it did
// to the key, and never a value.
func signInSettingsAuditReason(input signin.UpdateInput) string {
	parts := []string{
		fmt.Sprintf("apple.enabled=%t", input.Apple.Enabled),
		fmt.Sprintf("google.enabled=%t", input.Google.Enabled),
	}
	switch input.Apple.PrivateKeyUpdateMode {
	case secretupdate.Replace:
		parts = append(parts, "apple.private_key=replaced")
	case secretupdate.Clear:
		parts = append(parts, "apple.private_key=cleared")
	}
	return strings.Join(parts, ", ")
}
