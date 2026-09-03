package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The actions the second factor writes to the tenant audit trail. A wrong
// code is the same action as a right one with outcome failure, which is how
// the rest of audit_logs distinguishes the two.
const (
	auditActionMfaEnrolled                 = "admin_mfa_enrolled"
	auditActionMfaVerified                 = "admin_mfa_verified"
	auditActionMfaRecoveryCodeUsed         = "admin_mfa_recovery_code_used"
	auditActionMfaDisabled                 = "admin_mfa_disabled"
	auditActionMfaRecoveryCodesRegenerated = "admin_mfa_recovery_codes_regenerated"
)

// mfaOTPAuthIssuer is what an authenticator app lists the entry under when
// the tenant has no name of its own to show.
const mfaOTPAuthIssuer = "Publira"

func mfaCodeRequiredError() error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New("code is required"))
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
	return connect.NewError(connect.CodeFailedPrecondition, errors.New("mfa is not enabled"))
}

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

// mfaRequiredForRole reports whether this deployment makes the second factor
// a condition of signing in for the given tenant role. Only tenant_admin is
// covered: editors and auditors may enroll, and are never held back for it.
func (s *adminServer) mfaRequiredForRole(role string) bool {
	return s.mfaRequiredForTenantAdmin && role == auth.RoleTenantAdmin
}

// mfaChallengeKindFor decides what a correct password still leaves owed. An
// account with a confirmed authenticator owes a code; one without owes an
// enrollment only where the deployment requires the factor of its role.
// Anything else is a login that finishes on the password alone.
func (s *adminServer) mfaChallengeKindFor(
	ctx context.Context,
	user dbmodels.User,
	role string,
) (publiraadminv1.MfaChallengeKind, error) {
	row, found, err := s.mfaTotpRow(ctx, user.ID)
	if err != nil {
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, err
	}
	switch {
	case found && row.EnabledAt.Valid:
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_VERIFY, nil
	case s.mfaRequiredForRole(role):
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL, nil
	default:
		return publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_UNSPECIFIED, nil
	}
}

// mfaChallengeFor mints the half-finished session a correct password earns.
func (s *adminServer) mfaChallengeFor(
	tenant dbmodels.Tenant,
	user dbmodels.User,
	kind publiraadminv1.MfaChallengeKind,
) (*publiraadminv1.AdminAuthServiceMfaChallenge, error) {
	audience := auth.AudienceAdminMFAVerify
	if kind == publiraadminv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		audience = auth.AudienceAdminMFAEnroll
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}
	token, expiresAt, err := s.tokens.IssueMFAChallengeToken(user.PublicID, audience, tenant.ID.String(), user.CredentialsVersion, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return &publiraadminv1.AdminAuthServiceMfaChallenge{
		Token:     token,
		ExpiresAt: auth.FormatExpiresAt(expiresAt),
		Kind:      kind,
	}, nil
}

// actorFromChallenge resolves the account a challenge token names. It repeats
// every check a session does apart from the audience: the account still has
// to be active and still hold the credentials version the token was signed
// with, so a suspension or a password change ends a pending challenge.
//
// A challenge without a usable `jti` or expiry is refused outright: those are
// what a single exchange is recorded under, and a token that cannot be
// recorded cannot be limited to one.
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
	if s.tokens == nil {
		return mfaActor{}, invalidSessionError()
	}
	claims, err := s.tokens.Verify(strings.TrimSpace(challengeToken), audience)
	if err != nil {
		return mfaActor{}, invalidSessionError()
	}
	if claims.TenantID != tenant.ID.String() {
		return mfaActor{}, invalidSessionError()
	}
	challengeID, err := uuid.Parse(strings.TrimSpace(claims.ID))
	if err != nil {
		return mfaActor{}, invalidSessionError()
	}
	if claims.ExpiresAt == nil {
		return mfaActor{}, invalidSessionError()
	}
	userRef, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: claims.Subject,
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
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
		return mfaActor{}, invalidSessionError()
	}
	role, err := s.tenantRole(ctx, user.ID)
	if err != nil {
		return mfaActor{}, err
	}
	return mfaActor{
		Tenant:             tenant,
		User:               user,
		Role:               role,
		FromChallenge:      true,
		ChallengeID:        challengeID,
		ChallengeExpiresAt: claims.ExpiresAt.Time,
	}, nil
}

// mfaActorFor identifies the account an enrollment RPC is for. A signed-in
// account enrolling voluntarily is identified by its session; one that login
// stopped at an enroll challenge has no session yet and sends the challenge
// token instead.
func (s *adminServer) mfaActorFor(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers http.Header,
	challengeToken string,
) (mfaActor, error) {
	if strings.TrimSpace(challengeToken) != "" {
		return s.actorFromChallenge(ctx, tenantCtx, challengeToken, auth.AudienceAdminMFAEnroll)
	}
	tenant, user, role, err := s.currentUserFromSession(ctx, tenantCtx, headers)
	if err != nil {
		return mfaActor{}, err
	}
	return mfaActor{Tenant: tenant, User: user, Role: role}, nil
}

func (s *adminServer) recordMfaAudit(ctx context.Context, actor mfaActor, headers http.Header, action, outcome, reason string) {
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    actor.Tenant.ID,
		ActorUserID: actor.User.ID,
		ActorRole:   actor.Role,
		Action:      action,
		TargetType:  "user",
		TargetID:    actor.User.PublicID,
		Outcome:     outcome,
		Reason:      reason,
		ClientIP:    auditlog.ClientIPFromHeader(headers),
	})
}

// mfaTotpRow reads the account's TOTP state. A missing row and an unconfirmed
// one are the same answer to "does this account have a second factor".
func (s *adminServer) mfaTotpRow(ctx context.Context, userID uuid.UUID) (dbmodels.UserMfaTotp, bool, error) {
	row, err := s.queriesFor(ctx).GetUserMfaTotpByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.UserMfaTotp{}, false, nil
		}
		return dbmodels.UserMfaTotp{}, false, s.internalDBError(ctx, "failed to get user mfa totp", err, "user_id", userID.String())
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

// checkMfaCode decides whether code unlocks the account behind row, spending
// a recovery code if allowRecovery and the code is one. It owns the failure
// counter and the lock: a refusal here has already been recorded, and the
// error it returns is the one to hand the client.
func (s *adminServer) checkMfaCode(
	ctx context.Context,
	row dbmodels.UserMfaTotp,
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
		return mfaCodeOutcome{Reason: "secret_manager_unavailable"}, connect.NewError(connect.CodeFailedPrecondition, errors.New("secret manager is not configured"))
	}
	secret, err := s.encryptor.DecryptString(row.SecretEncrypted)
	if err != nil {
		return mfaCodeOutcome{Reason: "secret_undecryptable"}, s.internalError(ctx, "failed to decrypt mfa totp secret", err, "user_id", row.UserID.String())
	}

	if step, ok := mfa.ValidateCode(secret, code, now); ok {
		// The window spans more than one period, so a code observed over a
		// shoulder is still current for a while after it was spent. Refusing
		// a step already accepted is what RFC 6238 section 5.2 asks for.
		// The claim on the step is the UPDATE itself rather than a comparison
		// against the row read above: two requests carrying the same code
		// both read the old step, and only the one whose write lands first
		// may have it.
		claimed, err := s.queriesFor(ctx).MarkUserMfaTotpVerified(ctx, dbmodels.MarkUserMfaTotpVerifiedParams{
			UserID:           row.UserID,
			LastVerifiedStep: sql.NullInt64{Int64: step, Valid: true},
		})
		if err != nil {
			return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to mark mfa totp verified", err, "user_id", row.UserID.String())
		}
		if claimed == 0 {
			return s.recordMfaFailure(ctx, row, "code_reused")
		}
		return mfaCodeOutcome{}, nil
	}

	if allowRecovery {
		used, err := s.spendRecoveryCode(ctx, row.UserID, code)
		if err != nil {
			return mfaCodeOutcome{}, err
		}
		if used {
			if err := s.queriesFor(ctx).ResetUserMfaTotpFailures(ctx, row.UserID); err != nil {
				return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to reset mfa failures", err, "user_id", row.UserID.String())
			}
			return mfaCodeOutcome{RecoveryUsed: true}, nil
		}
	}

	return s.recordMfaFailure(ctx, row, "invalid_code")
}

// recordMfaFailure counts one refused code and reports whether that was the
// one that started the lock, so the client learns it is locked out now rather
// than on its next attempt.
func (s *adminServer) recordMfaFailure(ctx context.Context, row dbmodels.UserMfaTotp, reason string) (mfaCodeOutcome, error) {
	updated, err := s.queriesFor(ctx).RecordUserMfaTotpFailure(ctx, dbmodels.RecordUserMfaTotpFailureParams{
		UserID:            row.UserID,
		MaxFailedAttempts: mfa.MaxFailedAttempts,
		LockedUntil:       time.Now().Add(mfa.LockDuration),
	})
	if err != nil {
		return mfaCodeOutcome{}, s.internalDBError(ctx, "failed to record mfa failure", err, "user_id", row.UserID.String())
	}
	if updated.LockedUntil.Valid && updated.LockedUntil.Time.After(time.Now()) {
		return mfaCodeOutcome{Reason: "locked"}, mfaLockedError()
	}
	return mfaCodeOutcome{Reason: reason}, mfaInvalidCodeError()
}

// spendRecoveryCode marks the one unused code that matches, if any. Codes are
// stored as bcrypt hashes, so the only way to find the match is to try each.
func (s *adminServer) spendRecoveryCode(ctx context.Context, userID uuid.UUID, code string) (bool, error) {
	rows, err := s.queriesFor(ctx).ListUnusedUserMfaRecoveryCodes(ctx, userID)
	if err != nil {
		return false, s.internalDBError(ctx, "failed to list mfa recovery codes", err, "user_id", userID.String())
	}
	for _, row := range rows {
		if !mfa.VerifyRecoveryCode(code, row.CodeHash) {
			continue
		}
		affected, err := s.queriesFor(ctx).MarkUserMfaRecoveryCodeUsed(ctx, row.ID)
		if err != nil {
			return false, s.internalDBError(ctx, "failed to mark mfa recovery code used", err, "user_id", userID.String())
		}
		// Zero rows means a concurrent request spent the same code first, so
		// this one is no longer redeemable.
		return affected == 1, nil
	}
	return false, nil
}

// replaceRecoveryCodes draws a fresh batch and puts it in place of whatever
// the account held, used or not. The plaintext it returns is the only copy
// that will exist.
func replaceRecoveryCodes(ctx context.Context, queries Querier, tenantID, userID uuid.UUID) ([]string, error) {
	codes, err := mfa.GenerateRecoveryCodes()
	if err != nil {
		return nil, err
	}
	if err := queries.DeleteUserMfaRecoveryCodesByUserID(ctx, userID); err != nil {
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
		if err := queries.CreateUserMfaRecoveryCode(ctx, dbmodels.CreateUserMfaRecoveryCodeParams{
			ID:       id,
			TenantID: tenantID,
			UserID:   userID,
			CodeHash: hash,
		}); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

func (s *adminServer) remainingRecoveryCodes(ctx context.Context, userID uuid.UUID) (int32, error) {
	count, err := s.queriesFor(ctx).CountUnusedUserMfaRecoveryCodes(ctx, userID)
	if err != nil {
		return 0, s.internalDBError(ctx, "failed to count mfa recovery codes", err, "user_id", userID.String())
	}
	return int32(count), nil
}

func (s *adminServer) GetMfaStatus(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceGetMfaStatusRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceGetMfaStatusResponse], error) {
	_, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	row, found, err := s.mfaTotpRow(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	resp := &publiraadminv1.AdminAuthServiceGetMfaStatusResponse{Required: s.mfaRequiredForRole(role)}
	if found && row.EnabledAt.Valid {
		remaining, err := s.remainingRecoveryCodes(ctx, user.ID)
		if err != nil {
			return nil, err
		}
		resp.Enabled = true
		resp.EnabledAt = auth.FormatExpiresAt(row.EnabledAt.Time)
		resp.RemainingRecoveryCodes = remaining
	}
	return connect.NewResponse(resp), nil
}

func (s *adminServer) StartMfaEnrollment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceStartMfaEnrollmentResponse], error) {
	actor, err := s.mfaActorFor(ctx, req.Msg.Tenant, req.Header(), req.Msg.ChallengeToken)
	if err != nil {
		return nil, err
	}
	if s.encryptor == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("secret manager is not configured"))
	}
	row, found, err := s.mfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	// Replacing a confirmed authenticator has to go through disabling it, so
	// a stolen session cannot quietly swap the factor for one of its own.
	if found && row.EnabledAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("mfa is already enabled"))
	}

	issuer := strings.TrimSpace(actor.Tenant.Name)
	if issuer == "" {
		issuer = mfaOTPAuthIssuer
	}
	enrollment, err := mfa.GenerateEnrollment(issuer, actor.User.Email)
	if err != nil {
		return nil, s.internalError(ctx, "failed to generate mfa enrollment", err, "user_id", actor.User.ID.String())
	}
	encrypted, err := s.encryptor.EncryptString(enrollment.Secret)
	if err != nil {
		return nil, s.internalError(ctx, "failed to encrypt mfa totp secret", err, "user_id", actor.User.ID.String())
	}
	if _, err := s.queriesFor(ctx).UpsertUserMfaTotpSecret(ctx, dbmodels.UpsertUserMfaTotpSecretParams{
		UserID:          actor.User.ID,
		TenantID:        actor.Tenant.ID,
		SecretEncrypted: encrypted,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to store mfa totp secret", err, "user_id", actor.User.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceStartMfaEnrollmentResponse{
		Secret:     enrollment.Secret,
		OtpauthUri: enrollment.OTPAuthURI,
	}), nil
}

func (s *adminServer) ConfirmMfaEnrollment(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentResponse], error) {
	actor, err := s.mfaActorFor(ctx, req.Msg.Tenant, req.Header(), req.Msg.ChallengeToken)
	if err != nil {
		return nil, err
	}
	row, found, err := s.mfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("mfa enrollment has not been started"))
	}
	if row.EnabledAt.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("mfa is already enabled"))
	}

	// A recovery code cannot confirm an enrollment: there are none yet, and
	// the point of the step is proving the authenticator was set up.
	outcome, err := s.checkMfaCode(ctx, row, req.Msg.Code, false)
	if err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaEnrolled, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	// Everything that can fail for a reason of its own is settled before the
	// enable commits, because the recovery codes exist only in the response
	// this call is about to build.
	if actor.FromChallenge && s.tokens == nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaEnrolled, auditlog.OutcomeFailure, "token_manager_unavailable")
		return nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}

	codes, err := s.enableMfa(ctx, actor)
	if err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaEnrolled, auditlog.OutcomeFailure, "enable_failed")
		return nil, err
	}

	resp := &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentResponse{RecoveryCodes: codes}
	reason := "totp"
	if actor.FromChallenge {
		user, accessToken, sessionErr := s.issueAdminSession(ctx, actor)
		if sessionErr == nil {
			resp.User = user
			resp.AccessToken = accessToken
		} else {
			// The factor is enabled and these codes are the only copy there
			// will ever be, so answering with them and no session is better
			// than an error that throws them away. The client sees an empty
			// access token and sends the account back through login.
			reason = "session_issue_failed"
		}
	}
	s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaEnrolled, auditlog.OutcomeSuccess, reason)
	return connect.NewResponse(resp), nil
}

// enableMfa marks the authenticator confirmed and issues the recovery codes
// that go with it, in one transaction: an account left enabled without codes
// would have no way back in if it lost the authenticator.
func (s *adminServer) enableMfa(ctx context.Context, actor mfaActor) ([]string, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin mfa enrollment transaction", err, "user_id", actor.User.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if _, err := q.EnableUserMfaTotp(ctx, actor.User.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to enable mfa totp", err, "user_id", actor.User.ID.String())
	}
	codes, err := replaceRecoveryCodes(ctx, q, actor.Tenant.ID, actor.User.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create mfa recovery codes", err, "user_id", actor.User.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit mfa enrollment", err, "user_id", actor.User.ID.String())
	}
	return codes, nil
}

// spendMfaChallenge claims the challenge this exchange is about, so the token
// buys one session and not one per attempt inside its five minutes. The
// INSERT is the claim rather than a read followed by one: two requests
// presenting the same token both find it unspent, and only the one whose row
// lands may go on.
//
// It runs after the code is accepted, not before: burning the challenge on a
// mistyped code would send an operator back through the password for a typo,
// and it is the failure counter, not the challenge, that bounds guessing.
func (s *adminServer) spendMfaChallenge(ctx context.Context, actor mfaActor) error {
	claimed, err := s.queriesFor(ctx).MarkUserMfaChallengeUsed(ctx, dbmodels.MarkUserMfaChallengeUsedParams{
		Jti:       actor.ChallengeID,
		TenantID:  actor.Tenant.ID,
		UserID:    actor.User.ID,
		ExpiresAt: actor.ChallengeExpiresAt,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to mark mfa challenge used", err, "user_id", actor.User.ID.String())
	}
	if claimed == 0 {
		return invalidSessionError()
	}
	return nil
}

// issueAdminSession finishes a login the second factor has now settled.
func (s *adminServer) issueAdminSession(ctx context.Context, actor mfaActor) (*publirattypesv1.User, *publirattypesv1.AccessToken, error) {
	if s.tokens == nil {
		return nil, nil, connect.NewError(connect.CodeInternal, errors.New("token manager is not configured"))
	}
	token, expiresAt, err := s.tokens.Issue(actor.User.PublicID, auth.AudienceAdmin, actor.Tenant.ID.String(), actor.Role, actor.User.CredentialsVersion, time.Now())
	if err != nil {
		return nil, nil, s.internalError(ctx, "failed to issue admin access token", err, "user_id", actor.User.ID.String())
	}
	return &publirattypesv1.User{PublicId: actor.User.PublicID, Name: actor.User.Name, Role: actor.Role},
		&publirattypesv1.AccessToken{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)},
		nil
}

func (s *adminServer) VerifyMfa(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceVerifyMfaRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceVerifyMfaResponse], error) {
	actor, err := s.actorFromChallenge(ctx, req.Msg.Tenant, req.Msg.ChallengeToken, auth.AudienceAdminMFAVerify)
	if err != nil {
		auth.AuditEvent(req.Header(), "admin_mfa_verify", "failure", "", "", "invalid_challenge")
		return nil, err
	}
	row, found, err := s.mfaTotpRow(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	outcome, err := s.checkMfaCode(ctx, row, req.Msg.Code, true)
	if err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaVerified, auditlog.OutcomeFailure, outcome.Reason)
		auth.AuditEvent(req.Header(), "admin_mfa_verify", "failure", actor.Tenant.PublicID, actor.User.PublicID, outcome.Reason)
		return nil, err
	}

	if err := s.spendMfaChallenge(ctx, actor); err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaVerified, auditlog.OutcomeFailure, "challenge_spent")
		auth.AuditEvent(req.Header(), "admin_mfa_verify", "failure", actor.Tenant.PublicID, actor.User.PublicID, "challenge_spent")
		return nil, err
	}

	user, accessToken, err := s.issueAdminSession(ctx, actor)
	if err != nil {
		return nil, err
	}
	remaining, err := s.remainingRecoveryCodes(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}

	factor := "totp"
	if outcome.RecoveryUsed {
		factor = "recovery_code"
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaRecoveryCodeUsed, auditlog.OutcomeSuccess, "")
	}
	s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaVerified, auditlog.OutcomeSuccess, factor)
	auth.AuditEvent(req.Header(), "admin_mfa_verify", "success", actor.Tenant.PublicID, actor.User.PublicID, factor)

	return connect.NewResponse(&publiraadminv1.AdminAuthServiceVerifyMfaResponse{
		User:                   user,
		AccessToken:            accessToken,
		RecoveryCodeUsed:       outcome.RecoveryUsed,
		RemainingRecoveryCodes: remaining,
	}), nil
}

func (s *adminServer) DisableMfa(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceDisableMfaRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceDisableMfaResponse], error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	actor := mfaActor{Tenant: tenant, User: user, Role: role}
	row, found, err := s.mfaTotpRow(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	// A recovery code counts here: an account whose authenticator is gone has
	// to be able to take the factor off without waiting for an operator.
	outcome, err := s.checkMfaCode(ctx, row, req.Msg.Code, true)
	if err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaDisabled, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin mfa disable transaction", err, "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := q.DeleteUserMfaRecoveryCodesByUserID(ctx, user.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete mfa recovery codes", err, "user_id", user.ID.String())
	}
	if err := q.DeleteUserMfaTotpByUserID(ctx, user.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete mfa totp", err, "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit mfa disable", err, "user_id", user.ID.String())
	}

	factor := "totp"
	if outcome.RecoveryUsed {
		factor = "recovery_code"
	}
	s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaDisabled, auditlog.OutcomeSuccess, factor)
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceDisableMfaResponse{Disabled: true}), nil
}

func (s *adminServer) RegenerateMfaRecoveryCodes(
	ctx context.Context,
	req *connect.Request[publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest],
) (*connect.Response[publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesResponse], error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	actor := mfaActor{Tenant: tenant, User: user, Role: role}
	row, found, err := s.mfaTotpRow(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if !found || !row.EnabledAt.Valid {
		return nil, mfaNotEnabledError()
	}

	// Only the authenticator can ask for a new batch. Letting one recovery
	// code mint ten more would make a single leaked code permanent.
	outcome, err := s.checkMfaCode(ctx, row, req.Msg.Code, false)
	if err != nil {
		s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaRecoveryCodesRegenerated, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin mfa recovery code transaction", err, "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	codes, err := replaceRecoveryCodes(ctx, dbmodels.New(tx), tenant.ID, user.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to regenerate mfa recovery codes", err, "user_id", user.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit mfa recovery codes", err, "user_id", user.ID.String())
	}

	s.recordMfaAudit(ctx, actor, req.Header(), auditActionMfaRecoveryCodesRegenerated, auditlog.OutcomeSuccess, "")
	return connect.NewResponse(&publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}), nil
}
