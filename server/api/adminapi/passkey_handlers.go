package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// passkeyOpenCeremonies is how many ceremonies of one kind an account may
// have open at once: enough for a few tabs or devices begun side by side, few
// enough that calling a begin over and over leaves next to nothing behind.
const passkeyOpenCeremonies = 5

// passkeyNameMaxLength bounds what an owner may call a passkey, in
// characters, as user_webauthn_credentials_name_check does.
const passkeyNameMaxLength = 64

// A refused assertion answers `unauthenticated` as a refused code does, with
// a reason of its own so the console can say which of the two was refused.
func passkeyRefusedError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeUnauthenticated, errors.New("passkey refused"), rpcerrors.ReasonMfaPasskeyRefused)
}

// A registration the authenticator's response does not verify against is the
// request's fault rather than the caller's identity, so it is not
// `unauthenticated`.
func passkeyRegistrationRefusedError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeInvalidArgument, errors.New("passkey refused"), rpcerrors.ReasonMfaPasskeyRefused)
}

func passkeyNotFoundError() error {
	return connect.NewError(connect.CodeNotFound, "passkey not found")
}

func passkeyCredentialRequiredError() error {
	return connect.NewError(connect.CodeInvalidArgument, "credential_json is required")
}

func normalizePasskeyName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > passkeyNameMaxLength {
		return "", connect.Errorf(connect.CodeInvalidArgument, "name must be at most %d characters", passkeyNameMaxLength)
	}
	return name, nil
}

func passkeyProto(row dbmodels.UserWebauthnCredential) *publiraadminv1.Passkey {
	return &publiraadminv1.Passkey{
		Id:         row.PublicID,
		Name:       row.Name,
		CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
		LastUsedAt: formatOptionalTime(row.LastUsedAt),
		BackedUp:   row.BackedUp,
	}
}

// adminRelyingParty is the console's relying party for the tenant an actor
// belongs to.
func (s *adminServer) adminRelyingParty(ctx context.Context, tenant dbmodels.Tenant) (*tenantwebauthn.RelyingParty, error) {
	rp, err := tenantwebauthn.AdminConsole(tenant)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the console's relying party", err, "tenant_id", tenant.ID.String())
	}
	return rp, nil
}

// passkeyUser is the account a ceremony is for, with the credentials it holds
// for rp.
func (s *adminServer) passkeyUser(ctx context.Context, rp *tenantwebauthn.RelyingParty, user dbmodels.User) (tenantwebauthn.User, error) {
	credentials, err := s.queriesFor(ctx).ListUserWebauthnCredentialsForRPID(ctx, dbmodels.ListUserWebauthnCredentialsForRPIDParams{
		UserID: user.ID,
		RpID:   rp.ID,
	})
	if err != nil {
		return tenantwebauthn.User{}, s.internalDBError(ctx, "failed to list passkeys", err, "user_id", user.ID.String())
	}
	displayName := strings.TrimSpace(user.Name)
	if displayName == "" {
		displayName = user.Email
	}
	return tenantwebauthn.User{
		Handle:      tenantwebauthn.UserHandle(user.PublicID),
		Name:        user.Email,
		DisplayName: displayName,
		Credentials: credentials,
	}, nil
}

// startCeremony keeps the server's half of a ceremony until its finish.
func (s *adminServer) startCeremony(ctx context.Context, actor mfaActor, kind string, ceremony tenantwebauthn.Ceremony) error {
	if err := s.queriesFor(ctx).StartUserWebauthnCeremony(ctx, dbmodels.StartUserWebauthnCeremonyParams{
		MaxOpen:   passkeyOpenCeremonies,
		Challenge: ceremony.Challenge,
		TenantID:  actor.Tenant.ID,
		UserID:    actor.User.ID,
		Ceremony:  kind,
		RpID:      ceremony.RPID,
		ExpiresAt: ceremony.ExpiresAt,
	}); err != nil {
		return s.internalDBError(ctx, "failed to store the passkey ceremony", err, "user_id", actor.User.ID.String())
	}
	return nil
}

// spendCeremony claims the ceremony a response was made over. found is false
// for a challenge the server never issued to this account, or one already
// spent.
func (s *adminServer) spendCeremony(ctx context.Context, actor mfaActor, kind, challenge string) (ceremony tenantwebauthn.Ceremony, found bool, err error) {
	row, err := s.queriesFor(ctx).SpendUserWebauthnCeremony(ctx, dbmodels.SpendUserWebauthnCeremonyParams{
		Challenge: challenge,
		UserID:    actor.User.ID,
		Ceremony:  kind,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return tenantwebauthn.Ceremony{}, false, nil
		}
		return tenantwebauthn.Ceremony{}, false, s.internalDBError(ctx, "failed to spend the passkey ceremony", err, "user_id", actor.User.ID.String())
	}
	return tenantwebauthn.Ceremony{Challenge: row.Challenge, RPID: row.RpID, ExpiresAt: row.ExpiresAt}, true, nil
}

func (s *adminServer) BeginPasskeyRegistration(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest,
) (*publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationResponse, error) {
	actor, err := s.mfaActorFor(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx), req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	rp, err := s.adminRelyingParty(ctx, actor.Tenant)
	if err != nil {
		return nil, err
	}
	user, err := s.passkeyUser(ctx, rp, actor.User)
	if err != nil {
		return nil, err
	}
	options, ceremony, err := rp.BeginRegistration(user)
	if err != nil {
		return nil, s.internalError(ctx, "failed to begin passkey registration", err, "user_id", actor.User.ID.String())
	}
	if err := s.startCeremony(ctx, actor, tenantwebauthn.CeremonyRegistration, ceremony); err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationResponse{CreationOptionsJson: string(options)}, nil
}

func (s *adminServer) FinishPasskeyRegistration(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest,
) (*publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationResponse, error) {
	actor, err := s.mfaActorFor(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx), req.ChallengeToken)
	if err != nil {
		return nil, err
	}
	name, err := normalizePasskeyName(req.Name)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.CredentialJson) == "" {
		return nil, passkeyCredentialRequiredError()
	}
	// Settled before anything is stored, as ConfirmMfaEnrollment does: the
	// recovery codes this call may issue exist only in its response.
	if actor.FromChallenge && s.tokens == nil {
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "token_manager_unavailable")
		return nil, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}
	rp, err := s.adminRelyingParty(ctx, actor.Tenant)
	if err != nil {
		return nil, err
	}

	parsed, challenge, err := tenantwebauthn.ParseRegistration([]byte(req.CredentialJson))
	if err != nil {
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "credential_malformed")
		return nil, passkeyRegistrationRefusedError()
	}
	ceremony, found, err := s.spendCeremony(ctx, actor, tenantwebauthn.CeremonyRegistration, challenge)
	if err != nil {
		return nil, err
	}
	if !found {
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "ceremony_unknown")
		return nil, passkeyRegistrationRefusedError()
	}
	user, err := s.passkeyUser(ctx, rp, actor.User)
	if err != nil {
		return nil, err
	}
	credential, err := rp.FinishRegistration(user, ceremony, parsed)
	if err != nil {
		reason := "credential_invalid"
		if errors.Is(err, tenantwebauthn.ErrCeremonyMismatch) {
			reason = "ceremony_expired"
		}
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, reason)
		return nil, passkeyRegistrationRefusedError()
	}

	row, codes, err := s.storePasskey(ctx, actor, rp, credential, name)
	switch {
	case errors.Is(err, errMfaChallengeSpent):
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "challenge_spent")
		return nil, invalidSessionError()
	case errors.Is(err, errMfaEnrollChallengeStale):
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "challenge_stale")
		return nil, invalidSessionError()
	case errors.Is(err, errPasskeyAlreadyRegistered):
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "already_registered")
		return nil, connect.NewError(connect.CodeAlreadyExists, "passkey is already registered")
	case err != nil:
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeFailure, "store_failed")
		return nil, err
	}

	resp := &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationResponse{
		Passkey:       passkeyProto(row),
		RecoveryCodes: codes,
	}
	reason := ""
	if actor.FromChallenge {
		user, accessToken, sessionErr := s.issueAdminSession(ctx, actor)
		if sessionErr == nil {
			resp.User = user
			resp.AccessToken = accessToken
		} else {
			// As in ConfirmMfaEnrollment: the passkey is stored and the codes
			// are the only copy there will be, so they are answered without a
			// session rather than thrown away with an error.
			reason = "session_issue_failed"
		}
	}
	s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRegistered, auditlog.OutcomeSuccess, reason)
	return resp, nil
}

// errPasskeyAlreadyRegistered is a credential ID the tenant already holds. An
// exclusion list keeps an authenticator from creating one twice, so this is a
// response replayed into a second ceremony.
var errPasskeyAlreadyRegistered = errors.New("passkey already registered")

// storePasskey keeps a verified credential and, for an account that held no
// unused recovery code, issues the batch that stands in for its factors, in
// one transaction: a passkey without codes would leave an account that loses
// it with no way back in. A registration that finishes a login claims its
// challenge in the same transaction, as an enrollment does, so the token buys
// one session and is left unspent if the store rolls back.
func (s *adminServer) storePasskey(
	ctx context.Context,
	actor mfaActor,
	rp *tenantwebauthn.RelyingParty,
	credential *webauthn.Credential,
	name string,
) (dbmodels.UserWebauthnCredential, []string, error) {
	userID := actor.User.ID.String()
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to begin passkey registration transaction", err, "user_id", userID)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	// The count of unused codes below decides whether this passkey brings a
	// batch of its own, so no removal of another factor may be half done
	// while it is read.
	if err := s.lockMfaFactors(ctx, q, actor.User.ID); err != nil {
		return dbmodels.UserWebauthnCredential{}, nil, err
	}
	if actor.FromChallenge {
		claimed, err := q.MarkUserMfaChallengeUsed(ctx, dbmodels.MarkUserMfaChallengeUsedParams{
			Jti:       actor.ChallengeID,
			TenantID:  actor.Tenant.ID,
			UserID:    actor.User.ID,
			ExpiresAt: actor.ChallengeExpiresAt,
		})
		if err != nil {
			return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to mark mfa challenge used", err, "user_id", userID)
		}
		if claimed == 0 {
			return dbmodels.UserWebauthnCredential{}, nil, errMfaChallengeSpent
		}
		// mfaActorFor checked this before the lock; a factor enrolled since,
		// under another login's enroll challenge, is seen here.
		totp, err := q.GetUserMfaTotpByUserID(ctx, actor.User.ID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to get user mfa totp", err, "user_id", userID)
		}
		passkeys, err := s.currentPasskeys(ctx, q, actor)
		if err != nil {
			return dbmodels.UserWebauthnCredential{}, nil, err
		}
		if totp.EnabledAt.Valid || passkeys > 0 {
			return dbmodels.UserWebauthnCredential{}, nil, errMfaEnrollChallengeStale
		}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, nil, s.internalError(ctx, "failed to generate passkey id", err, "user_id", userID)
	}
	row, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.UserWebauthnCredential, error) {
		return q.CreateUserWebauthnCredential(ctx, dbmodels.CreateUserWebauthnCredentialParams{
			ID:             id,
			PublicID:       publicID,
			TenantID:       actor.Tenant.ID,
			UserID:         actor.User.ID,
			RpID:           rp.ID,
			CredentialID:   credential.ID,
			PublicKey:      credential.PublicKey,
			SignCount:      int64(credential.Authenticator.SignCount),
			Aaguid:         tenantwebauthn.AAGUID(credential),
			Transports:     tenantwebauthn.Transports(credential),
			BackupEligible: credential.Flags.BackupEligible,
			BackedUp:       credential.Flags.BackupState,
			Name:           name,
		})
	})
	if err != nil {
		if dberr.UniqueViolationConstraint(err) == "user_webauthn_credentials_tenant_credential_id_key" {
			return dbmodels.UserWebauthnCredential{}, nil, errPasskeyAlreadyRegistered
		}
		return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to store passkey", err, "user_id", userID)
	}
	unused, err := q.CountUnusedUserMfaRecoveryCodes(ctx, actor.User.ID)
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to count mfa recovery codes", err, "user_id", userID)
	}
	var codes []string
	if unused == 0 {
		codes, err = replaceRecoveryCodes(ctx, q, actor.Tenant.ID, actor.User.ID)
		if err != nil {
			return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to create mfa recovery codes", err, "user_id", userID)
		}
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.UserWebauthnCredential{}, nil, s.internalDBError(ctx, "failed to commit passkey registration", err, "user_id", userID)
	}
	return row, codes, nil
}

func (s *adminServer) BeginPasskeyVerification(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceBeginPasskeyVerificationRequest,
) (*publiraadminv1.AdminAuthServiceBeginPasskeyVerificationResponse, error) {
	actor, err := s.actorFromChallenge(ctx, req.Tenant, req.ChallengeToken, auth.AudienceAdminMFAVerify)
	if err != nil {
		return nil, err
	}
	locked, err := s.mfaLocked(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if locked {
		return nil, mfaLockedError()
	}
	rp, err := s.adminRelyingParty(ctx, actor.Tenant)
	if err != nil {
		return nil, err
	}
	user, err := s.passkeyUser(ctx, rp, actor.User)
	if err != nil {
		return nil, err
	}
	if len(user.Credentials) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "no passkey is registered")
	}
	options, ceremony, err := rp.BeginAuthentication(user)
	if err != nil {
		return nil, s.internalError(ctx, "failed to begin passkey verification", err, "user_id", actor.User.ID.String())
	}
	if err := s.startCeremony(ctx, actor, tenantwebauthn.CeremonyAuthentication, ceremony); err != nil {
		return nil, err
	}
	return &publiraadminv1.AdminAuthServiceBeginPasskeyVerificationResponse{RequestOptionsJson: string(options)}, nil
}

func (s *adminServer) FinishPasskeyVerification(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceFinishPasskeyVerificationRequest,
) (*publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse, error) {
	actor, err := s.actorFromChallenge(ctx, req.Tenant, req.ChallengeToken, auth.AudienceAdminMFAVerify)
	if err != nil {
		auth.AuditEvent(ctx, "admin_mfa_verify", "failure", "", "", "invalid_challenge")
		return nil, err
	}
	refuse := func(reason string, err error) (*publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse, error) {
		s.recordMfaAudit(ctx, actor, auditActionMfaVerified, auditlog.OutcomeFailure, reason)
		auth.AuditEvent(ctx, "admin_mfa_verify", "failure", actor.Tenant.PublicID, actor.User.PublicID, reason)
		return nil, err
	}

	locked, err := s.mfaLocked(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	if locked {
		return refuse("locked", mfaLockedError())
	}
	if strings.TrimSpace(req.CredentialJson) == "" {
		return nil, passkeyCredentialRequiredError()
	}
	rp, err := s.adminRelyingParty(ctx, actor.Tenant)
	if err != nil {
		return nil, err
	}

	parsed, challenge, err := tenantwebauthn.ParseAssertion([]byte(req.CredentialJson))
	if err != nil {
		return refuse("credential_malformed", passkeyRefusedError())
	}
	ceremony, found, err := s.spendCeremony(ctx, actor, tenantwebauthn.CeremonyAuthentication, challenge)
	if err != nil {
		return nil, err
	}
	if !found {
		return refuse("ceremony_unknown", passkeyRefusedError())
	}
	user, err := s.passkeyUser(ctx, rp, actor.User)
	if err != nil {
		return nil, err
	}
	credential, err := rp.FinishAuthentication(user, ceremony, parsed)
	if err != nil {
		switch {
		case errors.Is(err, tenantwebauthn.ErrSignCountRegressed):
			return s.refusePasskeyAssertion(ctx, actor, refuse, "sign_count_regressed")
		case errors.Is(err, tenantwebauthn.ErrCeremonyMismatch):
			return s.refusePasskeyAssertion(ctx, actor, refuse, "ceremony_expired")
		default:
			return s.refusePasskeyAssertion(ctx, actor, refuse, "assertion_invalid")
		}
	}

	var used dbmodels.UserWebauthnCredential
	for _, row := range user.Credentials {
		if bytes.Equal(row.CredentialID, credential.ID) {
			used = row
			break
		}
	}
	claimed, err := s.queriesFor(ctx).MarkUserWebauthnCredentialUsed(ctx, dbmodels.MarkUserWebauthnCredentialUsedParams{
		ID:        used.ID,
		SignCount: int64(credential.Authenticator.SignCount),
		BackedUp:  credential.Flags.BackupState,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to mark passkey used", err, "user_id", actor.User.ID.String())
	}
	// The counter moved on between the read above and this write, so another
	// assertion with the same counter was accepted first.
	if claimed == 0 {
		return s.refusePasskeyAssertion(ctx, actor, refuse, "sign_count_regressed")
	}
	if err := s.resetMfaFailures(ctx, actor.User.ID); err != nil {
		return nil, err
	}

	spent, err := s.spendMfaChallenge(ctx, actor)
	if err != nil {
		return refuse("challenge_claim_failed", err)
	}
	if !spent {
		return refuse("challenge_spent", invalidSessionError())
	}

	sessionUser, accessToken, err := s.issueAdminSession(ctx, actor)
	if err != nil {
		return nil, err
	}
	remaining, err := s.remainingRecoveryCodes(ctx, actor.User.ID)
	if err != nil {
		return nil, err
	}
	s.recordMfaAudit(ctx, actor, auditActionMfaVerified, auditlog.OutcomeSuccess, "passkey")
	auth.AuditEvent(ctx, "admin_mfa_verify", "success", actor.Tenant.PublicID, actor.User.PublicID, "passkey")
	return &publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse{
		User:                   sessionUser,
		AccessToken:            accessToken,
		RemainingRecoveryCodes: remaining,
	}, nil
}

// refusePasskeyAssertion counts a refused assertion toward the lock a wrong
// code counts toward, and answers the error the client gets: the lock, when
// this was the attempt that started it.
//
// Only an assertion checked against a ceremony the account had open is
// counted. One that does not parse, or names a challenge with no open
// ceremony, could never have signed anyone in, so it guesses nothing; it is
// also what a ceremony spent or dropped in another tab looks like, and
// counting it would lock out an owner whose every assertion was genuine.
func (s *adminServer) refusePasskeyAssertion(
	ctx context.Context,
	actor mfaActor,
	refuse func(string, error) (*publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse, error),
	reason string,
) (*publiraadminv1.AdminAuthServiceFinishPasskeyVerificationResponse, error) {
	locked, err := s.countMfaFailure(ctx, actor)
	if err != nil {
		return nil, err
	}
	if locked {
		return refuse("locked", mfaLockedError())
	}
	return refuse(reason, passkeyRefusedError())
}

func (s *adminServer) ListPasskeys(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceListPasskeysRequest,
) (*publiraadminv1.AdminAuthServiceListPasskeysResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	rpID, err := s.adminRPID(ctx, tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListUserWebauthnCredentialsForRPID(ctx, dbmodels.ListUserWebauthnCredentialsForRPIDParams{
		UserID: user.ID,
		RpID:   rpID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list passkeys", err, "user_id", user.ID.String())
	}
	passkeys := make([]*publiraadminv1.Passkey, 0, len(rows))
	for _, row := range rows {
		passkeys = append(passkeys, passkeyProto(row))
	}
	return &publiraadminv1.AdminAuthServiceListPasskeysResponse{Passkeys: passkeys}, nil
}

// ownPasskey reads the passkey publicID names among the ones the account holds
// for the console. Another account's passkey, or one registered for another
// relying party ID, is not found.
func (s *adminServer) ownPasskey(ctx context.Context, tenant dbmodels.Tenant, userID uuid.UUID, publicID string) (dbmodels.UserWebauthnCredential, string, error) {
	publicID = strings.TrimSpace(publicID)
	if !publicid.Valid(publicID) {
		return dbmodels.UserWebauthnCredential{}, "", passkeyNotFoundError()
	}
	rpID, err := s.adminRPID(ctx, tenant)
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, "", err
	}
	row, err := s.queriesFor(ctx).GetUserWebauthnCredentialByPublicID(ctx, dbmodels.GetUserWebauthnCredentialByPublicIDParams{
		UserID:   userID,
		RpID:     rpID,
		PublicID: publicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.UserWebauthnCredential{}, "", passkeyNotFoundError()
		}
		return dbmodels.UserWebauthnCredential{}, "", s.internalDBError(ctx, "failed to get passkey", err, "user_id", userID.String())
	}
	return row, rpID, nil
}

func (s *adminServer) RenamePasskey(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceRenamePasskeyRequest,
) (*publiraadminv1.AdminAuthServiceRenamePasskeyResponse, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	actor := mfaActor{Tenant: tenant, User: user, Role: role}
	name, err := normalizePasskeyName(req.Name)
	if err != nil {
		return nil, err
	}
	row, _, err := s.ownPasskey(ctx, tenant, user.ID, req.Id)
	if err != nil {
		return nil, err
	}
	renamed, err := s.queriesFor(ctx).RenameUserWebauthnCredential(ctx, dbmodels.RenameUserWebauthnCredentialParams{
		ID:   row.ID,
		Name: name,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, passkeyNotFoundError()
		}
		return nil, s.internalDBError(ctx, "failed to rename passkey", err, "user_id", user.ID.String())
	}
	s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRenamed, auditlog.OutcomeSuccess, "")
	return &publiraadminv1.AdminAuthServiceRenamePasskeyResponse{Passkey: passkeyProto(renamed)}, nil
}

// errLastRequiredFactor refuses removing the second factor an account the
// policy requires one of cannot do without.
var errLastRequiredFactor = errors.New("last required second factor")

func (s *adminServer) DeletePasskey(
	ctx context.Context,
	req *publiraadminv1.AdminAuthServiceDeletePasskeyRequest,
) (*publiraadminv1.AdminAuthServiceDeletePasskeyResponse, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	actor := mfaActor{Tenant: tenant, User: user, Role: role}
	row, rpID, err := s.ownPasskey(ctx, tenant, user.ID, req.Id)
	if err != nil {
		return nil, err
	}
	required, err := s.mfaRequiredForRole(ctx, role)
	if err != nil {
		return nil, err
	}

	err = s.deletePasskey(ctx, user.ID, rpID, row.ID, required)
	switch {
	case errors.Is(err, errLastRequiredFactor):
		s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRemoved, auditlog.OutcomeFailure, "last_required_factor")
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the last second factor cannot be removed while two-step verification is required")
	case errors.Is(err, sql.ErrNoRows):
		return nil, passkeyNotFoundError()
	case err != nil:
		return nil, err
	}
	s.recordMfaAudit(ctx, actor, auditActionMfaPasskeyRemoved, auditlog.OutcomeSuccess, "")
	return &publiraadminv1.AdminAuthServiceDeletePasskeyResponse{}, nil
}

// deletePasskey removes one passkey, and with the account's last second
// factor the recovery codes that stood in for it, unless required keeps the
// account from going without one. The codes stay while the account still
// holds a passkey of another RP ID, which a later move of the console would
// make a factor again. The account's factors are locked first, so
// two removals racing over its last two cannot both find the other still
// there, and a factor added meanwhile is seen before the codes go.
func (s *adminServer) deletePasskey(ctx context.Context, userID uuid.UUID, rpID string, id uuid.UUID, required bool) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin passkey removal transaction", err, "user_id", userID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := s.lockMfaFactors(ctx, q, userID); err != nil {
		return err
	}
	deleted, err := q.DeleteUserWebauthnCredential(ctx, id)
	if err != nil {
		return s.internalDBError(ctx, "failed to delete passkey", err, "user_id", userID.String())
	}
	if deleted == 0 {
		return sql.ErrNoRows
	}
	remaining, err := q.CountUserWebauthnCredentialsForRPID(ctx, dbmodels.CountUserWebauthnCredentialsForRPIDParams{UserID: userID, RpID: rpID})
	if err != nil {
		return s.internalDBError(ctx, "failed to count passkeys", err, "user_id", userID.String())
	}
	if remaining == 0 {
		totp, err := q.GetUserMfaTotpByUserID(ctx, userID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return s.internalDBError(ctx, "failed to get user mfa totp", err, "user_id", userID.String())
		}
		if err != nil || !totp.EnabledAt.Valid {
			if required {
				return errLastRequiredFactor
			}
			if err := s.deleteRecoveryCodesWithTheLastFactor(ctx, q, userID); err != nil {
				return err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit passkey removal", err, "user_id", userID.String())
	}
	return nil
}

// deleteRecoveryCodesWithTheLastFactor deletes the account's recovery codes
// once nothing they could stand in for is left, counting a passkey of any RP
// ID. The caller holds lockMfaFactors and has already removed what it is
// removing.
func (s *adminServer) deleteRecoveryCodesWithTheLastFactor(ctx context.Context, q Querier, userID uuid.UUID) error {
	passkeys, err := q.CountUserWebauthnCredentials(ctx, userID)
	if err != nil {
		return s.internalDBError(ctx, "failed to count passkeys", err, "user_id", userID.String())
	}
	if passkeys > 0 {
		return nil
	}
	if err := q.DeleteUserMfaRecoveryCodesByUserID(ctx, userID); err != nil {
		return s.internalDBError(ctx, "failed to delete mfa recovery codes", err, "user_id", userID.String())
	}
	return nil
}
