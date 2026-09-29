package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The admin and platform consoles' password reset forms, which answer a
// registered address exactly as they answer an unknown one. They are recorded
// and resolved the way the reader forms are, so the time a form takes to answer
// does not depend on the address either.
const (
	EventTypeAdminPasswordResetRequest    = "admin_password_reset_request"
	EventTypePlatformPasswordResetRequest = "platform_password_reset_request"
)

// AdminPasswordResetRequestPayload is the address a tenant's admin console
// asked a reset for.
type AdminPasswordResetRequestPayload struct {
	TenantID string `json:"tenant_id"`
	Email    string `json:"email"`
}

// PlatformPasswordResetRequestPayload is the address the platform console asked
// a reset for. It names no tenant, as an operator belongs to none.
type PlatformPasswordResetRequestPayload struct {
	Email string `json:"email"`
}

// NewAdminPasswordResetRequestHandler issues the reset link an address asked
// for in a tenant's admin console, when an account in that tenant holds it.
func NewAdminPasswordResetRequestHandler(cfg EmailHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("admin password reset request handler database is not configured")
		}
		var payload AdminPasswordResetRequestPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode admin password reset request payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}

		outcome, err := processUserPasswordReset(ctx, cfg.DB, event, tenantID, payload.Email,
			EventTypeAdminPasswordResetEmail, func(token string) any {
				return AdminPasswordResetEmailPayload{TenantID: tenantID.String(), TokenID: event.ID.String(), Token: token}
			},
		)
		if err != nil {
			return err
		}
		cfg.logAuthRequest(ctx, event, outcome)
		return nil
	}
}

// NewPlatformPasswordResetRequestHandler issues the reset link an address asked
// for in the platform console, when an operator holds it.
func NewPlatformPasswordResetRequestHandler(cfg EmailHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("platform password reset request handler database is not configured")
		}
		var payload PlatformPasswordResetRequestPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode platform password reset request payload: %w", err))
		}
		if event.TenantID.Valid {
			return Permanent(fmt.Errorf("%s event belongs to no tenant but names %s", event.EventType, event.TenantID.UUID))
		}
		if strings.TrimSpace(payload.Email) == "" {
			return Permanent(fmt.Errorf("%s payload has no email", event.EventType))
		}

		outcome, err := processPlatformPasswordReset(ctx, cfg.DB, event, payload.Email)
		if err != nil {
			return err
		}
		cfg.logAuthRequest(ctx, event, outcome)
		return nil
	}
}

func processPlatformPasswordReset(ctx context.Context, db *sql.DB, event dbmodels.OutboxEvent, email string) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin platform password reset transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)

	operator, err := queries.GetPlatformUserByEmail(ctx, email)
	if errors.Is(err, sql.ErrNoRows) {
		return "no_account", nil
	}
	if err != nil {
		return "", fmt.Errorf("look up the platform user: %w", err)
	}
	if err := queries.LockPlatformUserPasswordReset(ctx, operator.ID); err != nil {
		return "", fmt.Errorf("lock the platform user's password reset: %w", err)
	}

	if err := queries.DeletePlatformUserPasswordResetTokensByUserID(ctx, operator.ID); err != nil {
		return "", fmt.Errorf("delete platform password reset tokens: %w", err)
	}
	token, err := newAuthToken()
	if err != nil {
		return "", err
	}
	// Keyed by the request, as the reader password reset is.
	if _, err := queries.CreatePlatformUserPasswordResetToken(ctx, dbmodels.CreatePlatformUserPasswordResetTokenParams{
		ID:             event.ID,
		PlatformUserID: operator.ID,
		TokenHash:      auth.HashToken(token),
		ExpiresAt:      time.Now().Add(authLinkTTL),
	}); err != nil {
		return "", fmt.Errorf("create platform password reset token: %w", err)
	}
	queued, err := queueEvent(ctx, queries, event.TenantID, EventTypePlatformPasswordResetEmail,
		PlatformPasswordResetEmailPayload{TokenID: event.ID.String(), Token: token},
		EventTypePlatformPasswordResetEmail+":"+event.ID.String(),
	)
	if err != nil {
		return "", err
	}
	if !queued {
		return "already_processed", nil
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit platform password reset: %w", err)
	}
	return "reset_link_issued", nil
}
