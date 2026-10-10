package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// ErrMFANotSetUp refuses a reset for an account that has no authenticator,
// confirmed or not, so an operator who named the wrong account hears so.
var ErrMFANotSetUp = errors.New("user has no two-step verification set up")

// ResetMFAParams names the user whose authenticator and recovery codes are
// removed, by UserPublicID or by Email, never both. Any user of the tenant may
// be named, not only one holding a console role now: a factor left on an
// account whose role was taken away would otherwise be asked for again the day
// the role is given back, with nothing left that could remove it.
type ResetMFAParams struct {
	TenantID     uuid.UUID
	UserPublicID string
	Email        string
}

// Validate refuses p without reading anything.
func (p ResetMFAParams) Validate() error {
	_, _, err := normalizeUserRef(uuid.Nil, p.UserPublicID, p.Email)
	return err
}

// ResetMFA deletes the user's authenticator, whether it was confirmed or only
// started, and every recovery code it holds, inside tx. It is what DisableMfa
// does without the code DisableMfa asks for, for the account that has lost
// both: the next sign-in takes the password alone, and asks for an enrollment
// wherever the platform requires one of the account's role.
func ResetMFA(ctx context.Context, tx *sql.Tx, p ResetMFAParams) (Member, error) {
	publicID, email, err := normalizeUserRef(uuid.Nil, p.UserPublicID, p.Email)
	if err != nil {
		return Member{}, err
	}
	q := dbmodels.New(tx)
	member, err := userByRef(ctx, q, p.TenantID, uuid.Nil, publicID, email)
	if err != nil {
		return Member{}, err
	}

	if _, err := q.GetUserMfaTotpByUserID(ctx, member.UserID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Member{}, ErrMFANotSetUp
		}
		return Member{}, fmt.Errorf("get mfa totp: %w", err)
	}
	if err := q.DeleteUserMfaRecoveryCodesByUserID(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("delete mfa recovery codes: %w", err)
	}
	if err := q.DeleteUserMfaTotpByUserID(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("delete mfa totp: %w", err)
	}
	return member, nil
}
