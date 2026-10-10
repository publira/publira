// Package platformoperators changes a Platform Console operator's account from
// outside the console, for publiractl to call where no operator can sign in.
package platformoperators

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
)

// FieldEmail is the field a malformed address is refused under, for each
// caller to report as its own input.
const FieldEmail = "email"

var (
	ErrUserOrEmailRequired = errors.New("user_public_id or email is required")
	ErrUserAndEmailBothSet = errors.New("user_public_id and email cannot both be set")
	ErrInvalidEmail        = errors.New("invalid email")
	ErrOperatorNotFound    = errors.New("operator not found")
	// ErrMFANotSetUp refuses a reset for an operator that has no
	// authenticator, confirmed or not, so whoever named the wrong operator
	// hears so.
	ErrMFANotSetUp = errors.New("operator has no two-step verification set up")
)

// ResetMFAParams names the operator whose authenticator and recovery codes
// are removed, by UserPublicID or by Email, never both. Any operator may be
// named, whatever its status: a factor left on a suspended account would
// otherwise be asked for again the day the account is reactivated, with
// nothing left that could remove it.
type ResetMFAParams struct {
	UserPublicID string
	Email        string
}

// Validate refuses p without reading anything.
func (p ResetMFAParams) Validate() error {
	_, _, err := p.normalize()
	return err
}

// normalize answers the public ID trimmed and the address lowercased, the
// form CreateOperator stores it in.
func (p ResetMFAParams) normalize() (publicID, email string, err error) {
	publicID = strings.TrimSpace(p.UserPublicID)
	email = strings.ToLower(strings.TrimSpace(p.Email))
	switch {
	case publicID == "" && email == "":
		return "", "", ErrUserOrEmailRequired
	case publicID != "" && email != "":
		return "", "", ErrUserAndEmailBothSet
	}
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil {
			return "", "", &fielderr.Invalid{Field: FieldEmail, Err: ErrInvalidEmail}
		}
	}
	return publicID, email, nil
}

// ResetMFA deletes the operator's authenticator, whether it was confirmed or
// only started, and every recovery code it holds, and files
// operator_mfa_reset under actor, inside tx. It is what DisableMfa does
// without the code DisableMfa asks for, for the operator that has lost both:
// the next sign-in takes the password alone, and asks for an enrollment
// wherever the platform requires the factor of every operator.
func ResetMFA(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p ResetMFAParams) (dbmodels.PlatformUser, error) {
	publicID, email, err := p.normalize()
	if err != nil {
		return dbmodels.PlatformUser{}, err
	}
	q := dbmodels.New(tx)
	var user dbmodels.PlatformUser
	if email != "" {
		user, err = q.GetPlatformUserByEmail(ctx, email)
	} else {
		user, err = q.GetPlatformUserByPublicID(ctx, publicID)
	}
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformUser{}, ErrOperatorNotFound
		}
		return dbmodels.PlatformUser{}, fmt.Errorf("get operator: %w", err)
	}

	if _, err := q.GetPlatformUserMfaTotp(ctx, user.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.PlatformUser{}, ErrMFANotSetUp
		}
		return dbmodels.PlatformUser{}, fmt.Errorf("get operator mfa totp: %w", err)
	}
	if err := q.DeletePlatformUserMfaRecoveryCodes(ctx, user.ID); err != nil {
		return dbmodels.PlatformUser{}, fmt.Errorf("delete operator mfa recovery codes: %w", err)
	}
	if err := q.DeletePlatformUserMfaTotp(ctx, user.ID); err != nil {
		return dbmodels.PlatformUser{}, fmt.Errorf("delete operator mfa totp: %w", err)
	}

	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "operator_mfa_reset",
		TargetType: "operator",
		TargetID:   user.ID.String(),
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return dbmodels.PlatformUser{}, fmt.Errorf("audit operator_mfa_reset: %w", err)
	}
	return user, nil
}
