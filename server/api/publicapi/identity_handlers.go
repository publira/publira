package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/signin"
)

// maxAccountNameRunes is the longest name UpdateMe accepts, which a name taken
// from a provider is cut to.
const maxAccountNameRunes = 100

// idTokenVerifier checks the ID tokens a reader signs in with.
type idTokenVerifier interface {
	Verify(ctx context.Context, provider, rawToken string, audiences []string, nonce string) (signin.Claims, error)
}

func identityProviderFromProto(provider publirav1.IdentityProvider) (string, error) {
	switch provider {
	case publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE:
		return signin.ProviderApple, nil
	case publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE:
		return signin.ProviderGoogle, nil
	default:
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("provider must be apple or google"), "provider")
	}
}

func identityProviderToProto(provider string) publirav1.IdentityProvider {
	switch provider {
	case signin.ProviderApple:
		return publirav1.IdentityProvider_IDENTITY_PROVIDER_APPLE
	case signin.ProviderGoogle:
		return publirav1.IdentityProvider_IDENTITY_PROVIDER_GOOGLE
	default:
		return publirav1.IdentityProvider_IDENTITY_PROVIDER_UNSPECIFIED
	}
}

// signInAudiences are the client IDs a provider's token has to be issued to.
// enabledOnly leaves out a provider the tenant has not enabled, which a
// sign-in refuses; a reader who signed up through it still confirms with it.
func signInAudiences(cfg signin.Config, provider string, enabledOnly bool) []string {
	switch provider {
	case signin.ProviderApple:
		if enabledOnly && !cfg.Apple.Ready {
			return nil
		}
		return cfg.Apple.Audiences()
	case signin.ProviderGoogle:
		if enabledOnly && !cfg.Google.Ready {
			return nil
		}
		return cfg.Google.Audiences()
	default:
		return nil
	}
}

// verifyIDToken checks a token against the tenant's clients for provider.
func (s *apiServer) verifyIDToken(ctx context.Context, tenantID uuid.UUID, provider, rawToken, nonce string, enabledOnly bool) (signin.Claims, error) {
	cfg, err := signin.NewSettings(s.queriesFor(ctx), s.encryptor).Get(ctx, tenantID)
	if err != nil {
		return signin.Claims{}, s.internalDBError(ctx, "failed to read the tenant sign-in settings", err, "tenant_id", tenantID.String())
	}
	audiences := signInAudiences(cfg, provider, enabledOnly)
	if len(audiences) == 0 {
		return signin.Claims{}, connect.NewError(connect.CodeFailedPrecondition, errors.New("the tenant does not sign readers in with this provider"))
	}
	claims, err := s.idTokens.Verify(ctx, provider, rawToken, audiences, nonce)
	if errors.Is(err, signin.ErrKeysUnavailable) {
		return signin.Claims{}, connect.NewError(connect.CodeUnavailable, errors.New("the provider cannot be reached"))
	}
	if err != nil {
		return signin.Claims{}, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid ID token"))
	}
	return claims, nil
}

// spendNonce records the sign-in's nonce as used, in the transaction that
// acts on its token, and refuses one that was used already.
func spendNonce(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, nonce string, claims signin.Claims) error {
	spent, err := queries.SpendSignInNonce(ctx, dbmodels.SpendSignInNonceParams{
		TenantID:  tenantID,
		NonceHash: signin.HashNonce(nonce),
		ExpiresAt: claims.AcceptedUntil,
	})
	if err != nil {
		return err
	}
	if spent == 0 {
		return errNonceReplayed
	}
	return nil
}

var errNonceReplayed = connect.NewError(connect.CodeUnauthenticated, errors.New("the nonce was used already"))

func (s *apiServer) LoginWithIdToken(
	ctx context.Context,
	req *connect.Request[publirav1.LoginWithIdTokenRequest],
) (*connect.Response[publirav1.LoginWithIdTokenResponse], error) {
	const action = "login_with_id_token"
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		auth.AuditEvent(req.Header(), action, "failure", "", "", "tenant_not_found")
		return nil, err
	}
	fail := func(userPublicID, reason string, err error) (*connect.Response[publirav1.LoginWithIdTokenResponse], error) {
		auth.AuditEvent(req.Header(), action, "failure", tenant.PublicID, userPublicID, reason)
		return nil, err
	}

	provider, err := identityProviderFromProto(req.Msg.Provider)
	if err != nil {
		return fail("", "invalid_provider", err)
	}
	rawToken := strings.TrimSpace(req.Msg.IdToken)
	nonce := req.Msg.Nonce
	if rawToken == "" || strings.TrimSpace(nonce) == "" {
		return fail("", "invalid_input", connect.NewError(connect.CodeInvalidArgument, errors.New("id_token and nonce are required")))
	}
	code := strings.TrimSpace(req.Msg.AuthorizationCode)
	if code != "" && provider != signin.ProviderApple {
		return fail("", "invalid_input", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("only an Apple sign-in carries an authorization code"), "authorization_code"))
	}

	claims, err := s.verifyIDToken(ctx, tenant.ID, provider, rawToken, nonce, true)
	if err != nil {
		reason := "invalid_token"
		switch connect.CodeOf(err) {
		case connect.CodeFailedPrecondition:
			reason = "provider_disabled"
		case connect.CodeUnavailable:
			reason = "provider_keys_unavailable"
		case connect.CodeInternal:
			reason = "settings_lookup_failed"
		}
		return fail("", reason, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return fail("", "transaction_begin_failed", s.internalDBError(ctx, "failed to begin id token sign-in transaction", err, "tenant_id", tenant.ID.String()))
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	signedIn, err := s.resolveSignIn(ctx, tx, txq, tenant, provider, claims, req.Msg)
	if err != nil {
		var refused signInRefusal
		if errors.As(err, &refused) {
			return fail(signedIn.user.PublicID, refused.reason, refused.err)
		}
		return fail(signedIn.user.PublicID, "account_resolution_failed", s.internalDBError(ctx, "failed to resolve the account of an id token sign-in", err, "tenant_id", tenant.ID.String()))
	}
	user := signedIn.user
	if user.Status != "active" {
		return fail(user.PublicID, "account_not_active", connect.NewError(connect.CodeFailedPrecondition, errors.New("the account is suspended")))
	}

	// Spent after every refusal above, so a reader asked for a consent they had
	// not given can send the same token again.
	if err := spendNonce(ctx, txq, tenant.ID, nonce, claims); err != nil {
		if errors.Is(err, errNonceReplayed) {
			return fail(user.PublicID, "nonce_replayed", err)
		}
		return fail(user.PublicID, "nonce_spend_failed", s.internalDBError(ctx, "failed to spend the sign-in nonce", err, "tenant_id", tenant.ID.String()))
	}
	if code != "" && !signedIn.identity.RefreshTokenEncrypted.Valid {
		if err := outbox.QueueAppleSignInCodeExchange(ctx, txq, s.encryptor, tenant.ID, signedIn.identity.ID,
			signin.HashNonce(nonce), claims.Audience, code, strings.TrimSpace(req.Msg.RedirectUri)); err != nil {
			return fail(user.PublicID, "code_exchange_enqueue_failed", s.internalError(ctx, "failed to queue the apple code exchange", err, "tenant_id", tenant.ID.String()))
		}
	}

	roles, err := txq.ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return fail(user.PublicID, "role_lookup_failed", s.internalDBError(ctx, "failed to list tenant user roles", err, "user_id", user.ID.String()))
	}
	role := auth.ResolveTenantRole(roles)
	accessToken, err := s.mintAccessToken(tenant, user, role)
	if err != nil {
		return fail(user.PublicID, "token_issue_failed", err)
	}
	if err := tx.Commit(); err != nil {
		return fail(user.PublicID, "transaction_commit_failed", s.internalDBError(ctx, "failed to commit id token sign-in", err, "tenant_id", tenant.ID.String()))
	}

	auth.AuditEvent(req.Header(), action, "success", tenant.PublicID, user.PublicID, signedIn.outcome)
	return connect.NewResponse(&publirav1.LoginWithIdTokenResponse{
		User:           ownAccount(user, role),
		AccessToken:    accessToken,
		AccountCreated: signedIn.outcome == "account_created",
	}), nil
}

type signInResult struct {
	user     dbmodels.User
	identity dbmodels.UserIdentity
	// outcome is what the audit entry records: token_issued for a link that
	// existed, identity_linked, or account_created.
	outcome string
}

// signInRefusal is an answer to the caller, with the reason the audit entry
// records for it.
type signInRefusal struct {
	reason string
	err    error
}

func (r signInRefusal) Error() string { return r.err.Error() }

func refuse(reason string, code connect.Code, message string) signInRefusal {
	return signInRefusal{reason: reason, err: connect.NewError(code, errors.New(message))}
}

// resolveSignIn finds the account a verified token signs in to: the one
// already linked to the provider account, else the one holding the address
// the provider vouches for, else a new one. The account row is locked.
func (s *apiServer) resolveSignIn(
	ctx context.Context,
	tx *sql.Tx,
	txq *dbmodels.Queries,
	tenant dbmodels.Tenant,
	provider string,
	claims signin.Claims,
	msg *publirav1.LoginWithIdTokenRequest,
) (signInResult, error) {
	identity, err := txq.GetUserIdentityByProviderSubject(ctx, dbmodels.GetUserIdentityByProviderSubjectParams{
		TenantID: tenant.ID,
		Provider: provider,
		Subject:  claims.Subject,
	})
	if err == nil {
		user, err := txq.GetUserByIDForUpdate(ctx, identity.UserID)
		if err != nil {
			return signInResult{}, err
		}
		return signInResult{user: user, identity: identity, outcome: "token_issued"}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return signInResult{}, err
	}

	// Refused before the address is looked up, so the answer says nothing
	// about which addresses hold accounts.
	if claims.Email == "" || !claims.EmailVerified {
		return signInResult{}, refuse("email_not_verified", connect.CodeFailedPrecondition, "the provider does not vouch for an email address")
	}

	result := signInResult{outcome: "identity_linked"}
	existing, err := txq.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Email:    claims.Email,
	})
	switch {
	case err == nil:
		result.user, err = s.linkExistingAccount(ctx, txq, tenant.ID, provider, existing.ID)
		if err != nil {
			return signInResult{user: existing}, err
		}
	case errors.Is(err, sql.ErrNoRows):
		result.user, err = s.createAccountForIdentity(ctx, tx, txq, tenant, claims, msg)
		if err != nil {
			return signInResult{}, err
		}
		result.outcome = "account_created"
	default:
		return signInResult{}, err
	}

	identityID, err := uuid.NewV7()
	if err != nil {
		return signInResult{}, err
	}
	result.identity, err = txq.CreateUserIdentity(ctx, dbmodels.CreateUserIdentityParams{
		ID:          identityID,
		TenantID:    tenant.ID,
		UserID:      result.user.ID,
		Provider:    provider,
		Subject:     claims.Subject,
		EmailAtLink: claims.Email,
	})
	if dberr.IsUniqueViolation(err) {
		return signInResult{}, refuse("concurrent_sign_in", connect.CodeAborted, "another sign-in is linking this account")
	}
	if err != nil {
		return signInResult{}, err
	}
	return result, nil
}

// linkExistingAccount locks the account holding the vouched-for address and
// makes it ready to take the link.
func (s *apiServer) linkExistingAccount(ctx context.Context, txq *dbmodels.Queries, tenantID uuid.UUID, provider string, userID uuid.UUID) (dbmodels.User, error) {
	user, err := txq.GetUserByIDForUpdate(ctx, userID)
	if err != nil {
		return dbmodels.User{}, err
	}
	_, err = txq.GetUserIdentityForUser(ctx, dbmodels.GetUserIdentityForUserParams{
		TenantID: tenantID,
		UserID:   user.ID,
		Provider: provider,
	})
	if err == nil {
		return user, refuse("linked_to_another_account", connect.CodeFailedPrecondition, "the account is linked to another account of this provider")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return user, err
	}
	if user.EmailVerifiedAt.Valid {
		return user, nil
	}
	// Nobody confirmed the address, so whoever registered it may not own it.
	return txq.TakeOverUnverifiedUserByID(ctx, user.ID)
}

// createAccountForIdentity creates the account a first sign-in stands for,
// with the address the provider vouched for already confirmed.
func (s *apiServer) createAccountForIdentity(
	ctx context.Context,
	tx *sql.Tx,
	txq *dbmodels.Queries,
	tenant dbmodels.Tenant,
	claims signin.Claims,
	msg *publirav1.LoginWithIdTokenRequest,
) (dbmodels.User, error) {
	name := strings.TrimSpace(msg.Name)
	if len([]rune(name)) > maxAccountNameRunes {
		return dbmodels.User{}, signInRefusal{reason: "name_too_long", err: rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name must be 100 characters or fewer"), "name")}
	}
	if name == "" {
		name = claims.Name
	}
	if name == "" {
		name, _, _ = strings.Cut(claims.Email, "@")
	}
	if runes := []rune(name); len(runes) > maxAccountNameRunes {
		name = string(runes[:maxAccountNameRunes])
	}

	var birthDate sql.NullTime
	if raw := strings.TrimSpace(msg.BirthDate); raw != "" {
		today, err := s.tenantToday(ctx, tenant)
		if err != nil {
			return dbmodels.User{}, signInRefusal{reason: "tenant_today_failed", err: s.internalError(ctx, "failed to resolve the tenant calendar day", err, "tenant_id", tenant.ID.String())}
		}
		parsed, err := ageverification.ParseBirthDate(raw, today)
		if err != nil {
			return dbmodels.User{}, signInRefusal{reason: "invalid_birth_date", err: rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "birth_date")}
		}
		birthDate = sql.NullTime{Time: parsed, Valid: true}
	}
	agreedVersionIDs, err := s.signupConsents(ctx, tenant, msg.AgreedPageVersionIds)
	if err != nil {
		reason := "consent_lookup_failed"
		if connect.CodeOf(err) == connect.CodeInvalidArgument {
			reason = "invalid_consent"
		}
		return dbmodels.User{}, signInRefusal{reason: reason, err: err}
	}

	userID, err := uuid.NewV7()
	if err != nil {
		return dbmodels.User{}, err
	}
	user, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.User, error) {
		return txq.CreateUser(ctx, dbmodels.CreateUserParams{
			ID:        userID,
			TenantID:  uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID:  publicID,
			Email:     claims.Email,
			Name:      name,
			BirthDate: birthDate,
		})
	})
	if dberr.IsUniqueViolation(err) {
		return dbmodels.User{}, refuse("concurrent_sign_in", connect.CodeAborted, "another sign-in is creating this account")
	}
	if err != nil {
		return dbmodels.User{}, err
	}
	user, err = txq.UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              user.ID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return dbmodels.User{}, err
	}
	for _, versionID := range agreedVersionIDs {
		if err := txq.CreateUserPageConsent(ctx, dbmodels.CreateUserPageConsentParams{
			TenantID:      tenant.ID,
			UserID:        user.ID,
			PageVersionID: versionID,
		}); err != nil {
			return dbmodels.User{}, err
		}
	}
	return user, nil
}

func (s *apiServer) ListMyIdentities(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyIdentitiesRequest],
) (*connect.Response[publirav1.ListMyIdentitiesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListUserIdentitiesForUser(ctx, dbmodels.ListUserIdentitiesForUserParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list linked identities", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	identities := make([]*publirav1.LinkedIdentity, 0, len(rows))
	for _, row := range rows {
		identities = append(identities, &publirav1.LinkedIdentity{
			Provider: identityProviderToProto(row.Provider),
			Email:    row.EmailAtLink,
			LinkedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return connect.NewResponse(&publirav1.ListMyIdentitiesResponse{
		Identities:  identities,
		HasPassword: user.PasswordHash.Valid,
	}), nil
}

func (s *apiServer) UnlinkIdentity(
	ctx context.Context,
	req *connect.Request[publirav1.UnlinkIdentityRequest],
) (*connect.Response[publirav1.UnlinkIdentityResponse], error) {
	const action = "identity_unlink"
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		auth.AuditEvent(req.Header(), action, "failure", "", "", "invalid_session")
		return nil, err
	}
	fail := func(reason string, err error) (*connect.Response[publirav1.UnlinkIdentityResponse], error) {
		auth.AuditEvent(req.Header(), action, "failure", tenant.PublicID, user.PublicID, reason)
		return nil, err
	}
	provider, err := identityProviderFromProto(req.Msg.Provider)
	if err != nil {
		return fail("invalid_provider", err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return fail("transaction_begin_failed", s.internalDBError(ctx, "failed to begin unlink transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	// Locked so two unlinks at once cannot each see the other's link and
	// leave the account with no way in.
	locked, err := txq.GetUserByIDForUpdate(ctx, user.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fail("account_gone", invalidSessionError())
		}
		return fail("user_lock_failed", s.internalDBError(ctx, "failed to lock the account for an unlink", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	identities, err := txq.ListUserIdentitiesForUser(ctx, dbmodels.ListUserIdentitiesForUserParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
	})
	if err != nil {
		return fail("identity_lookup_failed", s.internalDBError(ctx, "failed to list linked identities", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	var target *dbmodels.UserIdentity
	for i := range identities {
		if identities[i].Provider == provider {
			target = &identities[i]
		}
	}
	if target == nil {
		return fail("not_linked", connect.NewError(connect.CodeNotFound, errors.New("no account of this provider is linked")))
	}
	if !locked.PasswordHash.Valid && len(identities) == 1 {
		return fail("last_sign_in_method", connect.NewError(connect.CodeFailedPrecondition, errors.New("the account has no password, so it keeps its last linked provider")))
	}
	if err := outbox.QueueAppleSignInTokenRevocation(ctx, txq, *target); err != nil {
		return fail("revocation_enqueue_failed", s.internalError(ctx, "failed to queue the apple token revocation", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	if _, err := txq.DeleteUserIdentityForUser(ctx, dbmodels.DeleteUserIdentityForUserParams{
		TenantID: tenant.ID,
		UserID:   user.ID,
		Provider: provider,
	}); err != nil {
		return fail("unlink_failed", s.internalDBError(ctx, "failed to unlink the identity", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	if err := tx.Commit(); err != nil {
		return fail("transaction_commit_failed", s.internalDBError(ctx, "failed to commit unlink", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String()))
	}
	auth.AuditEvent(req.Header(), action, "success", tenant.PublicID, user.PublicID, provider)
	return connect.NewResponse(&publirav1.UnlinkIdentityResponse{}), nil
}

// confirmWithIdentity checks the fresh sign-in an account without a password
// confirms a step with, and spends its nonce on queries.
func (s *apiServer) confirmWithIdentity(
	ctx context.Context,
	queries dbmodels.Querier,
	tenantID, userID uuid.UUID,
	providerValue publirav1.IdentityProvider,
	rawToken, nonce string,
) error {
	claims, err := s.verifyIdentityConfirmation(ctx, queries, tenantID, userID, providerValue, rawToken, nonce)
	if err != nil {
		return err
	}
	return s.spendConfirmationNonce(ctx, queries, tenantID, nonce, claims)
}

// verifyIdentityConfirmation checks that a fresh sign-in is of a provider
// linked to the account, without writing anything.
func (s *apiServer) verifyIdentityConfirmation(
	ctx context.Context,
	queries dbmodels.Querier,
	tenantID, userID uuid.UUID,
	providerValue publirav1.IdentityProvider,
	rawToken, nonce string,
) (signin.Claims, error) {
	provider, err := identityProviderFromProto(providerValue)
	if err != nil {
		return signin.Claims{}, err
	}
	if strings.TrimSpace(rawToken) == "" || strings.TrimSpace(nonce) == "" {
		return signin.Claims{}, connect.NewError(connect.CodeInvalidArgument, errors.New("id_token and nonce are required"))
	}
	identity, err := queries.GetUserIdentityForUser(ctx, dbmodels.GetUserIdentityForUserParams{
		TenantID: tenantID,
		UserID:   userID,
		Provider: provider,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return signin.Claims{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("no account of this provider is linked"), "provider")
	}
	if err != nil {
		return signin.Claims{}, s.internalDBError(ctx, "failed to read the linked identity", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	claims, err := s.verifyIDToken(ctx, tenantID, provider, rawToken, nonce, false)
	if err != nil {
		return signin.Claims{}, err
	}
	// Not Unauthenticated: the session is fine, the confirmation is not the
	// account's, as a wrong password is not.
	if claims.Subject != identity.Subject {
		return signin.Claims{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the ID token is not of the linked account"), "id_token")
	}
	// spendConfirmationNonce stays the check that closes the race; this one
	// refuses a replay before the caller charges anything for it.
	spent, err := queries.SignInNonceIsSpent(ctx, dbmodels.SignInNonceIsSpentParams{
		TenantID:  tenantID,
		NonceHash: signin.HashNonce(nonce),
	})
	if err != nil {
		return signin.Claims{}, s.internalDBError(ctx, "failed to read the sign-in nonce", err, "tenant_id", tenantID.String())
	}
	if spent {
		return signin.Claims{}, confirmationNonceReplayedError()
	}
	return claims, nil
}

func confirmationNonceReplayedError() error {
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("the nonce was used already"), "nonce")
}

// spendConfirmationNonce spends the nonce of a sign-in
// verifyIdentityConfirmation accepted, so the same sign-in confirms one step.
func (s *apiServer) spendConfirmationNonce(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, nonce string, claims signin.Claims) error {
	if err := spendNonce(ctx, queries, tenantID, nonce, claims); err != nil {
		if errors.Is(err, errNonceReplayed) {
			return confirmationNonceReplayedError()
		}
		return s.internalDBError(ctx, "failed to spend the sign-in nonce", err, "tenant_id", tenantID.String())
	}
	return nil
}
