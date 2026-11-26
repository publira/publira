package adminapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// StepUpHeader carries the token Reauthenticate answers, beside the session's
// Authorization header, to the procedures in stepUpProcedures.
const StepUpHeader = "Publira-Step-Up"

// auditActionReauthenticated records a console account's re-authentication,
// and every refusal of one.
const auditActionReauthenticated = "admin_reauthenticated"

// stepUpProcedures are the RPCs a session alone does not admit: they also take
// a step-up token, which Reauthenticate answers for the account's password or
// one of its second factors. The rule for which RPC belongs here is in
// server/AGENTS.md. TestStepUpProceduresMatchTheirProtoComments keeps the
// list and the "Requires a recent re-authentication." line of each RPC's
// proto comment in step, and keeps every one at tenant_admin and out of reach
// of an API key and of the web apps' service credential.
var stepUpProcedures = map[string]struct{}{
	// Where the tenant's revenue goes, and the credentials it is taken with.
	"/publira.admin.v1.AdminPaymentSettingsService/UpdateTenantPaymentSettings":      {},
	"/publira.admin.v1.AdminPaymentSettingsService/UpsertTenantPaymentProvider":      {},
	"/publira.admin.v1.AdminPaymentSettingsService/UpdateTenantStorePaymentSettings": {},
	// Money paid back out.
	"/publira.admin.v1.AdminPurchaseService/RefundPurchase":       {},
	"/publira.admin.v1.AdminPurchaseService/RefundPurchaseInPart": {},
	// A console role, given at once or by invitation.
	"/publira.admin.v1.AdminTenantMemberService/AddTenantMember":             {},
	"/publira.admin.v1.AdminTenantMemberService/UpdateTenantMemberRole":      {},
	"/publira.admin.v1.AdminTenantMemberService/CreateTenantAdminInvitation": {},
	// A credential of the tenant's own, and where the tenant's events go.
	"/publira.admin.v1.AdminApiKeyService/CreateApiKey":           {},
	"/publira.admin.v1.AdminWebhookService/CreateWebhookEndpoint": {},
	"/publira.admin.v1.AdminWebhookService/UpdateWebhookEndpoint": {},
	"/publira.admin.v1.AdminWebhookService/RotateWebhookSecret":   {},
	// A reader's account, and what protects it.
	"/publira.admin.v1.AdminUserService/DeleteReader":   {},
	"/publira.admin.v1.AdminUserService/ResetReaderMfa": {},
	// The credentials the tenant holds with the services its mail, its push
	// notifications, and its readers' sign-ins go through.
	"/publira.admin.v1.AdminEmailSettingsService/UpdateTenantEmailSettings":               {},
	"/publira.admin.v1.AdminInboundEmailSettingsService/UpdateTenantInboundEmailSettings": {},
	"/publira.admin.v1.AdminFcmSettingsService/SaveTenantFcmCredentials":                  {},
	"/publira.admin.v1.TenantSettingsService/UpdateTenantSignInSettings":                  {},
}

func reauthenticationRequiredError(err error) error {
	return rpcerrors.NewErrorInfoError(connect.CodePermissionDenied, err, rpcerrors.ReasonReauthenticationRequired)
}

// authenticateSteppedUpSession is authenticateSession for a procedure in
// stepUpProcedures: the session has to come with a step-up token earned on
// it. Every one of those procedures is at tenant_admin, so a weaker role is
// let through to the handler's own refusal rather than asked for a password
// that would not admit it.
func (s *adminServer) authenticateSteppedUpSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers *connect.Header,
) (rpcmiddleware.SessionContext, error) {
	session, claims, err := s.verifySession(ctx, tenantCtx, headers)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	if !auth.TenantRoleAtLeast(session.Role, auth.RoleTenantAdmin) {
		return session, nil
	}
	token := strings.TrimSpace(headers.Get(StepUpHeader))
	if token == "" {
		return rpcmiddleware.SessionContext{}, reauthenticationRequiredError(errors.New("a recent re-authentication is required"))
	}
	if err := s.tokens.VerifyStepUpToken(token, claims); err != nil {
		return rpcmiddleware.SessionContext{}, reauthenticationRequiredError(err)
	}
	return session, nil
}

// Reauthenticate exchanges the account's password, or proof of one of its
// second factors, for a step-up token bound to the session it was sent on.
func (s *adminServer) Reauthenticate(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceReauthenticateRequest,
) (*publiraadminv1.AdminAuthServiceReauthenticateResponse, error) {
	session, claims, err := s.verifySession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		auth.AuditEvent(ctx, auditActionReauthenticated, "failure", "", "", "invalid_session")
		return nil, err
	}
	sessionID, _, ok := claims.SessionID()
	if !ok {
		// A session from before access tokens carried an id has nothing a
		// step-up could be bound to; signing in again issues one that does.
		return nil, invalidSessionError()
	}
	actor := mfaActor{Tenant: session.Tenant, User: session.User, Role: session.Role}
	refuse := func(reason string, err error) error {
		s.recordMfaAudit(ctx, actor, auditActionReauthenticated, auditlog.OutcomeFailure, reason)
		return err
	}

	password := req.GetPassword()
	confirmation := req.GetConfirmation()
	confirming := strings.TrimSpace(confirmation.GetCode()) != "" || strings.TrimSpace(confirmation.GetPasskeyCredentialJson()) != ""
	var factor string
	switch {
	case strings.TrimSpace(password) != "" && confirming:
		return nil, refuse("invalid_input", connect.NewError(connect.CodeInvalidArgument, "send either password or confirmation, not both"))
	case strings.TrimSpace(password) != "":
		tenantID, userID := session.Tenant.ID.String(), session.User.ID.String()
		if err := s.login.ChargeStepUp(ctx, tenantID, userID); err != nil {
			return nil, refuse("password_rate_limited", err)
		}
		if !auth.VerifyUserPassword(password, session.User.PasswordHash) {
			return nil, refuse("invalid_password", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid password"), "password"))
		}
		s.login.ClearStepUp(ctx, tenantID, userID)
		factor = "password"
	case confirming:
		// confirmFactorChange records its own refusals under the action.
		confirmed, proved, err := s.confirmFactorChange(ctx, actor, auditActionReauthenticated, confirmation)
		if err != nil {
			return nil, err
		}
		if !confirmed {
			return nil, refuse("no_second_factor", connect.NewError(connect.CodeFailedPrecondition, "the account holds no second factor"))
		}
		factor = proved
	default:
		return nil, refuse("invalid_input", connect.NewError(connect.CodeInvalidArgument, "password or confirmation is required"))
	}

	token, expiresAt, err := s.tokens.IssueStepUpToken(session.User.PublicID, claims.TenantID, sessionID, claims.CredentialsVersion, time.Now())
	if err != nil {
		return nil, s.internalError(ctx, "failed to issue a step-up token", err, "user_id", session.User.ID.String())
	}
	s.recordMfaAudit(ctx, actor, auditActionReauthenticated, auditlog.OutcomeSuccess, factor)
	return &publiraadminv1.AdminAuthServiceReauthenticateResponse{
		StepUpToken: &publirattypesv1.AccessToken{
			Token:     token,
			ExpiresAt: auth.FormatExpiresAt(expiresAt),
		},
	}, nil
}
