package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/mfaflow"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// The actions the second factor writes to the tenant audit trail. A wrong
// code is the same action as a right one with outcome failure, which is how
// the rest of audit_logs distinguishes the two.
const (
	auditActionMfaPasskeyRegistered = "admin_mfa_passkey_registered"
	auditActionMfaPasskeyRenamed    = "admin_mfa_passkey_renamed"
	auditActionMfaPasskeyRemoved    = "admin_mfa_passkey_removed"
)

var mfaAuditActions = mfaflow.Actions{
	Enrolled:                 "admin_mfa_enrolled",
	Verified:                 "admin_mfa_verified",
	RecoveryCodeUsed:         "admin_mfa_recovery_code_used",
	Disabled:                 "admin_mfa_disabled",
	RecoveryCodesRegenerated: "admin_mfa_recovery_codes_regenerated",
}

// mfaOTPAuthIssuer is what an authenticator app lists the entry under when
// the tenant has no name of its own to show.
const mfaOTPAuthIssuer = "Publira"

// mfaActor is the account an MFA RPC acts for, together with how it proved
// who it is. FromChallenge marks the token a password alone earned, which is
// the only case where finishing an enrollment also finishes the login.
// ChallengeID and ChallengeExpiresAt name that token, so an exchange can
// record it as spent; both are zero for an actor identified by a session.
type mfaActor struct {
	Tenant             dbmodels.Tenant
	User               dbmodels.User
	Role               string
	FromChallenge      bool
	ChallengeID        uuid.UUID
	ChallengeExpiresAt time.Time
}

// mfaAccount is a tenant member's second factor, as mfaflow reaches it: over
// users and their user_mfa_* rows on the request's tenant-scoped connection,
// with failures counted in user_mfa_lockouts, where a refused passkey counts
// toward the same lock as a refused code, and audit entries in the tenant's
// audit_logs.
type mfaAccount struct {
	s     *adminServer
	actor mfaActor
}

func (s *adminServer) mfaAccount(actor mfaActor) mfaAccount {
	return mfaAccount{s: s, actor: actor}
}

var _ mfaflow.Account = mfaAccount{}

func (a mfaAccount) Queries(ctx context.Context) dbmodels.Querier {
	return a.s.queriesFor(ctx)
}

func (a mfaAccount) InTx(ctx context.Context, fn func(q dbmodels.Querier) error) error {
	userID := a.actor.User.ID
	tx, err := a.s.beginTenantTx(ctx)
	if err != nil {
		return a.s.internalDBError(ctx, "failed to begin mfa transaction", err, "user_id", userID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := a.s.lockMfaFactors(ctx, q, userID); err != nil {
		return err
	}
	if err := fn(q); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return a.s.internalDBError(ctx, "failed to commit mfa transaction", err, "user_id", userID.String())
	}
	return nil
}

func (a mfaAccount) Totp(ctx context.Context, q dbmodels.Querier) (mfaflow.Totp, bool, error) {
	row, err := q.GetUserMfaTotpByUserID(ctx, a.actor.User.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return mfaflow.Totp{}, false, nil
	}
	if err != nil {
		return mfaflow.Totp{}, false, err
	}
	return mfaflow.Totp{SecretEncrypted: row.SecretEncrypted, EnabledAt: row.EnabledAt}, true, nil
}

// Passkeys counts only the passkeys registered for the relying party ID the
// console answers to now: one registered for another can settle no
// challenge.
func (a mfaAccount) Passkeys(ctx context.Context, q dbmodels.Querier) (int64, error) {
	rpID, err := tenantwebauthn.AdminConsoleRPID(a.actor.Tenant)
	if err != nil {
		return 0, err
	}
	return q.CountUserWebauthnCredentialsForRPID(ctx, dbmodels.CountUserWebauthnCredentialsForRPIDParams{
		UserID:       a.actor.User.ID,
		RelyingParty: tenantwebauthn.KindAdminConsole,
		RpID:         rpID,
	})
}

func (a mfaAccount) StoreTotpSecret(ctx context.Context, q dbmodels.Querier, encrypted string) error {
	_, err := q.UpsertUserMfaTotpSecret(ctx, dbmodels.UpsertUserMfaTotpSecretParams{
		UserID:          a.actor.User.ID,
		TenantID:        a.actor.Tenant.ID,
		SecretEncrypted: encrypted,
	})
	return err
}

func (a mfaAccount) ClaimTotpStep(ctx context.Context, q dbmodels.Querier, step int64) (bool, error) {
	claimed, err := q.MarkUserMfaTotpVerified(ctx, dbmodels.MarkUserMfaTotpVerifiedParams{
		UserID:           a.actor.User.ID,
		LastVerifiedStep: sql.NullInt64{Int64: step, Valid: true},
	})
	return claimed > 0, err
}

func (a mfaAccount) EnableTotp(ctx context.Context, q dbmodels.Querier) (bool, error) {
	enabled, err := q.EnableUserMfaTotp(ctx, a.actor.User.ID)
	return enabled > 0, err
}

func (a mfaAccount) DeleteTotp(ctx context.Context, q dbmodels.Querier) error {
	return q.DeleteUserMfaTotpByUserID(ctx, a.actor.User.ID)
}

func (a mfaAccount) Locked(ctx context.Context, q dbmodels.Querier) (bool, error) {
	row, err := q.GetUserMfaLockout(ctx, a.actor.User.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return row.LockedUntil.Valid && row.LockedUntil.Time.After(time.Now()), nil
}

func (a mfaAccount) CountFailure(ctx context.Context, q dbmodels.Querier) (bool, error) {
	updated, err := q.RecordUserMfaFailure(ctx, dbmodels.RecordUserMfaFailureParams{
		UserID:            a.actor.User.ID,
		TenantID:          a.actor.Tenant.ID,
		MaxFailedAttempts: mfa.MaxFailedAttempts,
		LockedUntil:       time.Now().Add(mfa.LockDuration),
	})
	if err != nil {
		return false, err
	}
	return updated.LockedUntil.Valid && updated.LockedUntil.Time.After(time.Now()), nil
}

func (a mfaAccount) ResetFailures(ctx context.Context, q dbmodels.Querier) error {
	return q.ResetUserMfaFailures(ctx, a.actor.User.ID)
}

func (a mfaAccount) UnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) ([]mfaflow.RecoveryCode, error) {
	rows, err := q.ListUnusedUserMfaRecoveryCodes(ctx, a.actor.User.ID)
	if err != nil {
		return nil, err
	}
	codes := make([]mfaflow.RecoveryCode, 0, len(rows))
	for _, row := range rows {
		codes = append(codes, mfaflow.RecoveryCode{ID: row.ID, CodeHash: row.CodeHash})
	}
	return codes, nil
}

func (a mfaAccount) MarkRecoveryCodeUsed(ctx context.Context, q dbmodels.Querier, id uuid.UUID) (bool, error) {
	spent, err := q.MarkUserMfaRecoveryCodeUsed(ctx, id)
	return spent == 1, err
}

func (a mfaAccount) CountUnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) (int64, error) {
	return q.CountUnusedUserMfaRecoveryCodes(ctx, a.actor.User.ID)
}

func (a mfaAccount) DeleteRecoveryCodes(ctx context.Context, q dbmodels.Querier) error {
	return q.DeleteUserMfaRecoveryCodesByUserID(ctx, a.actor.User.ID)
}

func (a mfaAccount) CreateRecoveryCode(ctx context.Context, q dbmodels.Querier, id uuid.UUID, hash string) error {
	return q.CreateUserMfaRecoveryCode(ctx, dbmodels.CreateUserMfaRecoveryCodeParams{
		ID:       id,
		TenantID: a.actor.Tenant.ID,
		UserID:   a.actor.User.ID,
		CodeHash: hash,
	})
}

func (a mfaAccount) ReleaseRecoveryCodes(ctx context.Context, q dbmodels.Querier) error {
	return deleteRecoveryCodesWithTheLastFactor(ctx, q, a.actor.User.ID)
}

func (a mfaAccount) FromChallenge() bool {
	return a.actor.FromChallenge
}

func (a mfaAccount) ClaimChallenge(ctx context.Context, q dbmodels.Querier) (bool, error) {
	claimed, err := q.MarkUserMfaChallengeUsed(ctx, dbmodels.MarkUserMfaChallengeUsedParams{
		Jti:       a.actor.ChallengeID,
		TenantID:  a.actor.Tenant.ID,
		UserID:    a.actor.User.ID,
		ExpiresAt: a.actor.ChallengeExpiresAt,
	})
	return claimed == 1, err
}

func (a mfaAccount) CanIssueSession() bool {
	return a.s.tokens != nil
}

func (a mfaAccount) IssueSession(ctx context.Context) (*publirattypesv1.User, *publirattypesv1.AccessToken, error) {
	if a.s.tokens == nil {
		return nil, nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	actor := a.actor
	token, expiresAt, err := a.s.tokens.Issue(actor.User.PublicID, auth.AudienceAdmin, actor.Tenant.ID.String(), actor.Role, actor.User.CredentialsVersion, time.Now())
	if err != nil {
		return nil, nil, a.s.internalError(ctx, "failed to issue admin access token", err, "user_id", actor.User.ID.String())
	}
	return &publirattypesv1.User{PublicId: actor.User.PublicID, Name: actor.User.Name, Role: actor.Role},
		&publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
		nil
}

func (a mfaAccount) Encryptor() mfaflow.Encryptor {
	if a.s.encryptor == nil {
		return nil
	}
	return a.s.encryptor
}

func (a mfaAccount) OTPAuthLabel() (string, string) {
	issuer := strings.TrimSpace(a.actor.Tenant.Name)
	if issuer == "" {
		issuer = mfaOTPAuthIssuer
	}
	return issuer, a.actor.User.Email
}

func (a mfaAccount) Actions() mfaflow.Actions {
	return mfaAuditActions
}

func (a mfaAccount) Audit(ctx context.Context, action, outcome, reason string) {
	a.s.recordMfaAudit(ctx, a.actor, action, outcome, reason)
}

func (a mfaAccount) LogVerification(ctx context.Context, outcome, reason string) {
	auth.AuditEvent(ctx, "admin_mfa_verify", outcome, a.actor.Tenant.PublicID, a.actor.User.PublicID, reason)
}

func (a mfaAccount) InternalError(ctx context.Context, msg string, err error) error {
	return a.s.internalError(ctx, msg, err, "user_id", a.actor.User.ID.String())
}

// mfaRequiredForRole reports whether the platform policy makes the second
// factor a condition of signing in for the given tenant role. Only
// tenant_admin is covered: editors and auditors may enroll, and are never held
// back for it.
func (s *adminServer) mfaRequiredForRole(ctx context.Context, role string) (bool, error) {
	if role != auth.RoleTenantAdmin {
		return false, nil
	}
	policy, err := s.policy.Policy(ctx)
	if err != nil {
		return false, s.internalError(ctx, "failed to resolve the platform policy", err)
	}
	return policy.MFARequiredForTenantAdmin, nil
}

// mfaMethods lists the factors an account holds in the order the console
// offers them.
func mfaMethods(f mfaflow.Factors) []publiraadminv1.MfaMethod {
	var methods []publiraadminv1.MfaMethod
	if f.TotpEnabled() {
		methods = append(methods, publiraadminv1.MfaMethod_MFA_METHOD_TOTP)
	}
	if f.Passkeys > 0 {
		methods = append(methods, publiraadminv1.MfaMethod_MFA_METHOD_PASSKEY)
	}
	return methods
}

// adminRPID is the relying party ID the tenant's console passkeys are bound
// to.
func (s *adminServer) adminRPID(ctx context.Context, tenant dbmodels.Tenant) (string, error) {
	rpID, err := tenantwebauthn.AdminConsoleRPID(tenant)
	if err != nil {
		return "", s.internalError(ctx, "failed to derive the console's relying party id", err, "tenant_id", tenant.ID.String())
	}
	return rpID, nil
}

// mfaChallengeKindFor decides what a correct password still leaves owed. An
// enrollment is owed only where the deployment requires the factor of the
// account's role.
func (s *adminServer) mfaChallengeKindFor(
	ctx context.Context,
	tenant dbmodels.Tenant,
	user dbmodels.User,
	role string,
) (publiraadminv1.MfaChallengeKind, []publiraadminv1.MfaMethod, error) {
	acct := s.mfaAccount(mfaActor{Tenant: tenant, User: user, Role: role})
	owed, factors, err := mfaflow.OwedAfterPassword(ctx, acct, func(ctx context.Context) (bool, error) {
		return s.mfaRequiredForRole(ctx, role)
	})
	if err != nil {
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, nil, err
	}
	switch owed {
	case mfaflow.OwedVerification:
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY, mfaMethods(factors), nil
	case mfaflow.OwedEnrollment:
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL, nil, nil
	default:
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, nil, nil
	}
}

// mfaChallengeFor mints the half-finished session a correct password earns.
func (s *adminServer) mfaChallengeFor(
	tenant dbmodels.Tenant,
	user dbmodels.User,
	kind publiraadminv1.MfaChallengeKind,
	methods []publiraadminv1.MfaMethod,
) (*publiraadminv1.AdminAuthServiceMfaChallenge, error) {
	audience := auth.AudienceAdminMFAVerify
	if kind == publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		audience = auth.AudienceAdminMFAEnroll
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	token, expiresAt, err := s.tokens.IssueMFAChallengeToken(user.PublicID, audience, tenant.ID.String(), user.CredentialsVersion, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	return &publiraadminv1.AdminAuthServiceMfaChallenge{
		Token:     token,
		ExpiresAt: auth.FormatExpiresAt(expiresAt),
		Kind:      kind,
		Methods:   methods,
	}, nil
}

// actorFromChallenge resolves the account a challenge token names. It repeats
// every check a session does apart from the audience: the token has to name
// this tenant, and the account still has to be active, hold a tenant role,
// and hold the credentials version the token was signed with.
func (s *adminServer) actorFromChallenge(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	challengeToken string,
	audience string,
) (mfaActor, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return mfaActor{}, err
	}
	challenge, ok := mfaflow.ParseChallenge(s.tokens, challengeToken, audience)
	if !ok || challenge.TenantID != tenant.ID.String() {
		return mfaActor{}, invalidSessionError()
	}
	userRef, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: challenge.Subject,
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return mfaActor{}, invalidSessionError()
		}
		return mfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge user by public id", err, "tenant_id", tenant.ID.String())
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userRef.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return mfaActor{}, invalidSessionError()
		}
		return mfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge user", err, "tenant_id", tenant.ID.String(), "user_id", userRef.ID.String())
	}
	if user.Status != "active" || user.CredentialsVersion != challenge.CredentialsVersion {
		return mfaActor{}, invalidSessionError()
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return mfaActor{}, err
	}
	if role == "" {
		return mfaActor{}, invalidSessionError()
	}
	return mfaActor{
		Tenant:             tenant,
		User:               user,
		Role:               role,
		FromChallenge:      true,
		ChallengeID:        challenge.ID,
		ChallengeExpiresAt: challenge.ExpiresAt,
	}, nil
}

// mfaActorFor identifies the account an enrollment RPC is for. A signed-in
// account enrolling voluntarily is identified by its session; one that login
// stopped at an enroll challenge has no session yet and sends the challenge
// token instead.
func (s *adminServer) mfaActorFor(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers *connect.Header,
	challengeToken string,
) (mfaActor, error) {
	if strings.TrimSpace(challengeToken) != "" {
		actor, err := s.actorFromChallenge(ctx, tenantCtx, challengeToken, auth.AudienceAdminMFAEnroll)
		if err != nil {
			return mfaActor{}, err
		}
		// An enroll challenge was minted for an account with no second
		// factor. Once the account has one, through this challenge or another
		// login's, the challenge no longer stands for what it was issued for:
		// honouring it would let whoever holds it enroll a factor of their own
		// and sign in past the one the owner set up.
		acct := s.mfaAccount(actor)
		factors, err := mfaflow.FactorsOf(ctx, acct, acct.Queries(ctx))
		if err != nil {
			return mfaActor{}, err
		}
		if factors.Any() {
			return mfaActor{}, invalidSessionError()
		}
		return actor, nil
	}
	return s.mfaActorFromSession(ctx, tenantCtx)
}

// mfaActorFromSession identifies a signed-in account acting on its own
// second factor.
func (s *adminServer) mfaActorFromSession(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (mfaActor, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, tenantCtx, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return mfaActor{}, err
	}
	return mfaActor{Tenant: tenant, User: user, Role: role}, nil
}

func (s *adminServer) recordMfaAudit(ctx context.Context, actor mfaActor, action, outcome, reason string) {
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    actor.Tenant.ID,
		ActorUserID: actor.User.ID,
		ActorRole:   actor.Role,
		Action:      action,
		TargetType:  "user",
		TargetID:    actor.User.PublicID,
		Outcome:     outcome,
		Reason:      reason,
		ClientIP:    clientip.FromContext(ctx),
	})
}

// lockMfaFactors serialises the transaction behind q with every other change
// to the account's second factors and recovery codes. Anything the
// transaction decides from what else the account holds has to be read after
// it.
func (s *adminServer) lockMfaFactors(ctx context.Context, q Querier, userID uuid.UUID) error {
	if err := q.LockUserMfaFactors(ctx, userID); err != nil {
		return s.internalDBError(ctx, "failed to lock mfa factors", err, "user_id", userID.String())
	}
	return nil
}

func (s *adminServer) GetMfaStatus(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceGetMfaStatusRequest,
) (*publiraadminv1.AdminAuthServiceGetMfaStatusResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	status, err := mfaflow.GetStatus(ctx, s.mfaAccount(actor))
	if err != nil {
		return nil, err
	}
	required, err := s.mfaRequiredForRole(ctx, actor.Role)
	if err != nil {
		return nil, err
	}
	resp := &publiraadminv1.AdminAuthServiceGetMfaStatusResponse{
		Required:               required,
		Methods:                mfaMethods(status.Factors),
		RemainingRecoveryCodes: status.RemainingRecoveryCodes,
	}
	if status.Factors.TotpEnabled() {
		resp.Enabled = true
		resp.EnabledAt = auth.FormatExpiresAt(status.Factors.Totp.EnabledAt.Time)
	}
	return resp, nil
}

func (s *adminServer) StartMfaEnrollment(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest,
) (*publiraadminv1.AdminAuthServiceStartMfaEnrollmentResponse, error) {
	actor, err := s.mfaActorFor(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx), req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	enrollment, err := mfaflow.StartEnrollment(ctx, s.mfaAccount(actor))
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceStartMfaEnrollmentResponse{
		Secret:     enrollment.Secret,
		OtpauthUri: enrollment.OTPAuthURI,
	}, nil
}

func (s *adminServer) ConfirmMfaEnrollment(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest,
) (*publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentResponse, error) {
	actor, err := s.mfaActorFor(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx), req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	confirmation, err := mfaflow.ConfirmEnrollment(ctx, s.mfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentResponse{
		RecoveryCodes: confirmation.RecoveryCodes,
		User:          confirmation.User,
		AccessToken:   confirmation.AccessToken,
	}, nil
}

func (s *adminServer) VerifyMfa(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceVerifyMfaRequest,
) (*publiraadminv1.AdminAuthServiceVerifyMfaResponse, error) {
	actor, err := s.actorFromChallenge(ctx, req.Tenant, req.ChallengeToken, auth.AudienceAdminMFAVerify)
	if err != nil {
		auth.AuditEvent(ctx, "admin_mfa_verify", "failure", "", "", "invalid_challenge")
		return nil, err
	}
	// An account that holds passkeys and no authenticator answers here with a
	// recovery code alone; its passkeys answer FinishPasskeyVerification.
	verification, err := mfaflow.Verify(ctx, s.mfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceVerifyMfaResponse{
		User:                   verification.User,
		AccessToken:            verification.AccessToken,
		RecoveryCodeUsed:       verification.RecoveryCodeUsed,
		RemainingRecoveryCodes: verification.RemainingRecoveryCodes,
	}, nil
}

func (s *adminServer) DisableMfa(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceDisableMfaRequest,
) (*publiraadminv1.AdminAuthServiceDisableMfaResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if err := mfaflow.Disable(ctx, s.mfaAccount(actor), req.Code); err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceDisableMfaResponse{Disabled: true}, nil
}

func (s *adminServer) RegenerateMfaRecoveryCodes(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest,
) (*publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	acct := s.mfaAccount(actor)
	if strings.TrimSpace(req.PasskeyCredentialJson) == "" {
		codes, err := mfaflow.RegenerateRecoveryCodes(ctx, acct, req.Code)
		if err != nil {
			return nil, err
		}
		return &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}, nil
	}
	if strings.TrimSpace(req.Code) != "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "send either code or passkey_credential_json, not both")
	}

	factors, err := mfaflow.FactorsOf(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return nil, err
	}
	if factors.Passkeys == 0 {
		return nil, passkeyNotRegisteredError()
	}
	used, reason, err := s.checkPasskeyAssertion(ctx, actor, req.PasskeyCredentialJson)
	if err != nil {
		s.recordMfaAudit(ctx, actor, mfaAuditActions.RecoveryCodesRegenerated, auditlog.OutcomeFailure, reason)
		return nil, err
	}
	codes, err := mfaflow.RegenerateRecoveryCodesFor(ctx, acct, mfaflow.FactorPasskey, func(q dbmodels.Querier) error {
		_, err := q.GetUserWebauthnCredentialByPublicID(ctx, dbmodels.GetUserWebauthnCredentialByPublicIDParams{
			UserID:       actor.User.ID,
			RelyingParty: used.RelyingParty,
			RpID:         used.RpID,
			PublicID:     used.PublicID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return passkeyNotRegisteredError()
		}
		if err != nil {
			return s.internalDBError(ctx, "failed to get passkey", err, "user_id", actor.User.ID.String())
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}, nil
}
