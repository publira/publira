package mfaflow

import (
	"errors"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/rpcerrors"
)

// CodeRequiredError answers a step that asks for a code and was sent none.
func CodeRequiredError() error {
	return connect.NewError(connect.CodeInvalidArgument, "code is required")
}

// InvalidCodeError answers a refused code. A refused code and a rejected
// session both answer `unauthenticated`, and a console that cannot tell them
// apart would sign its user out over a typo. The reason is what separates the
// two.
func InvalidCodeError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeUnauthenticated, errors.New("invalid code"), rpcerrors.ReasonMfaInvalidCode)
}

// LockedError answers any attempt while refused ones have locked the account.
func LockedError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeResourceExhausted, errors.New("too many failed attempts"), rpcerrors.ReasonMfaLocked)
}

// NotEnabledError answers a step that needs a factor the account does not
// hold.
func NotEnabledError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "mfa is not enabled")
}

// ReasonLastRequiredFactor is the audit reason of a change refused because it
// would take the last second factor away from an account the policy holds to
// one.
const ReasonLastRequiredFactor = "last_required_factor"

// ErrLastRequiredFactor is what a transaction changing an account's factors
// returns on finding the change would leave an account the policy holds to a
// second factor without one. LastRequiredFactorError is its answer to the
// client.
var ErrLastRequiredFactor = errors.New("last required second factor")

// LastRequiredFactorError answers a change that would take the last second
// factor away from an account the policy holds to one. The reason sets it
// apart from the RPC's other failed preconditions, such as a factor that is
// not enabled.
func LastRequiredFactorError() error {
	return rpcerrors.NewErrorInfoError(
		connect.CodeFailedPrecondition,
		errors.New("the last second factor cannot be removed while two-step verification is required"),
		rpcerrors.ReasonMfaLastRequiredFactor,
	)
}

func alreadyEnabledError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "mfa is already enabled")
}

func secretManagerUnavailableError() error {
	return connect.NewError(connect.CodeFailedPrecondition, "secret manager is not configured")
}

// invalidSessionError is the answer a rejected session gets, and a challenge
// that already bought one is that.
func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, "invalid token")
}

// The refusals a transaction that enrolls a factor reaches only by losing a
// race with a concurrent enrollment, which its RPC answers apart from a
// database failure. ErrEnrollChallengeStale is an enroll challenge presented
// after the account gained a factor through another one.
var (
	ErrChallengeSpent       = errors.New("mfa challenge already spent")
	ErrEnrollChallengeStale = errors.New("mfa enroll challenge stale")
	errAlreadyEnabled       = errors.New("mfa already enabled")
)
