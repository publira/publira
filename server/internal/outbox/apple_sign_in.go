package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/signin"
)

// EventTypeAppleSignInCodeExchange trades the authorization code of an Apple
// sign-in for the refresh token the link keeps. It is queued by the sign-in
// that created the link, off the request, and has to run within the five
// minutes the code is valid for.
const EventTypeAppleSignInCodeExchange = "apple_sign_in_code_exchange"

// EventTypeAppleSignInTokenRevoke revokes the refresh token of an Apple link
// that is going away with its account or on its own, as Apple requires of an
// app that creates accounts with it. It carries the token itself, sealed,
// because the row that held it is deleted in the transaction that queues it.
const EventTypeAppleSignInTokenRevoke = "apple_sign_in_token_revoke"

// AppleSignInCodeExchangePayload names the link the refresh token is kept on,
// and carries the code as a secretcrypto envelope.
type AppleSignInCodeExchangePayload struct {
	TenantID      string `json:"tenant_id"`
	IdentityID    string `json:"identity_id"`
	ClientID      string `json:"client_id"`
	CodeEncrypted string `json:"code_encrypted"`
	RedirectURI   string `json:"redirect_uri,omitempty"`
}

// AppleSignInTokenRevokePayload is the token to revoke, as the link stored it.
type AppleSignInTokenRevokePayload struct {
	TenantID              string `json:"tenant_id"`
	ClientID              string `json:"client_id"`
	RefreshTokenEncrypted string `json:"refresh_token_encrypted"`
}

// AppleTokens is the part of the Sign in with Apple token endpoints the
// handlers call.
type AppleTokens interface {
	ExchangeCode(ctx context.Context, creds signin.AppleCredentials, clientID, code, redirectURI string) (string, error)
	RevokeRefreshToken(ctx context.Context, creds signin.AppleCredentials, clientID, refreshToken string) error
}

// AppleSignInHandlerConfig is what the worker resolves once at startup. The
// tenant's key is read per event.
type AppleSignInHandlerConfig struct {
	DB        *sql.DB
	Encryptor signin.SecretManager
	Tokens    AppleTokens
	Logger    *slog.Logger
}

// QueueAppleSignInCodeExchange queues the exchange of code, sealed with
// encryptor, for the link identityID names. nonceHash is the sign-in's spent
// nonce, which tells one sign-in's exchange from another's.
func QueueAppleSignInCodeExchange(
	ctx context.Context,
	queries dbmodels.Querier,
	encryptor signin.SecretManager,
	tenantID, identityID uuid.UUID,
	nonceHash, clientID, code, redirectURI string,
) error {
	sealed, err := signin.Seal(encryptor, code)
	if err != nil {
		return fmt.Errorf("seal the apple authorization code: %w", err)
	}
	return insertTenantEvent(ctx, queries, tenantID, EventTypeAppleSignInCodeExchange, AppleSignInCodeExchangePayload{
		TenantID:      tenantID.String(),
		IdentityID:    identityID.String(),
		ClientID:      clientID,
		CodeEncrypted: sealed,
		RedirectURI:   redirectURI,
	}, EventTypeAppleSignInCodeExchange+":"+identityID.String()+":"+nonceHash)
}

// QueueAppleSignInTokenRevocation queues the revocation of the refresh token
// identity holds, and does nothing for one that holds none. Call it in the
// transaction that deletes the link, before the delete.
func QueueAppleSignInTokenRevocation(ctx context.Context, queries dbmodels.Querier, identity dbmodels.UserIdentity) error {
	if !identity.RefreshTokenEncrypted.Valid {
		return nil
	}
	return insertTenantEvent(ctx, queries, identity.TenantID, EventTypeAppleSignInTokenRevoke, AppleSignInTokenRevokePayload{
		TenantID:              identity.TenantID.String(),
		ClientID:              identity.RefreshTokenClientID.String,
		RefreshTokenEncrypted: identity.RefreshTokenEncrypted.String,
	}, EventTypeAppleSignInTokenRevoke+":"+identity.ID.String())
}

// QueueAppleSignInTokenRevocationsForUser queues the revocations of every link
// of an account that is about to be deleted, which takes its links with it.
func QueueAppleSignInTokenRevocationsForUser(ctx context.Context, queries dbmodels.Querier, tenantID, userID uuid.UUID) error {
	identities, err := queries.ListUserIdentitiesForUser(ctx, dbmodels.ListUserIdentitiesForUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		return fmt.Errorf("list the links of the account: %w", err)
	}
	for _, identity := range identities {
		if err := QueueAppleSignInTokenRevocation(ctx, queries, identity); err != nil {
			return err
		}
	}
	return nil
}

// NewAppleSignInCodeExchangeHandler exchanges the code an event carries and
// keeps the refresh token on its link.
func NewAppleSignInCodeExchangeHandler(cfg AppleSignInHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Tokens == nil {
			return errors.New("apple sign-in handler is not configured")
		}
		var payload AppleSignInCodeExchangePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode apple code exchange payload: %w", err))
		}
		tenantID, err := eventTenant(event, payload.TenantID)
		if err != nil {
			return err
		}
		identityID, err := uuid.Parse(payload.IdentityID)
		if err != nil || payload.ClientID == "" {
			return Permanent(errors.New("apple code exchange payload names no link"))
		}

		queries := dbmodels.New(cfg.DB)
		settings := signin.NewSettings(queries, cfg.Encryptor)
		code, err := signin.Open(cfg.Encryptor, payload.CodeEncrypted)
		if err != nil {
			return Permanent(fmt.Errorf("open the apple authorization code: %w", err))
		}
		creds, err := settings.LoadAppleCredentials(ctx, tenantID)
		if err != nil {
			// The code expires within minutes, so a tenant that took its key
			// away is not waited for; a database that did not answer is.
			if isUnusableAppleKey(err) {
				return Permanent(fmt.Errorf("load the apple sign-in key: %w", err))
			}
			return fmt.Errorf("load the apple sign-in key: %w", err)
		}
		refreshToken, err := cfg.Tokens.ExchangeCode(ctx, creds, payload.ClientID, code, payload.RedirectURI)
		if errors.Is(err, signin.ErrInvalidGrant) || errors.Is(err, signin.ErrInvalidClient) {
			return Permanent(err)
		}
		if err != nil {
			return fmt.Errorf("exchange the apple authorization code: %w", err)
		}
		// The code is spent, so a retry cannot get the token back: one this
		// handler does not keep is revoked here or by nobody.
		revokeUnkept := func(cause error) error {
			if err := cfg.Tokens.RevokeRefreshToken(ctx, creds, payload.ClientID, refreshToken); err != nil {
				return errors.Join(cause, fmt.Errorf("revoke the refresh token that was not kept: %w", err))
			}
			return Permanent(cause)
		}
		sealed, err := signin.Seal(cfg.Encryptor, refreshToken)
		if err != nil {
			return revokeUnkept(fmt.Errorf("seal the apple refresh token: %w", err))
		}
		stored, err := queries.SetUserIdentityRefreshToken(ctx, dbmodels.SetUserIdentityRefreshTokenParams{
			TenantID:              tenantID,
			ID:                    identityID,
			RefreshTokenEncrypted: sql.NullString{String: sealed, Valid: true},
			RefreshTokenClientID:  sql.NullString{String: payload.ClientID, Valid: true},
		})
		if err != nil {
			return revokeUnkept(fmt.Errorf("store the apple refresh token: %w", err))
		}
		if stored == 0 {
			// The link went while the code was exchanged, or keeps a token from
			// an earlier sign-in.
			if err := revokeUnkept(errors.New("the link keeps no new refresh token")); !IsPermanent(err) {
				return err
			}
		}
		cfg.log(ctx, "exchanged an apple authorization code", event, tenantID)
		return nil
	}
}

// NewAppleSignInTokenRevokeHandler revokes the refresh token an event
// carries.
func NewAppleSignInTokenRevokeHandler(cfg AppleSignInHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Tokens == nil {
			return errors.New("apple sign-in handler is not configured")
		}
		var payload AppleSignInTokenRevokePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode apple token revoke payload: %w", err))
		}
		tenantID, err := eventTenant(event, payload.TenantID)
		if err != nil {
			return err
		}
		settings := signin.NewSettings(dbmodels.New(cfg.DB), cfg.Encryptor)
		refreshToken, err := signin.Open(cfg.Encryptor, payload.RefreshTokenEncrypted)
		if err != nil {
			return Permanent(fmt.Errorf("open the apple refresh token: %w", err))
		}
		// A tenant without its key is retried rather than dropped: the
		// revocation is owed to the reader, and a restored key can still pay it.
		creds, err := settings.LoadAppleCredentials(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("load the apple sign-in key: %w", err)
		}
		err = cfg.Tokens.RevokeRefreshToken(ctx, creds, payload.ClientID, refreshToken)
		if errors.Is(err, signin.ErrInvalidGrant) {
			// Revoked or expired already, which is the state asked for.
			return nil
		}
		if err != nil {
			return fmt.Errorf("revoke the apple refresh token: %w", err)
		}
		cfg.log(ctx, "revoked an apple refresh token", event, tenantID)
		return nil
	}
}

// isUnusableAppleKey reports a tenant whose key no retry can make usable:
// none is stored, or it does not decrypt.
func isUnusableAppleKey(err error) bool {
	return errors.Is(err, signin.ErrAppleNotConfigured) ||
		errors.Is(err, signin.ErrDecryptFailed) ||
		errors.Is(err, signin.ErrSecretManagerUnavailable)
}

func (cfg AppleSignInHandlerConfig) log(ctx context.Context, message string, event dbmodels.OutboxEvent, tenantID uuid.UUID) {
	if cfg.Logger == nil {
		return
	}
	cfg.Logger.InfoContext(ctx, message, "tenant_id", tenantID, "outbox_event_id", event.ID)
}

func eventTenant(event dbmodels.OutboxEvent, raw string) (uuid.UUID, error) {
	tenantID, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil || !event.TenantID.Valid || event.TenantID.UUID != tenantID {
		return uuid.Nil, Permanent(errors.New("payload names another tenant than its event"))
	}
	return tenantID, nil
}

// insertTenantEvent is queueTenantEvent over any querier, for the API
// handlers that queue these events inside their own transactions.
func insertTenantEvent(
	ctx context.Context,
	queries dbmodels.Querier,
	tenantID uuid.UUID,
	eventType string,
	payload any,
	idempotencyKey string,
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal %s event: %w", eventType, err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate outbox event id: %w", err)
	}
	_, err = queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      eventType,
		Payload:        body,
		IdempotencyKey: idempotencyKey,
		AvailableAt:    time.Now().UTC(),
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("queue %s event: %w", eventType, err)
	}
	return nil
}
