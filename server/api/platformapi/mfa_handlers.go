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
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// The actions an operator's second factor writes to platform_audit_logs. A
// wrong code is the same action as a right one with outcome failure, which is
// how the rest of the log distinguishes the two.
const (
	auditActionOperatorMfaEnrolled                 = "operator_mfa_enrolled"
	auditActionOperatorMfaVerified                 = "operator_mfa_verified"
	auditActionOperatorMfaRecoveryCodeUsed         = "operator_mfa_recovery_code_used"
	auditActionOperatorMfaDisabled                 = "operator_mfa_disabled"
	auditActionOperatorMfaRecoveryCodesRegenerated = "operator_mfa_recovery_codes_regenerated"
)

// operatorOTPAuthIssuer is what an authenticator app lists an operator's entry
// under. It names the console rather than the install, which has no name of
// its own, so the entry stays apart from the tenant consoles' ones.
const operatorOTPAuthIssuer = "Publira Platform Console"

func mfaCodeRequiredError() error {
	return connect.NewError(connect.CodeInvalidArgument, "code is required")
}

// A refused code and a rejected session both answer `unauthenticated`, and a
// console that cannot tell them apart would sign an operator out over a typo.
// The reason is what separates the two.
func mfaInvalidCodeError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeUnauthenticated, errors.New("invalid code"), rpcerrors.ReasonMfaInvalidCode)
}

func mfaLockedError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeResourceExhausted, errors.New("too many failed attempts"), rpcerrors.ReasonMfaLocked)
}

func mfaNotEnabledError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "mfa is not enabled")
}

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
// owed. An operator with a confirmed authenticator owes a code; one without
// owes an enrollment only while the platform policy requires the factor.
// Anything else is a sign-in that finishes on the password alone.
func (s *platformServer) operatorMfaChallengeKindFor(
	ctx context.Context,
	user dbmodels.PlatformUser,
) (publirasplatformv1.MfaChallengeKind, error) {
	row, found, err := s.operatorMfaTotpRow(ctx, user.ID)
	if err != nil {
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, err
	}
	if found && row.EnabledAt.Valid {
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY, nil
	}
	required, err := s.operatorMfaRequired(ctx)
	if err != nil {
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, err
	}
	if required {
		return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL, nil
	}
	return publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, nil
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
//
// A challenge without a usable `jti` or expiry is refused outright: those are
// what a single exchange is recorded under, and a token that cannot be
// recorded cannot be limited to one.
func (s *platformServer) operatorFromChallenge(
	ctx context.Context,
	challengeToken string,
	audience string,
) (operatorMfaActor, error) {
	if s.tokens == nil {
		return operatorMfaActor{}, invalidSessionError()
	}
	claims, err := s.tokens.Verify(strings.TrimSpace(challengeToken), audience)
	if err != nil {
		return operatorMfaActor{}, invalidSessionError()
	}
	challengeID, err := uuid.Parse(strings.TrimSpace(claims.ID))
	if err != nil {
		return operatorMfaActor{}, invalidSessionError()
	}
	if claims.ExpiresAt == nil {
		return operatorMfaActor{}, invalidSessionError()
	}
	user, err := s.queriesFor(ctx).GetPlatformUserByPublicID(ctx, claims.Subject)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return operatorMfaActor{}, invalidSessionError()
		}
		return operatorMfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge operator", err)
	}
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
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
		ChallengeID:        challengeID,
		ChallengeExpiresAt: claims.ExpiresAt.Time,
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

func (s *platformServer) recordOperatorMfaAudit(ctx context.Context, actor operatorMfaActor, action, outcome, reason string) {
	s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
		ActorPlatformUserID: actor.User.ID,
		ActorRole:           actor.Role,
		Action:              action,
		TargetType:          "operator",
		TargetID:            actor.User.ID.String(),
		Outcome:             outcome,
		Reason:              reason,
		ClientIP:            clientip.FromContext(ctx),
	})
}

// operatorMfaTotpRow reads the operator's TOTP state. A missing row and an
// unconfirmed one are the same answer to "does this operator have a second
// factor".
func (s *platformServer) operatorMfaTotpRow(ctx context.Context, userID uuid.UUID) (dbmodels.PlatformUserMfaTotp, bool, error) {
	row, err := s.queriesFor(ctx).GetPlatformUserMfaTotp(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformUserMfaTotp{}, false, nil
		}
		return dbmodels.PlatformUserMfaTotp{}, false, s.internalDBError(ctx, "failed to get operator mfa totp", err, "platform_user_id", userID.String())
	}
	return row, true, nil
}

// mfaCodeOutcome says what a presented code turned out to be, so the caller
// can write the right audit entry without repeating the checks.
type mfaCodeOutcome struct {
	RecoveryUsed bool
	// Reason names why a code was refused, for the audit trail. It is empty
	// when the code was accepted.
	Reason string
}

// checkOperatorMfaCode decides whether code unlocks the operator behind row,
// spending a recovery code if allowRecovery and the code is one. It owns the
// failure counter and the lock: a refusal here has already been recorded, and
// the error it returns is the one to hand the client.
func (s *platformServer) checkOperatorMfaCode(
	ctx context.Context,
	row dbmodels.PlatformUserMfaTotp,
	code string,
	allowRecovery bool,
) (mfaCodeOutcome, error) {
	now := time.Now()
	if row.LockedUntil.Valid && row.LockedUntil.Time.After(now) {
		return mfaCodeOutcome{Reason: "locked"}, mfaLockedError()
	}
	if strings.TrimSpace(code) == "" {
		return mfaCodeOutcome{Reason: "code_missing"}, mfaCodeRequiredError()
	}
	if s.encryptor == nil {
		return mfaCodeOutcome{Reason: "secret_manager_unavailable"}, connect.NewError(connect.CodeFailedPrecondition, "secret manager is not configured")
	}
	secret, err := s.encryptor.DecryptString(row.SecretEncrypted)
	if err != nil {
		return mfaCodeOutcome{Reason: "secret_undecryptable"}, s.internalError(ctx, "failed to decrypt operator mfa totp secret", err, "platform_user_id", row.PlatformUserID.String())
	}

	if step, ok := mfa.ValidateCode(secret, code, now); ok {
		// The window spans more than one period, so a code observed over a
		// shoulder is still current for a while after it was spent. The claim
		// on the step is the UPDATE itself rather than a comparison against
		// the row read above: two requests carrying the same code both read
		// the old step, and only the one whose write lands first may have it.
		claimed, err := s.queriesFor(ctx).MarkPlatformUserMfaTotpVerified(ctx, dbmodels.MarkPlatformUserMfaTotpVerifiedParams{
			PlatformUserID:   row.PlatformUserID,
			LastVerifiedStep: sql.NullInt64{Int64: step, Valid: true},
		})
		if err != nil {
			return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to mark operator mfa totp verified", err, "platform_user_id", row.PlatformUserID.String())
		}
		if claimed == 0 {
			return s.recordOperatorMfaFailure(ctx, row, "code_reused")
		}
		return mfaCodeOutcome{}, nil
	}

	if allowRecovery {
		used, err := s.spendOperatorRecoveryCode(ctx, row.PlatformUserID, code)
		if err != nil {
			return mfaCodeOutcome{}, err
		}
		if used {
			if err := s.queriesFor(ctx).ResetPlatformUserMfaTotpFailures(ctx, row.PlatformUserID); err != nil {
				return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to reset operator mfa failures", err, "platform_user_id", row.PlatformUserID.String())
			}
			return mfaCodeOutcome{RecoveryUsed: true}, nil
		}
	}

	return s.recordOperatorMfaFailure(ctx, row, "invalid_code")
}

// recordOperatorMfaFailure counts one refused code and reports whether that
// was the one that started the lock, so the client learns it is locked out now
// rather than on its next attempt.
func (s *platformServer) recordOperatorMfaFailure(ctx context.Context, row dbmodels.PlatformUserMfaTotp, reason string) (mfaCodeOutcome, error) {
	updated, err := s.queriesFor(ctx).RecordPlatformUserMfaTotpFailure(ctx, dbmodels.RecordPlatformUserMfaTotpFailureParams{
		PlatformUserID:    row.PlatformUserID,
		MaxFailedAttempts: mfa.MaxFailedAttempts,
		LockedUntil:       time.Now().Add(mfa.LockDuration),
	})
	if err != nil {
		return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to record operator mfa failure", err, "platform_user_id", row.PlatformUserID.String())
	}
	if updated.LockedUntil.Valid && updated.LockedUntil.Time.After(time.Now()) {
		return mfaCodeOutcome{Reason: "locked"}, mfaLockedError()
	}
	return mfaCodeOutcome{Reason: reason}, mfaInvalidCodeError()
}

// spendOperatorRecoveryCode marks the one unused code that matches, if any.
// Codes are stored as bcrypt hashes, so the only way to find the match is to
// try each.
func (s *platformServer) spendOperatorRecoveryCode(ctx context.Context, userID uuid.UUID, code string) (bool, error) {
	rows, err := s.queriesFor(ctx).ListUnusedPlatformUserMfaRecoveryCodes(ctx, userID)
	if err != nil {
		return false, s.internalDBError(ctx, "failed to list operator mfa recovery codes", err, "platform_user_id", userID.String())
	}
	for _, row := range rows {
		if !mfa.VerifyRecoveryCode(code, row.CodeHash) {
			continue
		}
		affected, err := s.queriesFor(ctx).MarkPlatformUserMfaRecoveryCodeUsed(ctx, row.ID)
		if err != nil {
			return false, s.internalDBError(ctx, "failed to mark operator mfa recovery code used", err, "platform_user_id", userID.String())
		}
		// Zero rows means a concurrent request spent the same code first, so
		// this one is no longer redeemable.
		return affected == 1, nil
	}
	return false, nil
}

// replaceOperatorRecoveryCodes draws a fresh batch and puts it in place of
// whatever the operator held, used or not. The plaintext it returns is the
// only copy that will exist.
func replaceOperatorRecoveryCodes(ctx context.Context, queries dbmodels.Querier, userID uuid.UUID) ([]string, error) {
	codes, err := mfa.GenerateRecoveryCodes()
	if err != nil {
		return nil, err
	}
	if err := queries.DeletePlatformUserMfaRecoveryCodes(ctx, userID); err != nil {
		return nil, err
	}
	for _, code := range codes {
		hash, err := mfa.HashRecoveryCode(code)
		if err != nil {
			return nil, err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, err
		}
		if err := queries.CreatePlatformUserMfaRecoveryCode(ctx, dbmodels.CreatePlatformUserMfaRecoveryCodeParams{
			ID:             id,
			PlatformUserID: userID,
			CodeHash:       hash,
		}); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

func (s *platformServer) remainingOperatorRecoveryCodes(ctx context.Context, userID uuid.UUID) (int32, error) {
	count, err := s.queriesFor(ctx).CountUnusedPlatformUserMfaRecoveryCodes(ctx, userID)
	if err != nil {
		return 0, s.internalDBError(ctx, "failed to count operator mfa recovery codes", err, "platform_user_id", userID.String())
	}
	return int32(count), nil
}

func (s *platformServer) GetMfaStatus(
	ctx context.Context,
	_ *publirasplatformv1.PlatformAuthServiceGetMfaStatusRequest,
) (*publirasplatformv1.PlatformAuthServiceGetMfaStatusResponse, error) {
	actor, err := s.operatorFromSession(ctx)
	if err != nil {
		return nil, err
	}
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	required, err := s.operatorMfaRequired(ctx)
	if err != nil {
		return nil, err
	}
	resp := &publirasplatformv1.PlatformAuthServiceGetMfaStatusResponse{Required: required}
	if found && row.EnabledAt.Valid {
		remaining, err := s.remainingOperatorRecoveryCodes(ctx, actor.User.ID)
		if err != nil {
			return nil, err
		}
		resp.Enabled = true
		resp.EnabledAt = auth.FormatExpiresAt(row.EnabledAt.Time)
		resp.RemainingRecoveryCodes = remaining
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
	if s.encryptor == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "secret manager is not configured")
	}
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	// Replacing a confirmed authenticator has to go through disabling it, so
	// a stolen session cannot quietly swap the factor for one of its own.
	if found && row.EnabledAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "mfa is already enabled")
	}

	enrollment, err := mfa.GenerateEnrollment(operatorOTPAuthIssuer, actor.User.Email)
	if err != nil {
		return nil, s.internalError(ctx, "failed to generate operator mfa enrollment", err, "platform_user_id", actor.User.ID.String())
	}
	encrypted, err := s.encryptor.EncryptString(enrollment.Secret)
	if err != nil {
		return nil, s.internalError(ctx, "failed to encrypt operator mfa totp secret", err, "platform_user_id", actor.User.ID.String())
	}
	if _, err := s.queriesFor(ctx).UpsertPlatformUserMfaTotpSecret(ctx, dbmodels.UpsertPlatformUserMfaTotpSecretParams{
		PlatformUserID:  actor.User.ID,
		SecretEncrypted: encrypted,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to store operator mfa totp secret", err, "platform_user_id", actor.User.ID.String())
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
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "mfa enrollment has not been started")
	}
	if row.EnabledAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "mfa is already enabled")
	}

	// A recovery code cannot confirm an enrollment: there are none yet, and
	// the point of the step is proving the authenticator was set up.
	outcome, err := s.checkOperatorMfaCode(ctx, row, req.Code, false)
	if err != nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	// Everything that can fail for a reason of its own is settled before the
	// enable commits, because the recovery codes exist only in the response
	// this call is about to build.
	if actor.FromChallenge && s.tokens == nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeFailure, "token_manager_unavailable")
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}

	codes, err := s.enableOperatorMfa(ctx, actor)
	switch {
	case errors.Is(err, errOperatorMfaChallengeSpent):
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeFailure, "challenge_spent")
		return nil, invalidSessionError()
	case errors.Is(err, errOperatorMfaAlreadyEnabled):
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeFailure, "already_enabled")
		return nil, connect.NewError(connect.CodeFailedPrecondition, "mfa is already enabled")
	case err != nil:
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeFailure, "enable_failed")
		return nil, err
	}

	resp := &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentResponse{RecoveryCodes: codes}
	reason := "totp"
	if actor.FromChallenge {
		user, accessToken, sessionErr := s.issueOperatorSession(ctx, actor)
		if sessionErr == nil {
			resp.User = user
			resp.AccessToken = accessToken
		} else {
			// The factor is enabled and these codes are the only copy there
			// will ever be, so answering with them and no session is better
			// than an error that throws them away. The client sees an empty
			// access token and sends the operator back through sign-in.
			reason = "session_issue_failed"
		}
	}
	s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaEnrolled, auditlog.OutcomeSuccess, reason)
	return resp, nil
}

// The two refusals enableOperatorMfa reaches only by losing a race with a
// concurrent confirmation, which ConfirmMfaEnrollment answers apart from a
// database failure.
var (
	errOperatorMfaChallengeSpent = errors.New("operator mfa challenge already spent")
	errOperatorMfaAlreadyEnabled = errors.New("operator mfa already enabled")
)

// enableOperatorMfa marks the authenticator confirmed and issues the recovery
// codes that go with it, in one transaction: an operator left enabled without
// codes would have no way back in if it lost the authenticator.
//
// An enrollment that finishes a sign-in claims its challenge in the same
// transaction, so the token buys one session however many codes of the window
// are confirmed with it at once, and is left unspent if the enable rolls back.
// The enable itself is claimed too: two confirmations that both read the row
// unconfirmed would otherwise each replace the other's recovery codes, and
// only the last to commit would hand out codes that still work.
func (s *platformServer) enableOperatorMfa(ctx context.Context, actor operatorMfaActor) ([]string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin operator mfa enrollment transaction", err, "platform_user_id", actor.User.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if actor.FromChallenge {
		claimed, err := q.MarkPlatformUserMfaChallengeUsed(ctx, dbmodels.MarkPlatformUserMfaChallengeUsedParams{
			Jti:            actor.ChallengeID,
			PlatformUserID: actor.User.ID,
			ExpiresAt:      actor.ChallengeExpiresAt,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to mark operator mfa challenge used", err, "platform_user_id", actor.User.ID.String())
		}
		if claimed == 0 {
			return nil, errOperatorMfaChallengeSpent
		}
	}
	enabled, err := q.EnablePlatformUserMfaTotp(ctx, actor.User.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to enable operator mfa totp", err, "platform_user_id", actor.User.ID.String())
	}
	if enabled == 0 {
		return nil, errOperatorMfaAlreadyEnabled
	}
	codes, err := replaceOperatorRecoveryCodes(ctx, q, actor.User.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create operator mfa recovery codes", err, "platform_user_id", actor.User.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit operator mfa enrollment", err, "platform_user_id", actor.User.ID.String())
	}
	return codes, nil
}

// spendOperatorMfaChallenge claims the challenge this exchange is about, so
// the token buys one session and not one per attempt inside its five minutes.
// The INSERT is the claim rather than a read followed by one: two requests
// presenting the same token both find it unspent, and only the one whose row
// lands may go on.
//
// It runs after the code is accepted, not before: burning the challenge on a
// mistyped code would send an operator back through the password for a typo,
// and it is the failure counter, not the challenge, that bounds guessing.
//
// A false claimed and an error are different answers: the first is a token
// that already bought a session, the second is a database that could not say.
// Only the first is a replay, and the audit trail has to tell them apart.
func (s *platformServer) spendOperatorMfaChallenge(ctx context.Context, actor operatorMfaActor) (claimed bool, err error) {
	rows, err := s.queriesFor(ctx).MarkPlatformUserMfaChallengeUsed(ctx, dbmodels.MarkPlatformUserMfaChallengeUsedParams{
		Jti:            actor.ChallengeID,
		PlatformUserID: actor.User.ID,
		ExpiresAt:      actor.ChallengeExpiresAt,
	})
	if err != nil {
		return false, s.internalDBError(ctx, "failed to mark operator mfa challenge used", err, "platform_user_id", actor.User.ID.String())
	}
	return rows == 1, nil
}

// issueOperatorSession finishes a sign-in the second factor has now settled.
func (s *platformServer) issueOperatorSession(ctx context.Context, actor operatorMfaActor) (*publirattypesv1.User, *publirattypesv1.AccessToken, error) {
	if s.tokens == nil {
		return nil, nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	token, expiresAt, err := s.tokens.Issue(actor.User.PublicID, auth.AudiencePlatform, "", actor.Role, actor.User.CredentialsVersion, time.Now())
	if err != nil {
		return nil, nil, s.internalError(ctx, "failed to issue platform access token", err, "platform_user_id", actor.User.ID.String())
	}
	return &publirattypesv1.User{PublicId: actor.User.PublicID, Name: actor.User.Name, Role: actor.Role},
		&publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
		nil
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
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	outcome, err := s.checkOperatorMfaCode(ctx, row, req.Code, true)
	if err != nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaVerified, auditlog.OutcomeFailure, outcome.Reason)
		auth.AuditEvent(ctx, "platform_mfa_verify", "failure", "", actor.User.PublicID, outcome.Reason)
		return nil, err
	}

	claimed, err := s.spendOperatorMfaChallenge(ctx, actor)
	if err != nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaVerified, auditlog.OutcomeFailure, "challenge_claim_failed")
		auth.AuditEvent(ctx, "platform_mfa_verify", "failure", "", actor.User.PublicID, "challenge_claim_failed")
		return nil, err
	}
	if !claimed {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaVerified, auditlog.OutcomeFailure, "challenge_spent")
		auth.AuditEvent(ctx, "platform_mfa_verify", "failure", "", actor.User.PublicID, "challenge_spent")
		return nil, invalidSessionError()
	}

	user, accessToken, err := s.issueOperatorSession(ctx, actor)
	if err != nil {
		return nil, err
	}
	remaining, err := s.remainingOperatorRecoveryCodes(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}

	factor := "totp"
	if outcome.RecoveryUsed {
		factor = "recovery_code"
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaRecoveryCodeUsed, auditlog.OutcomeSuccess, "")
	}
	s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaVerified, auditlog.OutcomeSuccess, factor)
	auth.AuditEvent(ctx, "platform_mfa_verify", "success", "", actor.User.PublicID, factor)

	return &publirasplatformv1.PlatformAuthServiceVerifyMfaResponse{
		User:                   user,
		AccessToken:            accessToken,
		RecoveryCodeUsed:       outcome.RecoveryUsed,
		RemainingRecoveryCodes: remaining,
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
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	// A recovery code counts here: an operator whose authenticator is gone
	// has to be able to take the factor off and enroll a new one.
	outcome, err := s.checkOperatorMfaCode(ctx, row, req.Code, true)
	if err != nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaDisabled, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin operator mfa disable transaction", err, "platform_user_id", actor.User.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := q.DeletePlatformUserMfaRecoveryCodes(ctx, actor.User.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete operator mfa recovery codes", err, "platform_user_id", actor.User.ID.String())
	}
	if err := q.DeletePlatformUserMfaTotp(ctx, actor.User.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete operator mfa totp", err, "platform_user_id", actor.User.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit operator mfa disable", err, "platform_user_id", actor.User.ID.String())
	}

	factor := "totp"
	if outcome.RecoveryUsed {
		factor = "recovery_code"
	}
	s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaDisabled, auditlog.OutcomeSuccess, factor)
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
	row, found, err := s.operatorMfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	// Only the authenticator can ask for a new batch. Letting one recovery
	// code mint ten more would make a single leaked code permanent.
	outcome, err := s.checkOperatorMfaCode(ctx, row, req.Code, false)
	if err != nil {
		s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaRecoveryCodesRegenerated, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin operator mfa recovery code transaction", err, "platform_user_id", actor.User.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	codes, err := replaceOperatorRecoveryCodes(ctx, dbmodels.New(tx), actor.User.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to regenerate operator mfa recovery codes", err, "platform_user_id", actor.User.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit operator mfa recovery codes", err, "platform_user_id", actor.User.ID.String())
	}

	s.recordOperatorMfaAudit(ctx, actor, auditActionOperatorMfaRecoveryCodesRegenerated, auditlog.OutcomeSuccess, "")
	return &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}, nil
}
