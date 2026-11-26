package mfaflow

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
)

// Outcome says what a presented code turned out to be, so the caller can
// write the right audit entry without repeating the checks.
type Outcome struct {
	RecoveryUsed bool
	// Reason names why a code was refused, for the audit trail. It is empty
	// when the code was accepted.
	Reason string
}

// CheckCode decides whether code unlocks acct: a code from totp, when the
// account holds an authenticator, or a recovery code if allowRecovery and the
// code is one. It owns the failure counter and the lock: a refusal here has
// already been counted, and the error it returns is the one to hand the
// client.
//
// The attempt is counted before the code is checked rather than after it is
// refused. Reading the lock and counting a refusal as two statements would
// let every request that read the lock before the attempt that reached the
// limit committed have its code checked, so the limit would be as many
// guesses as could be sent at once.
func CheckCode(ctx context.Context, acct Account, totp *Totp, code string, allowRecovery bool) (Outcome, error) {
	if strings.TrimSpace(code) == "" {
		locked, err := Locked(ctx, acct)
		if err != nil {
			return Outcome{}, err
		}
		if locked {
			return Outcome{Reason: "locked"}, LockedError()
		}
		return Outcome{Reason: "code_missing"}, CodeRequiredError()
	}
	var encryptor Encryptor
	if totp != nil {
		// Checked before the attempt is counted: a server that cannot open
		// the secret has checked nothing, and its owner should not be locked
		// out by it.
		if encryptor = acct.Encryptor(); encryptor == nil {
			return Outcome{Reason: "secret_manager_unavailable"}, secretManagerUnavailableError()
		}
	}

	allowed, startedLock, err := acct.ReserveAttempt(ctx, acct.Queries(ctx))
	if err != nil {
		return Outcome{}, acct.InternalError(ctx, "failed to reserve mfa attempt", err)
	}
	if !allowed {
		return Outcome{Reason: "locked"}, LockedError()
	}

	q := acct.Queries(ctx)
	if totp != nil {
		secret, err := encryptor.DecryptString(totp.SecretEncrypted)
		if err != nil {
			return Outcome{Reason: "secret_undecryptable"}, acct.InternalError(ctx, "failed to decrypt mfa totp secret", err)
		}
		if step, ok := mfa.ValidateCode(secret, code, time.Now()); ok {
			// The window spans more than one period, so a code observed over
			// a shoulder is still current for a while after it was spent.
			// Refusing a step already accepted is what RFC 6238 section 5.2
			// asks for. The claim on the step is the UPDATE itself rather
			// than a comparison against the row read above: two requests
			// carrying the same code both read the old step, and only the one
			// whose write lands first may have it.
			claimed, err := acct.ClaimTotpStep(ctx, q, step)
			if err != nil {
				return Outcome{}, acct.InternalError(ctx, "failed to mark mfa totp verified", err)
			}
			if !claimed {
				return refuseReserved(startedLock, "code_reused")
			}
			if err := ResetFailures(ctx, acct); err != nil {
				return Outcome{}, err
			}
			return Outcome{}, nil
		}
	}

	if allowRecovery {
		used, err := spendRecoveryCode(ctx, acct, code)
		if err != nil {
			return Outcome{}, err
		}
		if used {
			if err := ResetFailures(ctx, acct); err != nil {
				return Outcome{}, err
			}
			return Outcome{RecoveryUsed: true}, nil
		}
	}

	return refuseReserved(startedLock, "invalid_code")
}

// refuseReserved answers a code whose attempt was counted before it was
// checked: refusal, or the lock when this was the attempt that started it, so
// the client learns it is locked out now rather than on its next attempt.
func refuseReserved(startedLock bool, reason string) (Outcome, error) {
	if startedLock {
		return Outcome{Reason: "locked"}, LockedError()
	}
	return Outcome{Reason: reason}, InvalidCodeError()
}

// Locked reports whether refused attempts, of every factor the account holds,
// have locked it for now.
func Locked(ctx context.Context, acct Account) (bool, error) {
	locked, err := acct.Locked(ctx, acct.Queries(ctx))
	if err != nil {
		return false, acct.InternalError(ctx, "failed to get mfa lockout", err)
	}
	return locked, nil
}

// Refuse counts one refused attempt that was not counted before it was
// checked, as a passkey assertion is not, and answers the reason and the
// error the client gets: refusal, or the lock when this was the attempt that
// started it, so the client learns it is locked out now rather than on its
// next attempt. Every factor counts toward the one limit, so alternating
// between them buys a guesser nothing.
//
// The reason is empty when the attempt could not be counted.
func Refuse(ctx context.Context, acct Account, reason string, refusal error) (string, error) {
	locked, err := acct.CountFailure(ctx, acct.Queries(ctx))
	if err != nil {
		return "", acct.InternalError(ctx, "failed to record mfa failure", err)
	}
	if locked {
		return "locked", LockedError()
	}
	return reason, refusal
}

// ResetFailures forgets the refused attempts once a factor is accepted.
func ResetFailures(ctx context.Context, acct Account) error {
	if err := acct.ResetFailures(ctx, acct.Queries(ctx)); err != nil {
		return acct.InternalError(ctx, "failed to reset mfa failures", err)
	}
	return nil
}

// spendRecoveryCode marks the one unused code that matches, if any. Codes are
// stored as bcrypt hashes, so the only way to find the match is to try each.
func spendRecoveryCode(ctx context.Context, acct Account, code string) (bool, error) {
	q := acct.Queries(ctx)
	codes, err := acct.UnusedRecoveryCodes(ctx, q)
	if err != nil {
		return false, acct.InternalError(ctx, "failed to list mfa recovery codes", err)
	}
	for _, stored := range codes {
		if !mfa.VerifyRecoveryCode(code, stored.CodeHash) {
			continue
		}
		// A false spent means a concurrent request spent the same code first,
		// so this one is no longer redeemable.
		spent, err := acct.MarkRecoveryCodeUsed(ctx, q, stored.ID)
		if err != nil {
			return false, acct.InternalError(ctx, "failed to mark mfa recovery code used", err)
		}
		return spent, nil
	}
	return false, nil
}

// RemainingRecoveryCodes counts the recovery codes the account may still
// spend.
func RemainingRecoveryCodes(ctx context.Context, acct Account) (int32, error) {
	count, err := acct.CountUnusedRecoveryCodes(ctx, acct.Queries(ctx))
	if err != nil {
		return 0, acct.InternalError(ctx, "failed to count mfa recovery codes", err)
	}
	return int32(count), nil
}

// ReplaceRecoveryCodes draws a fresh batch and puts it in place of whatever
// the account held, used or not, on q. The plaintext it returns is the only
// copy that will exist.
func ReplaceRecoveryCodes(ctx context.Context, acct Account, q dbmodels.Querier) ([]string, error) {
	codes, err := replaceRecoveryCodes(ctx, acct, q)
	if err != nil {
		return nil, acct.InternalError(ctx, "failed to replace mfa recovery codes", err)
	}
	return codes, nil
}

func replaceRecoveryCodes(ctx context.Context, acct Account, q dbmodels.Querier) ([]string, error) {
	codes, err := mfa.GenerateRecoveryCodes()
	if err != nil {
		return nil, err
	}
	if err := acct.DeleteRecoveryCodes(ctx, q); err != nil {
		return nil, err
	}
	for _, code := range codes {
		hash, err := mfa.HashRecoveryCode(code)
		if err != nil {
			return nil, err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, err
		}
		if err := acct.CreateRecoveryCode(ctx, q, id, hash); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

// SpendChallenge claims the challenge the account was identified by, on q,
// so the token buys one session and not one per attempt inside its five
// minutes. The INSERT is the claim rather than a read followed by one: two
// requests presenting the same token both find it unspent, and only the one
// whose row lands may go on.
//
// A false claimed and an error are different answers: the first is a token
// that already bought a session, the second is a database that could not say.
// Only the first is a replay, and the audit trail has to tell them apart.
func SpendChallenge(ctx context.Context, acct Account, q dbmodels.Querier) (claimed bool, err error) {
	claimed, err = acct.ClaimChallenge(ctx, q)
	if err != nil {
		return false, acct.InternalError(ctx, "failed to mark mfa challenge used", err)
	}
	return claimed, nil
}
