package platformapi

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
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// The actions an operator's second factor writes to platform_audit_logs.
var operatorMfaAuditActions = mfaflow.Actions{
	Enrolled:                 "operator_mfa_enrolled",
	Verified:                 "operator_mfa_verified",
	RecoveryCodeUsed:         "operator_mfa_recovery_code_used",
	Disabled:                 "operator_mfa_disabled",
	RecoveryCodesRegenerated: "operator_mfa_recovery_codes_regenerated",
}

// operatorOTPAuthIssuer is what an authenticator app lists an operator's entry
// under. It names the console rather than the install, which has no name of
// its own, so the entry stays apart from the tenant consoles' ones.
const operatorOTPAuthIssuer = "Publira Platform Console"

// operatorMfaActor is the operator an MFA RPC acts for, together with how it
// proved who it is. FromChallenge marks the token a password alone earned,
// which is the only case where finishing an enrollment also finishes the
// sign-in. ChallengeID and ChallengeExpiresAt name that token, so an exchange
// can record it as spent; both are zero for an actor identified by a session.
type operatorMfaActor struct {
	User               dbmodels.PlatformUser
	Role               string
	FromChallenge      bool
	ChallengeID        uuid.UUID
	ChallengeExpiresAt time.Time
}

// operatorMfaAccount is an operator's second factor, as mfaflow reaches it:
// over platform_users and their platform_user_mfa_* rows, with failures
// counted on the authenticator's own row, and audit entries in
// platform_audit_logs. An operator holds no passkeys.
type operatorMfaAccount struct {
	s     *platformServer
	actor operatorMfaActor
}

func (s *platformServer) operatorMfaAccount(actor operatorMfaActor) operatorMfaAccount {
	return operatorMfaAccount{s: s, actor: actor}
}

var _ mfaflow.Account = operatorMfaAccount{}

func (a operatorMfaAccount) Queries(ctx context.Context) dbmodels.Querier {
	return a.s.queriesFor(ctx)
}

func (a operatorMfaAccount) InTx(ctx context.Context, fn func(q dbmodels.Querier) error) error {
	userID := a.actor.User.ID
	tx, err := a.s.db.BeginTx(ctx, nil)
	if err != nil {
		return a.s.internalDBError(ctx, "failed to begin operator mfa transaction", err, "platform_user_id", userID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := q.LockPlatformUserMfaFactors(ctx, userID); err != nil {
		return a.s.internalDBError(ctx, "failed to lock operator mfa factors", err, "platform_user_id", userID.String())
	}
	if err := fn(q); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return a.s.internalDBError(ctx, "failed to commit operator mfa transaction", err, "platform_user_id", userID.String())
	}
	return nil
}

func (a operatorMfaAccount) totpRow(ctx context.Context, q dbmodels.Querier) (dbmodels.PlatformUserMfaTotp, bool, error) {
	row, err := q.GetPlatformUserMfaTotp(ctx, a.actor.User.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformUserMfaTotp{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformUserMfaTotp{}, false, err
	}
	return row, true, nil
}

func (a operatorMfaAccount) Totp(ctx context.Context, q dbmodels.Querier) (mfaflow.Totp, bool, error) {
	row, found, err := a.totpRow(ctx, q)
	if err != nil || !found {
		return mfaflow.Totp{}, false, err
	}
	return mfaflow.Totp{SecretEncrypted: row.SecretEncrypted, EnabledAt: row.EnabledAt}, true, nil
}

func (a operatorMfaAccount) Passkeys(context.Context, dbmodels.Querier) (int64, error) {
	return 0, nil
}

func (a operatorMfaAccount) StoreTotpSecret(ctx context.Context, q dbmodels.Querier, encrypted string) error {
	_, err := q.UpsertPlatformUserMfaTotpSecret(ctx, dbmodels.UpsertPlatformUserMfaTotpSecretParams{
		PlatformUserID:  a.actor.User.ID,
		SecretEncrypted: encrypted,
	})
	return err
}

func (a operatorMfaAccount) ClaimTotpStep(ctx context.Context, q dbmodels.Querier, step int64) (bool, error) {
	claimed, err := q.MarkPlatformUserMfaTotpVerified(ctx, dbmodels.MarkPlatformUserMfaTotpVerifiedParams{
		PlatformUserID:   a.actor.User.ID,
		LastVerifiedStep: sql.NullInt64{Int64: step, Valid: true},
	})
	return claimed > 0, err
}

func (a operatorMfaAccount) EnableTotp(ctx context.Context, q dbmodels.Querier) (bool, error) {
	enabled, err := q.EnablePlatformUserMfaTotp(ctx, a.actor.User.ID)
	return enabled > 0, err
}

func (a operatorMfaAccount) DeleteTotp(ctx context.Context, q dbmodels.Querier) error {
	return q.DeletePlatformUserMfaTotp(ctx, a.actor.User.ID)
}

// Locked reads the lock off the authenticator's row, which is where an
// operator's failures are counted. An operator without one has nothing to
// lock.
func (a operatorMfaAccount) Locked(ctx context.Context, q dbmodels.Querier) (bool, error) {
	row, found, err := a.totpRow(ctx, q)
	if err != nil || !found {
		return false, err
	}
	return row.LockedUntil.Valid && row.LockedUntil.Time.After(time.Now()), nil
}

func (a operatorMfaAccount) CountFailure(ctx context.Context, q dbmodels.Querier) (bool, error) {
	updated, err := q.RecordPlatformUserMfaTotpFailure(ctx, dbmodels.RecordPlatformUserMfaTotpFailureParams{
		PlatformUserID:    a.actor.User.ID,
		MaxFailedAttempts: mfa.MaxFailedAttempts,
		LockedUntil:       time.Now().Add(mfa.LockDuration),
	})
	if err != nil {
		return false, err
	}
	return updated.LockedUntil.Valid && updated.LockedUntil.Time.After(time.Now()), nil
}

func (a operatorMfaAccount) ResetFailures(ctx context.Context, q dbmodels.Querier) error {
	return q.ResetPlatformUserMfaTotpFailures(ctx, a.actor.User.ID)
}

func (a operatorMfaAccount) UnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) ([]mfaflow.RecoveryCode, error) {
	rows, err := q.ListUnusedPlatformUserMfaRecoveryCodes(ctx, a.actor.User.ID)
	if err != nil {
		return nil, err
	}
	codes := make([]mfaflow.RecoveryCode, 0, len(rows))
	for _, row := range rows {
		codes = append(codes, mfaflow.RecoveryCode{ID: row.ID, CodeHash: row.CodeHash})
	}
	return codes, nil
}

func (a operatorMfaAccount) MarkRecoveryCodeUsed(ctx context.Context, q dbmodels.Querier, id uuid.UUID) (bool, error) {
	spent, err := q.MarkPlatformUserMfaRecoveryCodeUsed(ctx, id)
	return spent == 1, err
}

func (a operatorMfaAccount) CountUnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) (int64, error) {
	return q.CountUnusedPlatformUserMfaRecoveryCodes(ctx, a.actor.User.ID)
}

func (a operatorMfaAccount) DeleteRecoveryCodes(ctx context.Context, q dbmodels.Querier) error {
	return q.DeletePlatformUserMfaRecoveryCodes(ctx, a.actor.User.ID)
}

func (a operatorMfaAccount) CreateRecoveryCode(ctx context.Context, q dbmodels.Querier, id uuid.UUID, hash string) error {
	return q.CreatePlatformUserMfaRecoveryCode(ctx, dbmodels.CreatePlatformUserMfaRecoveryCodeParams{
		ID:             id,
		PlatformUserID: a.actor.User.ID,
		CodeHash:       hash,
	})
}

// ReleaseRecoveryCodes deletes the codes outright: the authenticator is the
// only factor an operator holds, so its removal leaves them nothing to stand
// in for.
func (a operatorMfaAccount) ReleaseRecoveryCodes(ctx context.Context, q dbmodels.Querier) error {
	return a.DeleteRecoveryCodes(ctx, q)
}

func (a operatorMfaAccount) FromChallenge() bool {
	return a.actor.FromChallenge
}

func (a operatorMfaAccount) ClaimChallenge(ctx context.Context, q dbmodels.Querier) (bool, error) {
	claimed, err := q.MarkPlatformUserMfaChallengeUsed(ctx, dbmodels.MarkPlatformUserMfaChallengeUsedParams{
		Jti:            a.actor.ChallengeID,
		PlatformUserID: a.actor.User.ID,
		ExpiresAt:      a.actor.ChallengeExpiresAt,
	})
	return claimed == 1, err
}

func (a operatorMfaAccount) CanIssueSession() bool {
	return a.s.tokens != nil
}

func (a operatorMfaAccount) IssueSession(ctx context.Context) (*publirattypesv1.User, *publirattypesv1.AccessToken, error) {
	if a.s.tokens == nil {
		return nil, nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	actor := a.actor
	token, expiresAt, err := a.s.tokens.Issue(actor.User.PublicID, auth.AudiencePlatform, "", actor.Role, actor.User.CredentialsVersion, time.Now())
	if err != nil {
		return nil, nil, a.s.internalError(ctx, "failed to issue platform access token", err, "platform_user_id", actor.User.ID.String())
	}
	return &publirattypesv1.User{PublicId: actor.User.PublicID, Name: actor.User.Name, Role: actor.Role},
		&publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
		nil
}

func (a operatorMfaAccount) Encryptor() mfaflow.Encryptor {
	if a.s.encryptor == nil {
		return nil
	}
	return a.s.encryptor
}

func (a operatorMfaAccount) OTPAuthLabel() (string, string) {
	return operatorOTPAuthIssuer, a.actor.User.Email
}

func (a operatorMfaAccount) Actions() mfaflow.Actions {
	return operatorMfaAuditActions
}

func (a operatorMfaAccount) Audit(ctx context.Context, action, outcome, reason string) {
	a.s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: a.actor.User.ID,
		ActorRole:           a.actor.Role,
		Action:              action,
		TargetType:          "operator",
		TargetID:            a.actor.User.ID.String(),
		Outcome:             outcome,
		Reason:              reason,
		ClientIP:            clientip.FromContext(ctx),
	})
}

func (a operatorMfaAccount) LogVerification(ctx context.Context, outcome, reason string) {
	auth.AuditEvent(ctx, "platform_mfa_verify", outcome, "", a.actor.User.PublicID, reason)
}

func (a operatorMfaAccount) InternalError(ctx context.Context, msg string, err error) error {
	return a.s.internalError(ctx, msg, err, "platform_user_id", a.actor.User.ID.String())
}

// operatorMfaRequired reports whether the platform policy makes the second
// factor a condition of signing in to the platform console. It covers every
// operator role alike: an auditor reads every tenant's data too.
//
// The policy is read rather than resolved through a cached resolver, so an
// operator who has just switched the requirement on is held to it at the very
// next sign-in.
func (s *platformServer) operatorMfaRequired(ctx context.Context) (bool, error) {
	policy, _, err := platformpolicy.Read(ctx, s.queriesFor(ctx))
	if err != nil {
		return false, s.internalDBError(ctx, "failed to read the platform policy", err)
	}
	return policy.MFARequiredForPlatformOperator, nil
}

// operatorMfaChallengeKindFor decides what a correct password still leaves
// owed. An enrollment is owed only while the platform policy requires the
// factor.
func (s *platformServer) operatorMfaChallengeKindFor(
	ctx context.Context,
	user dbmodels.PlatformUser,
) (publirasplatformv1.MfaChallengeKind, error) {
	owed, _, err := mfaflow.OwedAfterPassword(ctx, s.operatorMfaAccount(operatorMfaActor{User: user}), s.operatorMfaRequired)
	if err != nil {
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, err
	}
	switch owed {
	case mfaflow.OwedVerification:
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY, nil
	case mfaflow.OwedEnrollment:
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL, nil
	default:
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, nil
	}
}

// operatorMfaChallengeFor mints the half-finished session a correct password
// earns.
func (s *platformServer) operatorMfaChallengeFor(
	user dbmodels.PlatformUser,
	kind publirasplatformv1.MfaChallengeKind,
) (*publirasplatformv1.PlatformAuthServiceMfaChallenge, error) {
	audience := auth.AudiencePlatformMFAVerify
	if kind == publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		audience = auth.AudiencePlatformMFAEnroll
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	token, expiresAt, err := s.tokens.IssueMFAChallengeToken(user.PublicID, audience, "", user.CredentialsVersion, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	return &publirasplatformv1.PlatformAuthServiceMfaChallenge{
		Token:     token,
		ExpiresAt: auth.FormatExpiresAt(expiresAt),
		Kind:      kind,
	}, nil
}

// operatorFromChallenge resolves the operator a challenge token names. It
// repeats every check a session does apart from the audience: the operator
// still has to be active, hold a platform role, and hold the credentials
// version the token was signed with, so a suspension, a lost role, or a
// password change ends a pending challenge.
func (s *platformServer) operatorFromChallenge(
	ctx context.Context,
	challengeToken string,
	audience string,
) (operatorMfaActor, error) {
	challenge, ok := mfaflow.ParseChallenge(s.tokens, challengeToken, audience)
	if !ok {
		return operatorMfaActor{}, invalidSessionError()
	}
	user, err := s.queriesFor(ctx).GetPlatformUserByPublicID(ctx, challenge.Subject)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return operatorMfaActor{}, invalidSessionError()
		}
		return operatorMfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge operator", err)
	}
	if user.Status != "active" || user.CredentialsVersion != challenge.CredentialsVersion {
		return operatorMfaActor{}, invalidSessionError()
	}
	roles, err := s.platformRoles(ctx, user.ID)
	if err != nil {
		return operatorMfaActor{}, err
	}
	role := auth.ResolvePlatformRole(roles)
	if !auth.IsPlatformRole(role) {
		return operatorMfaActor{}, invalidSessionError()
	}
	return operatorMfaActor{
		User:               user,
		Role:               role,
		FromChallenge:      true,
		ChallengeID:        challenge.ID,
		ChallengeExpiresAt: challenge.ExpiresAt,
	}, nil
}

// operatorFromSession identifies a signed-in operator acting on its own
// account.
func (s *platformServer) operatorFromSession(ctx context.Context) (operatorMfaActor, error) {
	_, user, role, err := s.authenticatePlatformSession(ctx, "", rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return operatorMfaActor{}, err
	}
	return operatorMfaActor{User: user, Role: role}, nil
}

// operatorMfaActorFor identifies the operator an enrollment RPC is for. A
// signed-in operator enrolling voluntarily is identified by its session; one
// that sign-in stopped at an enroll challenge has no session yet and sends
// the challenge token instead.
func (s *platformServer) operatorMfaActorFor(ctx context.Context, challengeToken string) (operatorMfaActor, error) {
	if strings.TrimSpace(challengeToken) != "" {
		return s.operatorFromChallenge(ctx, challengeToken, auth.AudiencePlatformMFAEnroll)
	}
	return s.operatorFromSession(ctx)
}

func (s *platformServer) GetMfaStatus(
	ctx context.Context,
	_ *publirasplatformv1.PlatformAuthServiceGetMfaStatusRequest,
) (*publirasplatformv1.PlatformAuthServiceGetMfaStatusResponse, error) {
	actor, err := s.operatorFromSession(ctx)
	if err != nil {
		return nil, err
	}
	status, err := mfaflow.GetStatus(ctx, s.operatorMfaAccount(actor))
	if err != nil {
		return nil, err
	}
	required, err := s.operatorMfaRequired(ctx)
	if err != nil {
		return nil, err
	}
	resp := &publirasplatformv1.PlatformAuthServiceGetMfaStatusResponse{
		Required:               required,
		RemainingRecoveryCodes: status.RemainingRecoveryCodes,
	}
	if status.Factors.TotpEnabled() {
		resp.Enabled = true
		resp.EnabledAt = auth.FormatExpiresAt(status.Factors.Totp.EnabledAt.Time)
	}
	return resp, nil
}

func (s *platformServer) StartMfaEnrollment(
	ctx context.Context,
	req *publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest,
) (*publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentResponse, error) {
	actor, err := s.operatorMfaActorFor(ctx, req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	enrollment, err := mfaflow.StartEnrollment(ctx, s.operatorMfaAccount(actor))
	if err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentResponse{
		Secret:     enrollment.Secret,
		OtpauthUri: enrollment.OTPAuthURI,
	}, nil
}

func (s *platformServer) ConfirmMfaEnrollment(
	ctx context.Context,
	req *publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest,
) (*publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentResponse, error) {
	actor, err := s.operatorMfaActorFor(ctx, req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	confirmation, err := mfaflow.ConfirmEnrollment(ctx, s.operatorMfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentResponse{
		RecoveryCodes: confirmation.RecoveryCodes,
		User:          confirmation.User,
		AccessToken:   confirmation.AccessToken,
	}, nil
}

func (s *platformServer) VerifyMfa(
	ctx context.Context,
	req *publirasplatformv1.PlatformAuthServiceVerifyMfaRequest,
) (*publirasplatformv1.PlatformAuthServiceVerifyMfaResponse, error) {
	actor, err := s.operatorFromChallenge(ctx, req.ChallengeToken, auth.AudiencePlatformMFAVerify)
	if err != nil {
		auth.AuditEvent(ctx, "platform_mfa_verify", "failure", "", "", "invalid_challenge")
		return nil, err
	}
	verification, err := mfaflow.Verify(ctx, s.operatorMfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformAuthServiceVerifyMfaResponse{
		User:                   verification.User,
		AccessToken:            verification.AccessToken,
		RecoveryCodeUsed:       verification.RecoveryCodeUsed,
		RemainingRecoveryCodes: verification.RemainingRecoveryCodes,
	}, nil
}

func (s *platformServer) DisableMfa(
	ctx context.Context,
	req *publirasplatformv1.PlatformAuthServiceDisableMfaRequest,
) (*publirasplatformv1.PlatformAuthServiceDisableMfaResponse, error) {
	actor, err := s.operatorFromSession(ctx)
	if err != nil {
		return nil, err
	}
	if err := mfaflow.Disable(ctx, s.operatorMfaAccount(actor), req.Code); err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformAuthServiceDisableMfaResponse{Disabled: true}, nil
}

func (s *platformServer) RegenerateMfaRecoveryCodes(
	ctx context.Context,
	req *publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest,
) (*publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesResponse, error) {
	actor, err := s.operatorFromSession(ctx)
	if err != nil {
		return nil, err
	}
	codes, err := mfaflow.RegenerateRecoveryCodes(ctx, s.operatorMfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	return &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}, nil
}
