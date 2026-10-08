package platformapi

import (
	"context"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// platformWriteProcedures is the platform-wide authorization boundary for
// operations that change shared platform or tenant state. Keep this list next
// to the interceptor so newly added RPCs must make an explicit choice.
var platformWriteProcedures = map[string]struct{}{
	publirasplatformv1connect.PlatformEmailSettingsServiceUpdatePlatformEmailSettingsProcedure:     {},
	publirasplatformv1connect.PlatformEmailSettingsServiceSendPlatformSmtpTestEmailProcedure:       {},
	publirasplatformv1connect.PlatformSettingsServiceUpdatePlatformSettingsProcedure:               {},
	publirasplatformv1connect.PlatformPolicyServiceUpdatePlatformPolicyProcedure:                   {},
	publirasplatformv1connect.PlatformPolicyServiceUpdatePlatformRetentionDefaultsProcedure:        {},
	publirasplatformv1connect.PlatformStorageSettingsServiceUpdatePlatformStorageSettingsProcedure: {},
	publirasplatformv1connect.PlatformStorageSettingsServiceTestPlatformStorageConnectionProcedure: {},
	publirasplatformv1connect.PlatformSearchSettingsServiceUpdatePlatformSearchSettingsProcedure:   {},
	publirasplatformv1connect.PlatformSearchSettingsServiceTestPlatformSearchConnectionProcedure:   {},
	publirasplatformv1connect.PlatformWebPushSettingsServiceUpdatePlatformWebPushSubjectProcedure:  {},
	publirasplatformv1connect.PlatformTenantServiceCreateTenantProcedure:                           {},
	publirasplatformv1connect.PlatformTenantServiceUpdateTenantProcedure:                           {},
	publirasplatformv1connect.PlatformTenantServiceSuspendTenantProcedure:                          {},
	publirasplatformv1connect.PlatformTenantServiceResumeTenantProcedure:                           {},
	publirasplatformv1connect.PlatformTenantServiceAddTenantMemberProcedure:                        {},
	publirasplatformv1connect.PlatformTenantServiceUpdateTenantMemberRoleProcedure:                 {},
	publirasplatformv1connect.PlatformTenantServiceRemoveTenantMemberProcedure:                     {},
	publirasplatformv1connect.PlatformTenantServiceCreateTenantAdminInvitationProcedure:            {},
	publirasplatformv1connect.PlatformTenantServiceResendTenantAdminInvitationProcedure:            {},
	publirasplatformv1connect.PlatformTenantServiceCancelTenantAdminInvitationProcedure:            {},
	publirasplatformv1connect.PlatformUserServiceSuspendEndUserProcedure:                           {},
	publirasplatformv1connect.PlatformUserServiceUnsuspendEndUserProcedure:                         {},
	publirasplatformv1connect.PlatformUserServiceDeleteEndUserProcedure:                            {},
	publirasplatformv1connect.PlatformOperatorServiceCreateOperatorProcedure:                       {},
	publirasplatformv1connect.PlatformOperatorServiceUpdateOperatorRoleProcedure:                   {},
	publirasplatformv1connect.PlatformOperatorServiceSuspendOperatorProcedure:                      {},
	publirasplatformv1connect.PlatformOperatorServiceUnsuspendOperatorProcedure:                    {},
	publirasplatformv1connect.PlatformOperatorServiceDeactivateOperatorProcedure:                   {},
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
		return connect.NewError(connect.CodePermissionDenied, "platform write role required")
	}
}

func (s *platformServer) requirePlatformActor(ctx context.Context, headers *connect.Header) (platformActor, error) {
	if actor, ok := platformActorFromContext(ctx); ok {
		return actor, nil
	}
	_, user, role, err := s.authenticatePlatformSession(ctx, "", headers)
	if err != nil {
		return platformActor{}, err
	}
	return platformActor{UserID: user.ID, Role: role, Email: user.Email}, nil
}

// auditActor is the operator behind the call ctx serves, as the packages under
// internal/ file their audit entries.
func (s *platformServer) auditActor(ctx context.Context) (auditlog.PlatformActor, error) {
	headers := rpcmiddleware.RequestHeader(ctx)
	actor, err := s.requirePlatformActor(ctx, headers)
	if err != nil {
		return auditlog.PlatformActor{}, err
	}
	if err := actor.requirePerson(); err != nil {
		return auditlog.PlatformActor{}, err
	}
	return actor.audit(ctx), nil
}

// audit is a, as the packages under internal/ file their audit entries.
func (a platformActor) audit(ctx context.Context) auditlog.PlatformActor {
	return auditlog.PlatformActor{UserID: a.UserID, Role: a.Role, ClientIP: clientip.FromContext(ctx)}
}

func (s *platformServer) requirePlatformWriteActor(ctx context.Context, headers *connect.Header) (platformActor, error) {
	actor, err := s.requirePlatformActor(ctx, headers)
	if err != nil {
		return platformActor{}, err
	}
	if err := ensurePlatformWriteRole(actor.Role); err != nil {
		return platformActor{}, err
	}
	return actor, nil
}
