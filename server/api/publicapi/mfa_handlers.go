package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	"github.com/publira/publira/server/internal/mfaflow"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// mfaActions are the actions a reader's second factor writes to the security
// log, beside the site's other sign-in lines. The tenant's audit log is the
// console's own record, and nothing a reader does on the site is filed there.
var mfaActions = mfaflow.Actions{
	Enrolled:                 "mfa_enrolled",
	Verified:                 "mfa_verify",
	RecoveryCodeUsed:         "mfa_recovery_code_used",
	Disabled:                 "mfa_disabled",
	RecoveryCodesRegenerated: "mfa_recovery_codes_regenerated",
}

// mfaOTPAuthIssuer is what an authenticator app lists the entry under when
// the tenant has no name of its own to show, as the console names it.
const mfaOTPAuthIssuer = "Publira"

// mfaActor is the account a second-factor RPC acts for. FromChallenge marks
// the token a password or a provider's sign-in earned, which VerifyMfa alone
// accepts; ChallengeID and ChallengeExpiresAt name it, so the exchange can
// record it as spent.
type mfaActor struct {
	Tenant             dbmodels.Tenant
	User               dbmodels.User
	Role               string
	FromChallenge      bool
	ChallengeID        uuid.UUID
	ChallengeExpiresAt time.Time
}

// mfaAccount is a reader's second factor, as mfaflow reaches it: over the
// user_mfa_* rows the tenant's console keeps for the same account, so one
// authenticator, one set of recovery codes, and one lock serve the site and
// the console alike.
//
// Passkeys are not among its factors. The ones the reader registered on the
// site sign in on their own and settle no challenge, and the ones a member of
// staff registered in the console are bound to the console's host, where the
// site cannot ask for them. They still keep the recovery codes when the
// authenticator goes, since in the console the codes stand in for them too.
type mfaAccount struct {
	s     *apiServer
	actor mfaActor
	// q is the querier a step outside a transaction runs on, when the caller
	// is inside one of its own; the request's connection otherwise.
	q dbmodels.Querier
}

func (s *apiServer) mfaAccount(actor mfaActor) mfaAccount {
	return mfaAccount{s: s, actor: actor}
}

var _ mfaflow.Account = mfaAccount{}

func (a mfaAccount) Queries(ctx context.Context) dbmodels.Querier {
	if a.q != nil {
		return a.q
	}
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
	if err := q.LockUserMfaFactors(ctx, userID); err != nil {
		return a.s.internalDBError(ctx, "failed to lock mfa factors", err, "user_id", userID.String())
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

func (a mfaAccount) Passkeys(context.Context, dbmodels.Querier) (int64, error) {
	return 0, nil
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
	return tenantmembers.DeleteRecoveryCodesWithTheLastFactor(ctx, q, a.actor.User.ID)
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
	actor := a.actor
	accessToken, err := a.s.mintAccessToken(actor.Tenant, actor.User, actor.Role)
	if err != nil {
		return nil, nil, err
	}
	account, err := a.s.ownAccountWithIcon(ctx, a.s.queriesFor(ctx), actor.Tenant, actor.User, actor.Role)
	if err != nil {
		return nil, nil, err
	}
	return account, accessToken, nil
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
	return mfaActions
}

func (a mfaAccount) Audit(ctx context.Context, action, outcome, reason string) {
	auth.AuditEvent(ctx, action, outcome, a.actor.Tenant.PublicID, a.actor.User.PublicID, reason)
}

// LogVerification writes nothing: the security log is where Audit already
// wrote the line for the same step.
func (a mfaAccount) LogVerification(context.Context, string, string) {}

func (a mfaAccount) InternalError(ctx context.Context, msg string, err error) error {
	return a.s.internalError(ctx, msg, err, "user_id", a.actor.User.ID.String())
}

// mfaChallengeAfterSignIn answers the challenge a sign-in that has proved
// the account earns in place of a session, or nil when the account holds no
// authenticator and the session may be issued. q reads the factors, so a
// caller inside a transaction passes the one it holds.
func (s *apiServer) mfaChallengeAfterSignIn(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant, user dbmodels.User) (*publirav1.MfaChallenge, error) {
	acct := s.mfaAccount(mfaActor{Tenant: tenant, User: user})
	acct.q = q
	// The site never requires the factor of anyone, so nothing is owed but an
	// answer from one the account holds.
	owed, _, err := mfaflow.OwedAfterPassword(ctx, acct, func(context.Context) (bool, error) { return false, nil })
	if err != nil {
		return nil, err
	}
	if owed != mfaflow.OwedVerification {
		return nil, nil
	}
	if s.tokens == nil {
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	token, expiresAt, err := s.tokens.IssueMFAChallengeToken(user.PublicID, auth.AudiencePublicMFAVerify, tenant.ID.String(), user.CredentialsVersion, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	return &publirav1.MfaChallenge{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)}, nil
}

// actorFromChallenge resolves the account a challenge token names. It repeats
// every check a sign-in made before it earned the challenge, apart from the
// password: the token has to name this tenant, and the account still has to
// be active, hold a confirmed address, and hold the credentials version the
// token was signed with.
func (s *apiServer) actorFromChallenge(ctx context.Context, tenant dbmodels.Tenant, challengeToken string) (mfaActor, error) {
	challenge, ok := mfaflow.ParseChallenge(s.tokens, challengeToken, auth.AudiencePublicMFAVerify)
	if !ok || challenge.TenantID != tenant.ID.String() {
		return mfaActor{}, invalidSessionError()
	}
	userRef, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: challenge.Subject,
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return mfaActor{}, invalidSessionError()
	}
	if err != nil {
		return mfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge user by public id", err, "tenant_id", tenant.ID.String())
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userRef.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return mfaActor{}, invalidSessionError()
	}
	if err != nil {
		return mfaActor{}, s.internalDBError(ctx, "failed to get mfa challenge user", err, "tenant_id", tenant.ID.String(), "user_id", userRef.ID.String())
	}
	if user.Status != "active" || !user.EmailVerifiedAt.Valid || user.CredentialsVersion != challenge.CredentialsVersion {
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
		ChallengeID:        challenge.ID,
		ChallengeExpiresAt: challenge.ExpiresAt,
	}, nil
}

// mfaActorFromSession identifies a signed-in reader acting on their own
// second factor.
func (s *apiServer) mfaActorFromSession(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (mfaActor, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, tenantCtx, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return mfaActor{}, err
	}
	return mfaActor{Tenant: tenant, User: user, Role: role}, nil
}

// chargeMfaAction spends one of the account's password verifications for a
// step that writes its second factor or checks a code from it. A code is a
// secret of the account as its password is, so one budget bounds guessing at
// either, alongside the lock the codes count toward; a step that succeeds
// clears it through clearMfaAction.
func (s *apiServer) chargeMfaAction(ctx context.Context, actor mfaActor, action string) error {
	if err := s.chargeReaderAction(ctx, actionVerifyPassword, actor.Tenant.ID, actor.User.ID); err != nil {
		auth.AuditEvent(ctx, action, "failure", actor.Tenant.PublicID, actor.User.PublicID, "rate_limited")
		return err
	}
	return nil
}

func (s *apiServer) clearMfaAction(ctx context.Context, actor mfaActor) {
	s.clearReaderAction(ctx, actionVerifyPassword, actor.Tenant.ID, actor.User.ID)
}

// refuseConsoleFactor refuses setting an authenticator up on the site for an
// account that holds a passkey in the tenant's console, whatever host it was
// registered for. The site asks no code of such an account, so its session
// proves the password alone, and an authenticator enrolled through it would
// answer the console's challenge in place of the passkey and replace the
// recovery codes the passkey keeps. The console enrolls it instead, from a
// session the passkey already answered.
func (s *apiServer) refuseConsoleFactor(ctx context.Context, actor mfaActor) error {
	passkeys, err := s.queriesFor(ctx).CountUserWebauthnCredentials(ctx, dbmodels.CountUserWebauthnCredentialsParams{
		UserID:       actor.User.ID,
		RelyingParty: tenantwebauthn.KindAdminConsole,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to count console passkeys", err, "user_id", actor.User.ID.String())
	}
	if passkeys > 0 {
		auth.AuditEvent(ctx, mfaActions.Enrolled, "failure", actor.Tenant.PublicID, actor.User.PublicID, "console_passkey_held")
		return rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			errors.New("the account's second factor is a passkey in the tenant's console, where the authenticator is set up"),
			rpcerrors.ReasonMfaSetUpInConsole,
		)
	}
	return nil
}

func (s *apiServer) VerifyMfa(
	ctx context.Context,
	req *publirav1.VerifyMfaRequest,
) (*publirav1.VerifyMfaResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(ctx, mfaActions.Verified, "failure", "", "", "tenant_not_found")
		return nil, err
	}
	actor, err := s.actorFromChallenge(ctx, tenant, req.ChallengeToken)
	if err != nil {
		auth.AuditEvent(ctx, mfaActions.Verified, "failure", tenant.PublicID, "", "invalid_challenge")
		return nil, err
	}
	if strings.TrimSpace(req.Code) == "" {
		return nil, mfaflow.CodeRequiredError()
	}
	if err := s.chargeMfaAction(ctx, actor, mfaActions.Verified); err != nil {
		return nil, err
	}
	verification, err := mfaflow.Verify(ctx, s.mfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	s.clearMfaAction(ctx, actor)
	return &publirav1.VerifyMfaResponse{
		User:                   verification.User,
		AccessToken:            verification.AccessToken,
		RecoveryCodeUsed:       verification.RecoveryCodeUsed,
		RemainingRecoveryCodes: verification.RemainingRecoveryCodes,
	}, nil
}

func (s *apiServer) GetMfaStatus(
	ctx context.Context,
	req *publirav1.GetMfaStatusRequest,
) (*publirav1.GetMfaStatusResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	status, err := mfaflow.GetStatus(ctx, s.mfaAccount(actor))
	if err != nil {
		return nil, err
	}
	resp := &publirav1.GetMfaStatusResponse{RemainingRecoveryCodes: status.RemainingRecoveryCodes}
	if status.Factors.TotpEnabled() {
		resp.Enabled = true
		resp.EnabledAt = auth.FormatExpiresAt(status.Factors.Totp.EnabledAt.Time)
	}
	return resp, nil
}

func (s *apiServer) StartMfaEnrollment(
	ctx context.Context,
	req *publirav1.StartMfaEnrollmentRequest,
) (*publirav1.StartMfaEnrollmentResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if err := s.chargeMfaAction(ctx, actor, mfaActions.Enrolled); err != nil {
		return nil, err
	}
	if err := s.refuseConsoleFactor(ctx, actor); err != nil {
		return nil, err
	}
	enrollment, err := mfaflow.StartEnrollment(ctx, s.mfaAccount(actor))
	if err != nil {
		return nil, err
	}
	return &publirav1.StartMfaEnrollmentResponse{
		Secret:     enrollment.Secret,
		OtpauthUri: enrollment.OTPAuthURI,
	}, nil
}

func (s *apiServer) ConfirmMfaEnrollment(
	ctx context.Context,
	req *publirav1.ConfirmMfaEnrollmentRequest,
) (*publirav1.ConfirmMfaEnrollmentResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Code) == "" {
		return nil, mfaflow.CodeRequiredError()
	}
	if err := s.chargeMfaAction(ctx, actor, mfaActions.Enrolled); err != nil {
		return nil, err
	}
	// Asked again here: a passkey registered in the console after the start
	// is held by the time the authenticator would be turned on.
	if err := s.refuseConsoleFactor(ctx, actor); err != nil {
		return nil, err
	}
	confirmation, err := mfaflow.ConfirmEnrollment(ctx, s.mfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	s.clearMfaAction(ctx, actor)
	return &publirav1.ConfirmMfaEnrollmentResponse{RecoveryCodes: confirmation.RecoveryCodes}, nil
}

// DisableMfa takes the authenticator off once the request proves the account
// twice over: by its password, or the fresh sign-in an account without one
// confirms with, and by a code. A session alone is not enough, because the
// factor is what keeps a stolen password from opening the account, and a
// stolen session must not be able to take it away.
func (s *apiServer) DisableMfa(
	ctx context.Context,
	req *publirav1.DisableMfaRequest,
) (*publirav1.DisableMfaResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(ctx, mfaActions.Disabled, "failure", "", "", "invalid_session")
		return nil, err
	}
	tenant, user := actor.Tenant, actor.User
	fail := func(reason string, err error) (*publirav1.DisableMfaResponse, error) {
		auth.AuditEvent(ctx, mfaActions.Disabled, "failure", tenant.PublicID, user.PublicID, reason)
		return nil, err
	}

	withPassword := strings.TrimSpace(req.Password) != ""
	withIdentity := strings.TrimSpace(req.IdToken) != ""
	withPasskey := strings.TrimSpace(req.PasskeyCredentialJson) != ""
	if confirmationsGiven(withPassword, withIdentity, withPasskey) != 1 {
		return fail("invalid_input", connect.NewError(connect.CodeInvalidArgument, "one of password, id_token or passkey_credential_json is required"))
	}
	if strings.TrimSpace(req.Code) == "" {
		return fail("code_missing", mfaflow.CodeRequiredError())
	}
	acct := s.mfaAccount(actor)
	// Refused before anything is charged or spent: there is nothing to take
	// off, and the confirmation would be spent for no step.
	totp, found, err := acct.Totp(ctx, acct.Queries(ctx))
	if err != nil {
		return nil, acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	if !found || !totp.EnabledAt.Valid {
		return fail("not_enabled", mfaflow.NotEnabledError())
	}
	if err := s.chargeMfaAction(ctx, actor, mfaActions.Disabled); err != nil {
		return nil, err
	}

	// The confirmation is checked, and spent, before the code, so a wrong
	// code tells nothing to a caller who has not proved the account first,
	// and every code guessed after a sign-in costs another one.
	switch {
	case withPassword:
		if !auth.VerifyUserPassword(req.Password, user.PasswordHash) {
			// Not Unauthenticated: the session is fine, the confirmation field
			// is wrong, and a client drops a session it gets Unauthenticated
			// for.
			return fail("invalid_password", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid password"), "password"))
		}
	case withIdentity:
		if err := s.confirmWithIdentity(ctx, s.queriesFor(ctx), tenant.ID, user.ID, req.Provider, req.IdToken, req.Nonce); err != nil {
			return fail("invalid_identity_confirmation", err)
		}
	default:
		if err := s.confirmWithPasskey(ctx, s.queriesFor(ctx), tenant, user, req.PasskeyCredentialJson); err != nil {
			return fail("invalid_passkey_confirmation", err)
		}
	}

	if err := mfaflow.Disable(ctx, acct, req.Code); err != nil {
		return nil, err
	}
	s.clearMfaAction(ctx, actor)
	return &publirav1.DisableMfaResponse{}, nil
}

func (s *apiServer) RegenerateMfaRecoveryCodes(
	ctx context.Context,
	req *publirav1.RegenerateMfaRecoveryCodesRequest,
) (*publirav1.RegenerateMfaRecoveryCodesResponse, error) {
	actor, err := s.mfaActorFromSession(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Code) == "" {
		return nil, mfaflow.CodeRequiredError()
	}
	if err := s.chargeMfaAction(ctx, actor, mfaActions.RecoveryCodesRegenerated); err != nil {
		return nil, err
	}
	codes, err := mfaflow.RegenerateRecoveryCodes(ctx, s.mfaAccount(actor), req.Code)
	if err != nil {
		return nil, err
	}
	s.clearMfaAction(ctx, actor)
	return &publirav1.RegenerateMfaRecoveryCodesResponse{RecoveryCodes: codes}, nil
}
