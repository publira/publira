package mfaflow

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Status is what GetMfaStatus reports of an account, apart from whether its
// principal requires the factor.
type Status struct {
	Factors Factors
	// RemainingRecoveryCodes is zero for an account that holds no factor.
	RemainingRecoveryCodes int32
}

// GetStatus reads what the account holds and how many recovery codes are
// left of what stands in for it.
func GetStatus(ctx context.Context, acct Account) (Status, error) {
	factors, err := FactorsOf(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return Status{}, err
	}
	status := Status{Factors: factors}
	if factors.Any() {
		remaining, err := RemainingRecoveryCodes(ctx, acct)
		if err != nil {
			return Status{}, err
		}
		status.RemainingRecoveryCodes = remaining
	}
	return status, nil
}

// StartEnrollment draws a new authenticator secret and keeps it, unconfirmed,
// in place of whatever unconfirmed one the account held.
func StartEnrollment(ctx context.Context, acct Account) (mfa.Enrollment, error) {
	encryptor := acct.Encryptor()
	if encryptor == nil {
		return mfa.Enrollment{}, secretManagerUnavailableError()
	}
	q := acct.Queries(ctx)
	totp, found, err := acct.Totp(ctx, q)
	if err != nil {
		return mfa.Enrollment{}, acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	// Replacing a confirmed authenticator has to go through disabling it, so
	// a stolen session cannot quietly swap the factor for one of its own.
	if found && totp.EnabledAt.Valid {
		return mfa.Enrollment{}, alreadyEnabledError()
	}

	enrollment, err := mfa.GenerateEnrollment(acct.OTPAuthLabel())
	if err != nil {
		return mfa.Enrollment{}, acct.InternalError(ctx, "failed to generate mfa enrollment", err)
	}
	encrypted, err := encryptor.EncryptString(enrollment.Secret)
	if err != nil {
		return mfa.Enrollment{}, acct.InternalError(ctx, "failed to encrypt mfa totp secret", err)
	}
	if err := acct.StoreTotpSecret(ctx, q, encrypted); err != nil {
		return mfa.Enrollment{}, acct.InternalError(ctx, "failed to store mfa totp secret", err)
	}
	// A stalled confirmation that ran into the lock is not held against the
	// next enrollment.
	if err := ResetFailures(ctx, acct); err != nil {
		return mfa.Enrollment{}, err
	}
	return enrollment, nil
}

// Confirmation is what confirming an enrollment hands back: the recovery
// codes, which exist nowhere else, and the session it finishes for an
// account identified by a challenge. A nil AccessToken there is a session
// that could not be issued; the factor is enabled all the same.
type Confirmation struct {
	RecoveryCodes []string
	User          *publirattypesv1.User
	AccessToken   *publirattypesv1.AccessToken
}

// ConfirmEnrollment enables the authenticator StartEnrollment kept once code
// proves it was set up.
func ConfirmEnrollment(ctx context.Context, acct Account, code string) (Confirmation, error) {
	actions := acct.Actions()
	totp, found, err := acct.Totp(ctx, acct.Queries(ctx))
	if err != nil {
		return Confirmation{}, acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	if !found {
		return Confirmation{}, connect.NewError(connect.CodeFailedPrecondition, "mfa enrollment has not been started")
	}
	if totp.EnabledAt.Valid {
		return Confirmation{}, alreadyEnabledError()
	}

	// A recovery code cannot confirm an enrollment: there are none yet, and
	// the point of the step is proving the authenticator was set up.
	outcome, err := CheckCode(ctx, acct, &totp, code, false)
	if err != nil {
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, outcome.Reason)
		return Confirmation{}, err
	}

	// Everything that can fail for a reason of its own is settled before the
	// enable commits, because the recovery codes exist only in the response
	// this call is about to build.
	if acct.FromChallenge() && !acct.CanIssueSession() {
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, "token_manager_unavailable")
		return Confirmation{}, connect.NewError(connect.CodeInternal, "token manager is not configured")
	}

	codes, err := enable(ctx, acct)
	switch {
	case errors.Is(err, ErrChallengeSpent):
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, "challenge_spent")
		return Confirmation{}, invalidSessionError()
	case errors.Is(err, ErrEnrollChallengeStale):
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, "challenge_stale")
		return Confirmation{}, invalidSessionError()
	case errors.Is(err, errAlreadyEnabled):
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, "already_enabled")
		return Confirmation{}, alreadyEnabledError()
	case err != nil:
		acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeFailure, "enable_failed")
		return Confirmation{}, err
	}

	confirmation := Confirmation{RecoveryCodes: codes}
	reason := FactorTotp
	if acct.FromChallenge() {
		user, accessToken, sessionErr := acct.IssueSession(ctx)
		if sessionErr == nil {
			confirmation.User = user
			confirmation.AccessToken = accessToken
		} else {
			// The factor is enabled and these codes are the only copy there
			// will ever be, so answering with them and no session is better
			// than an error that throws them away. The client sees an empty
			// access token and sends the account back through sign-in.
			reason = "session_issue_failed"
		}
	}
	acct.Audit(ctx, actions.Enrolled, auditlog.OutcomeSuccess, reason)
	return confirmation, nil
}

// enable marks the authenticator confirmed and issues the recovery codes that
// go with it, in one transaction: an account left enabled without codes would
// have no way back in if it lost the authenticator.
//
// An enrollment that finishes a sign-in claims its challenge in the same
// transaction, so the token buys one session however many codes of the window
// are confirmed with it at once, and is left unspent if the enable rolls back.
// The enable itself is claimed too: two confirmations that both read the row
// unconfirmed would otherwise each replace the other's recovery codes, and
// only the last to commit would hand out codes that still work.
func enable(ctx context.Context, acct Account) ([]string, error) {
	var codes []string
	err := acct.InTx(ctx, func(q dbmodels.Querier) error {
		if acct.FromChallenge() {
			claimed, err := SpendChallenge(ctx, acct, q)
			if err != nil {
				return err
			}
			if !claimed {
				return ErrChallengeSpent
			}
			// The challenge was checked to stand for an account without a
			// factor before the transaction held the others off; a passkey
			// registered since, under another sign-in's enroll challenge, is
			// seen here.
			passkeys, err := acct.Passkeys(ctx, q)
			if err != nil {
				return acct.InternalError(ctx, "failed to count passkeys", err)
			}
			if passkeys > 0 {
				return ErrEnrollChallengeStale
			}
		}
		enabled, err := acct.EnableTotp(ctx, q)
		if err != nil {
			return acct.InternalError(ctx, "failed to enable mfa totp", err)
		}
		if !enabled {
			return errAlreadyEnabled
		}
		codes, err = ReplaceRecoveryCodes(ctx, acct, q)
		return err
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// Verification is what settling a sign-in's second step hands back.
type Verification struct {
	User                   *publirattypesv1.User
	AccessToken            *publirattypesv1.AccessToken
	RecoveryCodeUsed       bool
	RemainingRecoveryCodes int32
}

// Verify settles the second step of a sign-in with a code from the
// authenticator or a recovery code. An account that holds passkeys and no
// authenticator answers here with a recovery code alone.
func Verify(ctx context.Context, acct Account, code string) (Verification, error) {
	factors, err := FactorsOf(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return Verification{}, err
	}
	if !factors.Any() {
		return Verification{}, NotEnabledError()
	}
	var totp *Totp
	if factors.TotpEnabled() {
		totp = &factors.Totp
	}

	outcome, err := CheckCode(ctx, acct, totp, code, true)
	if err != nil {
		acct.Audit(ctx, acct.Actions().Verified, auditlog.OutcomeFailure, outcome.Reason)
		acct.LogVerification(ctx, auditlog.OutcomeFailure, outcome.Reason)
		return Verification{}, err
	}
	factor := FactorTotp
	if outcome.RecoveryUsed {
		factor = FactorRecoveryCode
	}
	return CompleteVerification(ctx, acct, factor)
}

// CompleteVerification finishes a sign-in whose second step factor has just
// settled: it spends the challenge, issues the session, and records both.
//
// The challenge is spent after the factor is accepted, not before: burning
// it on a mistyped code would send the account back through the password for
// a typo, and it is the failure counter, not the challenge, that bounds
// guessing.
func CompleteVerification(ctx context.Context, acct Account, factor string) (Verification, error) {
	actions := acct.Actions()
	refuse := func(reason string, err error) (Verification, error) {
		acct.Audit(ctx, actions.Verified, auditlog.OutcomeFailure, reason)
		acct.LogVerification(ctx, auditlog.OutcomeFailure, reason)
		return Verification{}, err
	}
	claimed, err := SpendChallenge(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return refuse("challenge_claim_failed", err)
	}
	if !claimed {
		return refuse("challenge_spent", invalidSessionError())
	}

	user, accessToken, err := acct.IssueSession(ctx)
	if err != nil {
		return Verification{}, err
	}
	remaining, err := RemainingRecoveryCodes(ctx, acct)
	if err != nil {
		return Verification{}, err
	}

	recoveryUsed := factor == FactorRecoveryCode
	if recoveryUsed {
		acct.Audit(ctx, actions.RecoveryCodeUsed, auditlog.OutcomeSuccess, "")
	}
	acct.Audit(ctx, actions.Verified, auditlog.OutcomeSuccess, factor)
	acct.LogVerification(ctx, auditlog.OutcomeSuccess, factor)
	return Verification{
		User:                   user,
		AccessToken:            accessToken,
		RecoveryCodeUsed:       recoveryUsed,
		RemainingRecoveryCodes: remaining,
	}, nil
}

// Disable takes the authenticator off once code proves the account. A
// recovery code counts here: an account whose authenticator is gone has to be
// able to take the factor off and enroll a new one.
func Disable(ctx context.Context, acct Account, code string) error {
	actions := acct.Actions()
	totp, found, err := acct.Totp(ctx, acct.Queries(ctx))
	if err != nil {
		return acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	if !found || !totp.EnabledAt.Valid {
		return NotEnabledError()
	}

	outcome, err := CheckCode(ctx, acct, &totp, code, true)
	if err != nil {
		acct.Audit(ctx, actions.Disabled, auditlog.OutcomeFailure, outcome.Reason)
		return err
	}

	err = acct.InTx(ctx, func(q dbmodels.Querier) error {
		if err := acct.DeleteTotp(ctx, q); err != nil {
			return acct.InternalError(ctx, "failed to delete mfa totp", err)
		}
		// The recovery codes stand in for every factor the account holds, so
		// they go only with the last of them.
		if err := acct.ReleaseRecoveryCodes(ctx, q); err != nil {
			return acct.InternalError(ctx, "failed to delete mfa recovery codes", err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	factor := FactorTotp
	if outcome.RecoveryUsed {
		factor = FactorRecoveryCode
	}
	acct.Audit(ctx, actions.Disabled, auditlog.OutcomeSuccess, factor)
	return nil
}

// RegenerateRecoveryCodes replaces the account's recovery codes once a code
// from the authenticator proves it. A recovery code cannot ask for a new
// batch: letting one code mint ten more would make a single leaked code
// permanent.
func RegenerateRecoveryCodes(ctx context.Context, acct Account, code string) ([]string, error) {
	totp, found, err := acct.Totp(ctx, acct.Queries(ctx))
	if err != nil {
		return nil, acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	if !found || !totp.EnabledAt.Valid {
		return nil, NotEnabledError()
	}
	outcome, err := CheckCode(ctx, acct, &totp, code, false)
	if err != nil {
		acct.Audit(ctx, acct.Actions().RecoveryCodesRegenerated, auditlog.OutcomeFailure, outcome.Reason)
		return nil, err
	}
	return RegenerateRecoveryCodesFor(ctx, acct, FactorTotp, func(q dbmodels.Querier) error {
		current, found, err := acct.Totp(ctx, q)
		if err != nil {
			return acct.InternalError(ctx, "failed to get mfa totp", err)
		}
		if !found || !current.EnabledAt.Valid {
			return NotEnabledError()
		}
		return nil
	})
}

// RegenerateRecoveryCodesFor replaces the account's recovery codes once
// factor has proved it. The batch outlives the factor that minted it only if
// that factor is still there once nothing else can take it off, which
// stillHeld checks inside the transaction and answers the client's error for
// when it is not.
func RegenerateRecoveryCodesFor(ctx context.Context, acct Account, factor string, stillHeld func(q dbmodels.Querier) error) ([]string, error) {
	var codes []string
	err := acct.InTx(ctx, func(q dbmodels.Querier) error {
		if err := stillHeld(q); err != nil {
			return err
		}
		var err error
		codes, err = ReplaceRecoveryCodes(ctx, acct, q)
		return err
	})
	if err != nil {
		return nil, err
	}
	acct.Audit(ctx, acct.Actions().RecoveryCodesRegenerated, auditlog.OutcomeSuccess, factor)
	return codes, nil
}
