package platformapi

import (
	"context"
	"errors"
	"net/http"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1connect "github.com/publira/publira/server/internal/gen/publira/platform/v1/publirasplatformv1connect"
)

// platformWriteProcedures is the platform-wide authorization boundary for
// operations that change shared platform or tenant state. Keep this list next
// to the interceptor so newly added RPCs must make an explicit choice.
var platformWriteProcedures = map[string]struct{}{
	publirasplatformv1connect.PlatformEmailSettingsServiceUpdatePlatformEmailSettingsProcedure: {},
	publirasplatformv1connect.PlatformEmailSettingsServiceSendPlatformSmtpTestEmailProcedure:   {},
	publirasplatformv1connect.PlatformSettingsServiceUpdatePlatformSettingsProcedure:           {},
	publirasplatformv1connect.PlatformTenantServiceCreateTenantProcedure:                       {},
	publirasplatformv1connect.PlatformTenantServiceUpdateTenantProcedure:                       {},
	publirasplatformv1connect.PlatformTenantServiceSuspendTenantProcedure:                      {},
	publirasplatformv1connect.PlatformTenantServiceResumeTenantProcedure:                       {},
	publirasplatformv1connect.PlatformTenantServiceAddTenantMemberProcedure:                    {},
	publirasplatformv1connect.PlatformTenantServiceUpdateTenantMemberRoleProcedure:             {},
	publirasplatformv1connect.PlatformTenantServiceRemoveTenantMemberProcedure:                 {},
	publirasplatformv1connect.PlatformTenantServiceCreateTenantAdminInvitationProcedure:        {},
	publirasplatformv1connect.PlatformTenantServiceResendTenantAdminInvitationProcedure:        {},
	publirasplatformv1connect.PlatformTenantServiceCancelTenantAdminInvitationProcedure:        {},
	publirasplatformv1connect.PlatformUserServiceSuspendEndUserProcedure:                       {},
	publirasplatformv1connect.PlatformUserServiceUnsuspendEndUserProcedure:                     {},
	publirasplatformv1connect.PlatformUserServiceDeleteEndUserProcedure:                        {},
	publirasplatformv1connect.PlatformOperatorServiceCreateOperatorProcedure:                   {},
	publirasplatformv1connect.PlatformOperatorServiceUpdateOperatorRoleProcedure:               {},
	publirasplatformv1connect.PlatformOperatorServiceSuspendOperatorProcedure:                  {},
	publirasplatformv1connect.PlatformOperatorServiceUnsuspendOperatorProcedure:                {},
	publirasplatformv1connect.PlatformOperatorServiceDeactivateOperatorProcedure:               {},
}

func isPlatformWriteProcedure(procedure string) bool {
	_, ok := platformWriteProcedures[procedure]
	return ok
}

func ensurePlatformWriteRole(role string) error {
	switch role {
	case auth.RolePlatformOperator, auth.RolePlatformSuperAdmin:
		return nil
	default:
		return connect.NewError(connect.CodePermissionDenied, errors.New("platform write role required"))
	}
}

func (s *platformServer) requirePlatformActor(ctx context.Context, headers http.Header) (platformActor, error) {
	if actor, ok := platformActorFromContext(ctx); ok {
		return actor, nil
	}
	_, user, role, err := s.authenticatePlatformSession(ctx, "", headers)
	if err != nil {
		return platformActor{}, err
	}
	return platformActor{UserID: user.ID, Role: role, Email: user.Email}, nil
}

func (s *platformServer) requirePlatformWriteActor(ctx context.Context, headers http.Header) (platformActor, error) {
	actor, err := s.requirePlatformActor(ctx, headers)
	if err != nil {
		return platformActor{}, err
	}
	if err := ensurePlatformWriteRole(actor.Role); err != nil {
		return platformActor{}, err
	}
	return actor, nil
}
