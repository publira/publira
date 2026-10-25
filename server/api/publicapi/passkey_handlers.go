package publicapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// passkeyOpenCeremonies is how many ceremonies of one kind a reader may have
// open at once: enough for a few tabs or devices begun side by side, few
// enough that calling a begin over and over leaves next to nothing behind.
const passkeyOpenCeremonies = 5

// siteSignInOpenCeremonies is how many storefront sign-ins one origin may have
// open on a tenant at once. Every reader behind a shared address — a carrier's
// NAT, an office, a school — opens the sign-in page from the same origin, and
// each page begins one, so it is enough for a crowd of them within the few
// minutes a ceremony lasts. Beyond it the oldest is dropped, and a passkey
// presented to that page is refused as one presented after its ceremony
// expired.
const siteSignInOpenCeremonies = 100

// passkeyNameMaxLength bounds what a reader may call a passkey, in characters,
// as user_webauthn_credentials_name_check does.
const passkeyNameMaxLength = 64

// maxPasskeysPerAccount bounds the passkeys one reader may hold. A person
// keeps one per password manager or security key, which is a handful; the
// bound is there for a script registering software credentials one after
// another, each of which is a row nothing else would ever remove.
const maxPasskeysPerAccount = 20

// passkeyConfirmationField is the request field an assertion confirming
// DeleteMe or RequestEmailChange arrives in.
const passkeyConfirmationField = "passkey_credential_json"

// A refused sign-in assertion answers as a wrong password does.
func passkeyLoginRefusedError() error {
	return connect.NewError(connect.CodeUnauthenticated, "invalid credentials")
}

// A registration the authenticator's response does not verify against is the
// request's fault rather than the caller's identity, so it is not
// `unauthenticated`, which a client would take for the end of its session.
func passkeyRegistrationRefusedError() error {
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("passkey refused"), "credential_json")
}

// A confirmation that does not verify is not `unauthenticated` either, as a
// wrong password confirming the same request is not.
func passkeyConfirmationRefusedError() error {
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("passkey refused"), passkeyConfirmationField)
}

func passkeyNotFoundError() error {
	return connect.NewError(connect.CodeNotFound, "passkey not found")
}

func passkeyCredentialRequiredError() error {
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("credential_json is required"), "credential_json")
}

func normalizePasskeyName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > passkeyNameMaxLength {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name is too long"), "name")
	}
	return name, nil
}

func passkeyProto(row dbmodels.UserWebauthnCredential) *publirav1.Passkey {
	passkey := &publirav1.Passkey{
		Id:        row.PublicID,
		Name:      row.Name,
		CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		BackedUp:  row.BackedUp,
	}
	if row.LastUsedAt.Valid {
		passkey.LastUsedAt = row.LastUsedAt.Time.UTC().Format(time.RFC3339)
	}
	return passkey
}

// siteRelyingParty is the storefront's relying party for tenant, which also
// accepts a ceremony made by the tenant's Android app.
func (s *apiServer) siteRelyingParty(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant) (*tenantwebauthn.RelyingParty, error) {
	config, err := q.GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to get the tenant's Android app", err, "tenant_id", tenant.ID.String())
	}
	// A tenant with no config row has no Android app, and no fingerprints.
	rp, err := tenantwebauthn.Site(tenant, config.AndroidSha256CertFingerprints)
	if err != nil {
		return nil, s.internalError(ctx, "failed to build the storefront's relying party", err, "tenant_id", tenant.ID.String())
	}
	return rp, nil
}

// passkeyUser is the account a ceremony is for, with the passkeys it holds for
// rp.
func (s *apiServer) passkeyUser(ctx context.Context, q dbmodels.Querier, rp *tenantwebauthn.RelyingParty, user dbmodels.User) (tenantwebauthn.User, error) {
	credentials, err := q.ListUserWebauthnCredentialsForRPID(ctx, dbmodels.ListUserWebauthnCredentialsForRPIDParams{
		UserID:       user.ID,
		RelyingParty: rp.Kind,
		RpID:         rp.ID,
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

// countSignInPasskeys counts the passkeys that sign userID in to the
// storefront as it is served now. A passkey registered while it was served on
// another host is left out: it answers no ceremony until the storefront moves
// back, so it is no way in.
func (s *apiServer) countSignInPasskeys(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant, userID uuid.UUID) (int64, error) {
	rpID, err := tenantwebauthn.SiteRPID(tenant)
	if err != nil {
		return 0, s.internalError(ctx, "failed to derive the storefront's relying party ID", err, "tenant_id", tenant.ID.String())
	}
	count, err := q.CountUserWebauthnCredentialsForRPID(ctx, dbmodels.CountUserWebauthnCredentialsForRPIDParams{
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindSite,
		RpID:         rpID,
	})
	if err != nil {
		return 0, s.internalDBError(ctx, "failed to count passkeys", err, "user_id", userID.String())
	}
	return count, nil
}

// startPasskeyCeremony keeps the server's half of a reader's ceremony until
// its finish, in a transaction of its own that holds the account's lock on
// ceremonies of that kind, so begins arriving together cannot each count the
// same open ceremonies and pass passkeyOpenCeremonies between them.
func (s *apiServer) startPasskeyCeremony(ctx context.Context, tenantID, userID uuid.UUID, kind string, ceremony tenantwebauthn.Ceremony) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin passkey ceremony transaction", err, "user_id", userID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := q.LockUserWebauthnCeremonies(ctx, dbmodels.LockUserWebauthnCeremoniesParams{
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindSite,
		Ceremony:     kind,
	}); err != nil {
		return s.internalDBError(ctx, "failed to lock passkey ceremonies", err, "user_id", userID.String())
	}
	if err := q.StartUserWebauthnCeremony(ctx, dbmodels.StartUserWebauthnCeremonyParams{
		MaxOpen:      passkeyOpenCeremonies,
		Challenge:    ceremony.Challenge,
		TenantID:     tenantID,
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindSite,
		Ceremony:     kind,
		RpID:         ceremony.RPID,
		ExpiresAt:    ceremony.ExpiresAt,
	}); err != nil {
		return s.internalDBError(ctx, "failed to store the passkey ceremony", err, "user_id", userID.String())
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit the passkey ceremony", err, "user_id", userID.String())
	}
	return nil
}

func ceremonyFromRow(row dbmodels.UserWebauthnCeremony) tenantwebauthn.Ceremony {
	return tenantwebauthn.Ceremony{Challenge: row.Challenge, RPID: row.RpID, ExpiresAt: row.ExpiresAt}
}

// BeginPasskeyLogin begins a sign-in that names no account. The ceremony it
// keeps belongs to the tenant until a credential names the account, so the
// per-account cap on open ceremonies cannot bound it; a cap on the ceremonies
// the request's origin has open on the tenant does.
//
// It charges none of the origin's sign-in allowance. The storefront begins one
// whenever its sign-in page opens, to offer the reader's passkeys in the
// browser's autofill before the reader has chosen anything, so most of them
// are never finished: charging each would refuse the password sign-ins of
// everyone behind a busy shared address once enough of them had looked at the
// page, though nobody had typed a wrong password. A begin is no guess either,
// since nothing is verified until the finish, and the finish spends the
// ceremony whatever it answers.
func (s *apiServer) BeginPasskeyLogin(
	ctx context.Context,
	req *publirav1.BeginPasskeyLoginRequest,
) (*publirav1.BeginPasskeyLoginResponse, error) {
	const action = "passkey_login_begin"
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(ctx, action, "failure", "", "", "tenant_not_found")
		return nil, err
	}
	rp, err := s.siteRelyingParty(ctx, s.queriesFor(ctx), tenant)
	if err != nil {
		return nil, err
	}
	options, ceremony, err := rp.BeginDiscoverableAuthentication()
	if err != nil {
		return nil, s.internalError(ctx, "failed to begin a passkey sign-in", err, "tenant_id", tenant.ID.String())
	}
	if err := s.startSiteSignInCeremony(ctx, tenant.ID, ceremony); err != nil {
		return nil, err
	}
	return &publirav1.BeginPasskeyLoginResponse{RequestOptionsJson: string(options)}, nil
}

// startSiteSignInCeremony keeps the server's half of a storefront sign-in
// until its finish, in a transaction of its own that holds the origin's lock
// on the tenant's sign-in ceremonies, so begins arriving together cannot each
// count the same open ceremonies and pass siteSignInOpenCeremonies between
// them.
func (s *apiServer) startSiteSignInCeremony(ctx context.Context, tenantID uuid.UUID, ceremony tenantwebauthn.Ceremony) error {
	source := signInSourceDigest(ctx)
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin passkey sign-in ceremony transaction", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := q.LockSiteSignInCeremonies(ctx, dbmodels.LockSiteSignInCeremoniesParams{
		TenantID:     tenantID,
		SourceDigest: source,
	}); err != nil {
		return s.internalDBError(ctx, "failed to lock passkey sign-in ceremonies", err, "tenant_id", tenantID.String())
	}
	if err := q.StartSiteSignInCeremony(ctx, dbmodels.StartSiteSignInCeremonyParams{
		MaxOpen:      siteSignInOpenCeremonies,
		Challenge:    ceremony.Challenge,
		TenantID:     tenantID,
		RpID:         ceremony.RPID,
		ExpiresAt:    ceremony.ExpiresAt,
		SourceDigest: source,
	}); err != nil {
		return s.internalDBError(ctx, "failed to store the passkey sign-in ceremony", err, "tenant_id", tenantID.String())
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit the passkey sign-in ceremony", err, "tenant_id", tenantID.String())
	}
	return nil
}

// signInSourceDigest is what a storefront sign-in ceremony keeps of the origin
// that began it: enough to count that origin's open ceremonies, without
// storing its address.
func signInSourceDigest(ctx context.Context) []byte {
	digest := sha256.Sum256([]byte(clientip.FromContext(ctx)))
	return digest[:]
}

// errPasskeyAccountLookup carries a failure reading the account a
// discoverable assertion names out of the verification, which reports every
// error of its lookup as a refused assertion.
type errPasskeyAccountLookup struct{ err error }

func (e errPasskeyAccountLookup) Error() string { return e.err.Error() }

// FinishPasskeyLogin signs the reader in whose passkey made the assertion.
// The ceremony is spent before the assertion is verified, so a refused one
// cannot be presented again; the credential is looked up within the tenant
// and the storefront's relying party ID, so another tenant's passkey and the
// console's are not found.
func (s *apiServer) FinishPasskeyLogin(
	ctx context.Context,
	req *publirav1.FinishPasskeyLoginRequest,
) (*publirav1.FinishPasskeyLoginResponse, error) {
	const action = "passkey_login"
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		auth.AuditEvent(ctx, action, "failure", "", "", "tenant_not_found")
		return nil, err
	}
	fail := func(userPublicID, reason string, err error) (*publirav1.FinishPasskeyLoginResponse, error) {
		auth.AuditEvent(ctx, action, "failure", tenant.PublicID, userPublicID, reason)
		return nil, err
	}
	if strings.TrimSpace(req.CredentialJson) == "" {
		return fail("", "invalid_input", passkeyCredentialRequiredError())
	}
	q := s.queriesFor(ctx)
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return fail("", "relying_party_failed", err)
	}
	parsed, challenge, err := tenantwebauthn.ParseAssertion([]byte(req.CredentialJson))
	if err != nil {
		return fail("", "credential_malformed", passkeyLoginRefusedError())
	}
	row, err := q.SpendSiteSignInCeremony(ctx, challenge)
	if errors.Is(err, sql.ErrNoRows) {
		return fail("", "ceremony_unknown", passkeyLoginRefusedError())
	}
	if err != nil {
		return fail("", "ceremony_spend_failed", s.internalDBError(ctx, "failed to spend the passkey sign-in ceremony", err, "tenant_id", tenant.ID.String()))
	}
	ceremony := ceremonyFromRow(row)

	var (
		stored  dbmodels.UserWebauthnCredential
		account dbmodels.User
	)
	credential, err := rp.FinishDiscoverableAuthentication(ceremony, parsed, func(credentialID, userHandle []byte) (tenantwebauthn.User, error) {
		var lookupErr error
		stored, lookupErr = q.GetUserWebauthnCredentialForSignIn(ctx, dbmodels.GetUserWebauthnCredentialForSignInParams{
			CredentialID: credentialID,
			RelyingParty: rp.Kind,
			RpID:         rp.ID,
		})
		if errors.Is(lookupErr, sql.ErrNoRows) {
			return tenantwebauthn.User{}, errors.New("unknown credential")
		}
		if lookupErr != nil {
			return tenantwebauthn.User{}, errPasskeyAccountLookup{lookupErr}
		}
		account, lookupErr = q.GetUserByID(ctx, stored.UserID)
		if lookupErr != nil {
			return tenantwebauthn.User{}, errPasskeyAccountLookup{lookupErr}
		}
		// The verification compares the handle with the account's too; the
		// lookup refuses a mismatch itself so the account it read is never
		// taken for the one the handle names.
		if !bytes.Equal(userHandle, tenantwebauthn.UserHandle(account.PublicID)) {
			return tenantwebauthn.User{}, errors.New("user handle mismatch")
		}
		credentials, lookupErr := q.ListUserWebauthnCredentialsForRPID(ctx, dbmodels.ListUserWebauthnCredentialsForRPIDParams{
			UserID:       account.ID,
			RelyingParty: rp.Kind,
			RpID:         rp.ID,
		})
		if lookupErr != nil {
			return tenantwebauthn.User{}, errPasskeyAccountLookup{lookupErr}
		}
		return tenantwebauthn.User{
			Handle:      tenantwebauthn.UserHandle(account.PublicID),
			Name:        account.Email,
			DisplayName: account.Name,
			Credentials: credentials,
		}, nil
	})
	if err != nil {
		var lookupErr errPasskeyAccountLookup
		switch {
		case errors.As(err, &lookupErr):
			return fail("", "account_lookup_failed", s.internalDBError(ctx, "failed to read the account a passkey names", lookupErr.err, "tenant_id", tenant.ID.String()))
		case errors.Is(err, tenantwebauthn.ErrSignCountRegressed):
			return fail(account.PublicID, "sign_count_regressed", passkeyLoginRefusedError())
		case errors.Is(err, tenantwebauthn.ErrCeremonyMismatch):
			return fail("", "ceremony_expired", passkeyLoginRefusedError())
		default:
			return fail(account.PublicID, "assertion_invalid", passkeyLoginRefusedError())
		}
	}
	claimed, err := q.MarkUserWebauthnCredentialUsed(ctx, dbmodels.MarkUserWebauthnCredentialUsedParams{
		ID:        stored.ID,
		SignCount: int64(credential.Authenticator.SignCount),
		BackedUp:  credential.Flags.BackupState,
	})
	if err != nil {
		return fail(account.PublicID, "mark_used_failed", s.internalDBError(ctx, "failed to mark passkey used", err, "user_id", account.ID.String()))
	}
	// The counter moved on between the read above and this write, so another
	// assertion with the same counter was accepted first.
	if claimed == 0 {
		return fail(account.PublicID, "sign_count_regressed", passkeyLoginRefusedError())
	}
	// Refused as Login refuses the same account once its password verifies. A
	// passkey is registered from a session, and every session began with an
	// address confirmed, so a holder of one has one too; but the passkey proves
	// only that the reader holds the authenticator, not that the address is
	// theirs, so it confirms nothing that has lost its confirmation since.
	if account.Status != "active" || !account.EmailVerifiedAt.Valid {
		return fail(account.PublicID, "email_not_verified", connect.NewError(connect.CodeFailedPrecondition, "email is not verified"))
	}
	role, err := s.tenantRole(ctx, account.ID)
	if err != nil {
		return fail(account.PublicID, "role_lookup_failed", err)
	}
	accessToken, err := s.mintAccessToken(tenant, account, role)
	if err != nil {
		return fail(account.PublicID, "token_issue_failed", err)
	}
	user, err := s.ownAccountWithIcon(ctx, q, tenant, account, role)
	if err != nil {
		return fail(account.PublicID, "icon_lookup_failed", err)
	}
	auth.AuditEvent(ctx, action, "success", tenant.PublicID, account.PublicID, "token_issued")
	return &publirav1.FinishPasskeyLoginResponse{User: user, AccessToken: accessToken}, nil
}

func (s *apiServer) BeginPasskeyRegistration(
	ctx context.Context,
	req *publirav1.BeginPasskeyRegistrationRequest,
) (*publirav1.BeginPasskeyRegistrationResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionPasskey, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	q := s.queriesFor(ctx)
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return nil, err
	}
	holder, err := s.passkeyUser(ctx, q, rp, user)
	if err != nil {
		return nil, err
	}
	if len(holder.Credentials) >= maxPasskeysPerAccount {
		return nil, passkeyLimitError()
	}
	options, ceremony, err := rp.BeginRegistration(holder)
	if err != nil {
		return nil, s.internalError(ctx, "failed to begin passkey registration", err, "user_id", user.ID.String())
	}
	if err := s.startPasskeyCeremony(ctx, tenant.ID, user.ID, tenantwebauthn.CeremonyRegistration, ceremony); err != nil {
		return nil, err
	}
	return &publirav1.BeginPasskeyRegistrationResponse{CreationOptionsJson: string(options)}, nil
}

func passkeyLimitError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "the account holds as many passkeys as it may")
}

// errPasskeyAlreadyRegistered is a credential ID the tenant already holds. An
// exclusion list keeps an authenticator from creating one twice, so this is a
// response replayed into a second ceremony.
var errPasskeyAlreadyRegistered = errors.New("passkey already registered")

func (s *apiServer) FinishPasskeyRegistration(
	ctx context.Context,
	req *publirav1.FinishPasskeyRegistrationRequest,
) (*publirav1.FinishPasskeyRegistrationResponse, error) {
	const action = "passkey_register"
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		auth.AuditEvent(ctx, action, "failure", "", "", "invalid_session")
		return nil, err
	}
	fail := func(reason string, err error) (*publirav1.FinishPasskeyRegistrationResponse, error) {
		auth.AuditEvent(ctx, action, "failure", tenant.PublicID, user.PublicID, reason)
		return nil, err
	}
	name, err := normalizePasskeyName(req.Name)
	if err != nil {
		return fail("invalid_input", err)
	}
	if strings.TrimSpace(req.CredentialJson) == "" {
		return fail("invalid_input", passkeyCredentialRequiredError())
	}
	q := s.queriesFor(ctx)
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return fail("relying_party_failed", err)
	}
	parsed, challenge, err := tenantwebauthn.ParseRegistration([]byte(req.CredentialJson))
	if err != nil {
		return fail("credential_malformed", passkeyRegistrationRefusedError())
	}
	row, err := q.SpendUserWebauthnCeremony(ctx, dbmodels.SpendUserWebauthnCeremonyParams{
		Challenge:    challenge,
		UserID:       user.ID,
		RelyingParty: tenantwebauthn.KindSite,
		Ceremony:     tenantwebauthn.CeremonyRegistration,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return fail("ceremony_unknown", passkeyRegistrationRefusedError())
	}
	if err != nil {
		return fail("ceremony_spend_failed", s.internalDBError(ctx, "failed to spend the passkey ceremony", err, "user_id", user.ID.String()))
	}
	holder, err := s.passkeyUser(ctx, q, rp, user)
	if err != nil {
		return fail("passkey_lookup_failed", err)
	}
	credential, err := rp.FinishRegistration(holder, ceremonyFromRow(row), parsed)
	if err != nil {
		reason := "credential_invalid"
		if errors.Is(err, tenantwebauthn.ErrCeremonyMismatch) {
			reason = "ceremony_expired"
		}
		return fail(reason, passkeyRegistrationRefusedError())
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return fail("transaction_begin_failed", s.internalDBError(ctx, "failed to begin passkey registration transaction", err, "user_id", user.ID.String()))
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)
	// Locked so the count below holds until the passkey is written, and so a
	// suspension or an account closed since the session was checked is seen.
	locked, err := txq.GetUserByIDForUpdate(ctx, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return fail("account_gone", invalidSessionError())
	}
	if err != nil {
		return fail("user_lock_failed", s.internalDBError(ctx, "failed to lock the account for a passkey registration", err, "user_id", user.ID.String()))
	}
	if locked.Status != "active" {
		return fail("account_not_active", invalidSessionError())
	}
	held, err := txq.CountUserWebauthnCredentialsForRPID(ctx, dbmodels.CountUserWebauthnCredentialsForRPIDParams{
		UserID:       user.ID,
		RelyingParty: rp.Kind,
		RpID:         rp.ID,
	})
	if err != nil {
		return fail("passkey_count_failed", s.internalDBError(ctx, "failed to count passkeys", err, "user_id", user.ID.String()))
	}
	if held >= maxPasskeysPerAccount {
		return fail("passkey_limit", passkeyLimitError())
	}
	id, err := uuid.NewV7()
	if err != nil {
		return fail("passkey_id_failed", s.internalError(ctx, "failed to generate passkey id", err, "user_id", user.ID.String()))
	}
	stored, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.UserWebauthnCredential, error) {
		return txq.CreateUserWebauthnCredential(ctx, dbmodels.CreateUserWebauthnCredentialParams{
			ID:             id,
			PublicID:       publicID,
			TenantID:       tenant.ID,
			UserID:         user.ID,
			RelyingParty:   rp.Kind,
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
	if dberr.UniqueViolationConstraint(err) == "user_webauthn_credentials_tenant_credential_id_key" {
		return fail("already_registered", connect.NewError(connect.CodeAlreadyExists, errPasskeyAlreadyRegistered.Error()))
	}
	if err != nil {
		return fail("store_failed", s.internalDBError(ctx, "failed to store passkey", err, "user_id", user.ID.String()))
	}
	if err := tx.Commit(); err != nil {
		return fail("transaction_commit_failed", s.internalDBError(ctx, "failed to commit passkey registration", err, "user_id", user.ID.String()))
	}
	auth.AuditEvent(ctx, action, "success", tenant.PublicID, user.PublicID, "passkey_registered")
	return &publirav1.FinishPasskeyRegistrationResponse{Passkey: passkeyProto(stored)}, nil
}

func (s *apiServer) ListMyPasskeys(
	ctx context.Context,
	req *publirav1.ListMyPasskeysRequest,
) (*publirav1.ListMyPasskeysResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	q := s.queriesFor(ctx)
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return nil, err
	}
	holder, err := s.passkeyUser(ctx, q, rp, user)
	if err != nil {
		return nil, err
	}
	passkeys := make([]*publirav1.Passkey, 0, len(holder.Credentials))
	for _, row := range holder.Credentials {
		passkeys = append(passkeys, passkeyProto(row))
	}
	return &publirav1.ListMyPasskeysResponse{Passkeys: passkeys}, nil
}

// ownPasskey reads the passkey publicID names among the ones userID holds for
// the storefront as it is served now. Another reader's passkey, a console
// passkey, and one registered for another relying party ID are not found.
func (s *apiServer) ownPasskey(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant, userID uuid.UUID, publicID string) (dbmodels.UserWebauthnCredential, error) {
	publicID = strings.TrimSpace(publicID)
	if !publicid.Valid(publicID) {
		return dbmodels.UserWebauthnCredential{}, passkeyNotFoundError()
	}
	rpID, err := tenantwebauthn.SiteRPID(tenant)
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, s.internalError(ctx, "failed to derive the storefront's relying party ID", err, "tenant_id", tenant.ID.String())
	}
	row, err := q.GetUserWebauthnCredentialByPublicID(ctx, dbmodels.GetUserWebauthnCredentialByPublicIDParams{
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindSite,
		RpID:         rpID,
		PublicID:     publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.UserWebauthnCredential{}, passkeyNotFoundError()
	}
	if err != nil {
		return dbmodels.UserWebauthnCredential{}, s.internalDBError(ctx, "failed to get passkey", err, "user_id", userID.String())
	}
	return row, nil
}

func (s *apiServer) RenamePasskey(
	ctx context.Context,
	req *publirav1.RenamePasskeyRequest,
) (*publirav1.RenamePasskeyResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	name, err := normalizePasskeyName(req.Name)
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionPasskey, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	q := s.queriesFor(ctx)
	row, err := s.ownPasskey(ctx, q, tenant, user.ID, req.Id)
	if err != nil {
		return nil, err
	}
	renamed, err := q.RenameUserWebauthnCredential(ctx, dbmodels.RenameUserWebauthnCredentialParams{
		ID:   row.ID,
		Name: name,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, passkeyNotFoundError()
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to rename passkey", err, "user_id", user.ID.String())
	}
	return &publirav1.RenamePasskeyResponse{Passkey: passkeyProto(renamed)}, nil
}

// DeletePasskey removes one of the reader's passkeys, unless it is the last
// way an account without a password signs in. That is the rule UnlinkIdentity
// applies to a linked provider, extended to passkeys, and both take the
// account row's lock, so an unlink and a removal racing over the account's
// last two ways in cannot each find the other still there.
func (s *apiServer) DeletePasskey(
	ctx context.Context,
	req *publirav1.DeletePasskeyRequest,
) (*publirav1.DeletePasskeyResponse, error) {
	const action = "passkey_delete"
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		auth.AuditEvent(ctx, action, "failure", "", "", "invalid_session")
		return nil, err
	}
	fail := func(reason string, err error) (*publirav1.DeletePasskeyResponse, error) {
		auth.AuditEvent(ctx, action, "failure", tenant.PublicID, user.PublicID, reason)
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionPasskey, tenant.ID, user.ID); err != nil {
		return fail("rate_limited", err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return fail("transaction_begin_failed", s.internalDBError(ctx, "failed to begin passkey removal transaction", err, "user_id", user.ID.String()))
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	locked, err := txq.GetUserByIDForUpdate(ctx, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return fail("account_gone", invalidSessionError())
	}
	if err != nil {
		return fail("user_lock_failed", s.internalDBError(ctx, "failed to lock the account for a passkey removal", err, "user_id", user.ID.String()))
	}
	row, err := s.ownPasskey(ctx, txq, tenant, user.ID, req.Id)
	if connect.CodeOf(err) == connect.CodeNotFound {
		return fail("not_found", err)
	}
	if err != nil {
		return fail("passkey_lookup_failed", err)
	}
	if !locked.PasswordHash.Valid {
		lastWayIn, err := s.isLastSignInPasskey(ctx, txq, tenant, user.ID)
		if err != nil {
			return fail("sign_in_method_lookup_failed", err)
		}
		if lastWayIn {
			return fail("last_sign_in_method", connect.NewError(connect.CodeFailedPrecondition, "the account has no password, so it keeps its last passkey"))
		}
	}
	if _, err := txq.DeleteUserWebauthnCredential(ctx, row.ID); err != nil {
		return fail("delete_failed", s.internalDBError(ctx, "failed to delete passkey", err, "user_id", user.ID.String()))
	}
	if err := tx.Commit(); err != nil {
		return fail("transaction_commit_failed", s.internalDBError(ctx, "failed to commit passkey removal", err, "user_id", user.ID.String()))
	}
	auth.AuditEvent(ctx, action, "success", tenant.PublicID, user.PublicID, "passkey_removed")
	return &publirav1.DeletePasskeyResponse{}, nil
}

// isLastSignInPasskey reports whether, besides a password the caller has
// found the account without, the one passkey being removed is all that signs
// it in: no provider is linked and it holds no other passkey the storefront
// accepts now.
func (s *apiServer) isLastSignInPasskey(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant, userID uuid.UUID) (bool, error) {
	identities, err := q.ListUserIdentitiesForUser(ctx, dbmodels.ListUserIdentitiesForUserParams{
		TenantID: tenant.ID,
		UserID:   userID,
	})
	if err != nil {
		return false, s.internalDBError(ctx, "failed to list linked identities", err, "user_id", userID.String())
	}
	if len(identities) > 0 {
		return false, nil
	}
	passkeys, err := s.countSignInPasskeys(ctx, q, tenant, userID)
	if err != nil {
		return false, err
	}
	return passkeys <= 1, nil
}

// BeginPasskeyConfirmation begins the assertion that confirms DeleteMe or
// RequestEmailChange in place of a password, allowing the caller's own
// passkeys alone.
func (s *apiServer) BeginPasskeyConfirmation(
	ctx context.Context,
	req *publirav1.BeginPasskeyConfirmationRequest,
) (*publirav1.BeginPasskeyConfirmationResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	if err := s.chargeReaderAction(ctx, actionPasskey, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	q := s.queriesFor(ctx)
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return nil, err
	}
	holder, err := s.passkeyUser(ctx, q, rp, user)
	if err != nil {
		return nil, err
	}
	if len(holder.Credentials) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "no passkey is registered")
	}
	options, ceremony, err := rp.BeginAuthentication(holder)
	if err != nil {
		return nil, s.internalError(ctx, "failed to begin a passkey confirmation", err, "user_id", user.ID.String())
	}
	if err := s.startPasskeyCeremony(ctx, tenant.ID, user.ID, tenantwebauthn.CeremonyAuthentication, ceremony); err != nil {
		return nil, err
	}
	return &publirav1.BeginPasskeyConfirmationResponse{RequestOptionsJson: string(options)}, nil
}

// passkeyConfirmation is an assertion verifyPasskeyConfirmation accepted, for
// spendPasskeyConfirmation to spend.
type passkeyConfirmation struct {
	challenge string
	passkeyID uuid.UUID
	signCount int64
	backedUp  bool
}

// verifyPasskeyConfirmation checks an assertion over a ceremony
// BeginPasskeyConfirmation began for the account, without writing anything.
func (s *apiServer) verifyPasskeyConfirmation(
	ctx context.Context,
	q dbmodels.Querier,
	tenant dbmodels.Tenant,
	user dbmodels.User,
	credentialJSON string,
) (passkeyConfirmation, error) {
	rp, err := s.siteRelyingParty(ctx, q, tenant)
	if err != nil {
		return passkeyConfirmation{}, err
	}
	parsed, challenge, err := tenantwebauthn.ParseAssertion([]byte(credentialJSON))
	if err != nil {
		return passkeyConfirmation{}, passkeyConfirmationRefusedError()
	}
	row, err := q.GetUserWebauthnCeremony(ctx, dbmodels.GetUserWebauthnCeremonyParams{
		Challenge:    challenge,
		UserID:       user.ID,
		RelyingParty: rp.Kind,
		Ceremony:     tenantwebauthn.CeremonyAuthentication,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return passkeyConfirmation{}, passkeyConfirmationRefusedError()
	}
	if err != nil {
		return passkeyConfirmation{}, s.internalDBError(ctx, "failed to read the passkey ceremony", err, "user_id", user.ID.String())
	}
	holder, err := s.passkeyUser(ctx, q, rp, user)
	if err != nil {
		return passkeyConfirmation{}, err
	}
	credential, err := rp.FinishAuthentication(holder, ceremonyFromRow(row), parsed)
	if err != nil {
		return passkeyConfirmation{}, passkeyConfirmationRefusedError()
	}
	for _, stored := range holder.Credentials {
		if bytes.Equal(stored.CredentialID, credential.ID) {
			return passkeyConfirmation{
				challenge: row.Challenge,
				passkeyID: stored.ID,
				signCount: int64(credential.Authenticator.SignCount),
				backedUp:  credential.Flags.BackupState,
			}, nil
		}
	}
	return passkeyConfirmation{}, passkeyConfirmationRefusedError()
}

// spendPasskeyConfirmation spends the ceremony of an assertion
// verifyPasskeyConfirmation accepted and advances its passkey's counter, on
// queries, so the same assertion confirms one request.
func (s *apiServer) spendPasskeyConfirmation(ctx context.Context, q dbmodels.Querier, userID uuid.UUID, confirmation passkeyConfirmation) error {
	_, err := q.SpendUserWebauthnCeremony(ctx, dbmodels.SpendUserWebauthnCeremonyParams{
		Challenge:    confirmation.challenge,
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindSite,
		Ceremony:     tenantwebauthn.CeremonyAuthentication,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return passkeyConfirmationRefusedError()
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to spend the passkey ceremony", err, "user_id", userID.String())
	}
	claimed, err := q.MarkUserWebauthnCredentialUsed(ctx, dbmodels.MarkUserWebauthnCredentialUsedParams{
		ID:        confirmation.passkeyID,
		SignCount: confirmation.signCount,
		BackedUp:  confirmation.backedUp,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to mark passkey used", err, "user_id", userID.String())
	}
	if claimed == 0 {
		return passkeyConfirmationRefusedError()
	}
	return nil
}

// confirmWithPasskey checks the assertion an account confirms a step with and
// spends it on queries.
func (s *apiServer) confirmWithPasskey(ctx context.Context, q dbmodels.Querier, tenant dbmodels.Tenant, user dbmodels.User, credentialJSON string) error {
	confirmation, err := s.verifyPasskeyConfirmation(ctx, q, tenant, user, credentialJSON)
	if err != nil {
		return err
	}
	return s.spendPasskeyConfirmation(ctx, q, user.ID, confirmation)
}
