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
