// Package signupsettings holds whether a tenant accepts new reader accounts,
// and the message its storefront shows a visitor while it does not.
//
// A reader account is created at two points of the public API, the password
// sign-up and the first sign-in with a provider, and both read the setting
// through [Get] before anything is written, so closing sign-up shuts both.
package signupsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	// MaxClosedMessageLength is the longest message, in characters, the
	// setting accepts.
	MaxClosedMessageLength = 1000

	// ActionSettingsUpdated is the audit action of a change to the settings.
	ActionSettingsUpdated = "tenant_sign_up_settings_updated"
	// AuditTargetType is the audit target type of a change to the settings.
	AuditTargetType = "tenant_sign_up_settings"
)

// ErrClosedMessageTooLong refuses a message longer than
// MaxClosedMessageLength.
var ErrClosedMessageTooLong = fmt.Errorf("closed_message must be at most %d characters", MaxClosedMessageLength)

// ErrClosed is the cause of the refusal a sign-up gets while the tenant does
// not accept new readers.
var ErrClosed = errors.New("the tenant does not accept new readers")

// Refusal is what a request that would create a reader account is answered
// with while the tenant does not accept new readers: failed_precondition with
// the ErrorInfo reason SIGN_UP_CLOSED, the shape tenantstatus.Refusal gives a
// suspended tenant. It says nothing about any address, so a form that answers
// a registered address as it answers a free one may give it.
func Refusal() *connect.Error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, ErrClosed, rpcerrors.ReasonSignUpClosed)
}

// Settings is whether a tenant accepts new readers.
type Settings struct {
	Open bool
	// ClosedMessage is plain text, trimmed, and empty where the storefront
	// shows its own default copy.
	ClosedMessage string
}

// Default is what a tenant that has saved nothing is treated as having.
var Default = Settings{Open: true}

// Normalize validates settings and answers them as they are stored.
func Normalize(settings Settings) (Settings, error) {
	settings.ClosedMessage = strings.TrimSpace(settings.ClosedMessage)
	if utf8.RuneCountInString(settings.ClosedMessage) > MaxClosedMessageLength {
		return Settings{}, ErrClosedMessageTooLong
	}
	return settings, nil
}

// Querier reads the settings.
type Querier interface {
	GetTenantSignUpSettings(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantSignUpSetting, error)
}

// Writer writes the settings.
type Writer interface {
	UpsertTenantSignUpSettings(ctx context.Context, arg dbmodels.UpsertTenantSignUpSettingsParams) (dbmodels.TenantSignUpSetting, error)
}

// Get reads the tenant's settings, or Default for a tenant that has saved
// nothing.
func Get(ctx context.Context, q Querier, tenantID uuid.UUID) (Settings, error) {
	row, err := q.GetTenantSignUpSettings(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return Default, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read the sign-up settings: %w", err)
	}
	return fromRow(row), nil
}

// Update stores settings, which Normalize has already answered, as the
// tenant's settings and answers what it stored.
func Update(ctx context.Context, q Writer, tenantID uuid.UUID, settings Settings) (Settings, error) {
	row, err := q.UpsertTenantSignUpSettings(ctx, dbmodels.UpsertTenantSignUpSettingsParams{
		TenantID:      tenantID,
		SignUpOpen:    settings.Open,
		ClosedMessage: settings.ClosedMessage,
	})
	if err != nil {
		return Settings{}, fmt.Errorf("write the sign-up settings: %w", err)
	}
	return fromRow(row), nil
}

func fromRow(row dbmodels.TenantSignUpSetting) Settings {
	return Settings{Open: row.SignUpOpen, ClosedMessage: row.ClosedMessage}
}
