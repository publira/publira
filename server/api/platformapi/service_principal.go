package platformapi

import (
	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
)

// serviceProcedures are the reads a web app may make with its service token:
// ones whose answer is the same for every operator, so it can be cached for
// all of them. Every platform role reads all of these alike. Nothing that
// writes, answers per operator, or carries a stored secret belongs here; the
// email, storage, and search settings answer only whether their secret is set.
// GetPlatformWebPushSettings stays off because reading it generates and stores
// the VAPID key pair when none exists, and the notifications stay off because
// they belong to the operator reading them.
var serviceProcedures = map[string]struct{}{
	publirasplatformv1connect.PlatformTenantServiceListTenantsProcedure:                         {},
	publirasplatformv1connect.PlatformTenantServiceGetTenantProcedure:                           {},
	publirasplatformv1connect.PlatformTenantServiceListTenantMembersProcedure:                   {},
	publirasplatformv1connect.PlatformTenantServiceListTenantAdminInvitationsProcedure:          {},
	publirasplatformv1connect.PlatformPolicyServiceGetPlatformPolicyProcedure:                   {},
	publirasplatformv1connect.PlatformPolicyServiceGetPlatformRetentionDefaultsProcedure:        {},
	publirasplatformv1connect.PlatformSettingsServiceGetPlatformSettingsProcedure:               {},
	publirasplatformv1connect.PlatformEmailSettingsServiceGetPlatformEmailSettingsProcedure:     {},
	publirasplatformv1connect.PlatformStorageSettingsServiceGetPlatformStorageSettingsProcedure: {},
	publirasplatformv1connect.PlatformSearchSettingsServiceGetPlatformSearchSettingsProcedure:   {},
	publirasplatformv1connect.PlatformDashboardServiceGetDashboardSummaryProcedure:              {},
	publirasplatformv1connect.PlatformOperatorServiceListOperatorsProcedure:                     {},
	publirasplatformv1connect.PlatformOperatorServiceGetOperatorProcedure:                       {},
	publirasplatformv1connect.PlatformUserServiceListEndUsersProcedure:                          {},
	publirasplatformv1connect.PlatformUserServiceGetEndUserProcedure:                            {},
}

func serviceProcedureDeniedError() error {
	return connect.NewError(connect.CodePermissionDenied, "procedure is not available to the service credential")
}

// serviceActor answers the service principal for a request carrying the
// service token: ok reports whether it carries the token at all, and err
// refuses a procedure outside [serviceProcedures].
func (s *platformServer) serviceActor(headers *connect.Header, procedure string) (actor platformActor, ok bool, err error) {
	bearer, hasBearer := auth.BearerTokenFromHeader(headers)
	if !hasBearer || !s.serviceToken.Matches(bearer) {
		return platformActor{}, false, nil
	}
	if _, allowed := serviceProcedures[procedure]; !allowed {
		return platformActor{}, true, serviceProcedureDeniedError()
	}
	return platformActor{Service: true}, true, nil
}

// requirePerson refuses the service principal where an operator has to be
// behind the call, so a procedure put on the allowlist by mistake fails closed
// there.
func (a platformActor) requirePerson() error {
	if a.Service {
		return connect.NewError(connect.CodePermissionDenied, "an operator is required")
	}
	return nil
}
