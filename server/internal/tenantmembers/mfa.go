package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// ErrMFANotSetUp refuses a reset for an account that has no authenticator,
// confirmed or not, and no passkey, so an operator who named the wrong account
// hears so.
var ErrMFANotSetUp = errors.New("user has no two-step verification set up")

// ResetMFAParams names the user whose second factors and recovery codes are
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
// started, every passkey it registered on the console, every recovery code it
// holds, and the count of its refused attempts, inside tx. The passkeys go
// whatever relying party ID they were registered for: one made while the
// console was served on another host would otherwise come back as a factor the
// day the console moved back, after the operator had taken it away. The
// passkeys the account signs in to the storefront with stay: they are no
// second factor, and an account without a password may have no other way in
// there. It is what
// DisableMfa and DeletePasskey do without the factor they ask for, for the
// account that has lost all of them: the next sign-in takes the password
// alone, and asks for an enrollment wherever the platform requires one of the
// account's role.
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

	if err := q.LockUserMfaFactors(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("lock mfa factors: %w", err)
	}

	hasTotp := true
	if _, err := q.GetUserMfaTotpByUserID(ctx, member.UserID); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return Member{}, fmt.Errorf("get mfa totp: %w", err)
		}
		hasTotp = false
	}
	passkeys, err := q.DeleteUserWebauthnCredentialsByUserID(ctx, dbmodels.DeleteUserWebauthnCredentialsByUserIDParams{
		UserID:       member.UserID,
		RelyingParty: tenantwebauthn.KindAdminConsole,
	})
	if err != nil {
		return Member{}, fmt.Errorf("delete passkeys: %w", err)
	}
	if !hasTotp && passkeys == 0 {
		return Member{}, ErrMFANotSetUp
	}
	if err := q.DeleteUserMfaRecoveryCodesByUserID(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("delete mfa recovery codes: %w", err)
	}
	if err := q.DeleteUserMfaTotpByUserID(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("delete mfa totp: %w", err)
	}
	if err := q.ResetUserMfaFailures(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("reset mfa failures: %w", err)
	}
	return member, nil
}
