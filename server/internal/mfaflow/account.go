package mfaflow

import (
	"context"
	"database/sql"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Account is one account's second factor, as the principal that holds it
// stores it. An implementation is bound to the account an RPC acts for and to
// how that account proved who it is, so none of its methods takes either.
//
// The methods that read or write the database take the querier to do it on:
// [Account.Queries] for a step that stands on its own, or the one
// [Account.InTx] hands its function for a step that has to commit with
// others. Their errors are the database's, unwrapped; the flow logs and
// replaces them through [Account.InternalError].
type Account interface {
	// Queries is the querier a step outside a transaction runs on.
	Queries(ctx context.Context) dbmodels.Querier
	// InTx runs fn in a transaction, and commits it when fn returns nil. The
	// transaction holds every other change to the account's factors and
	// recovery codes off until it ends, so whatever fn decides from what else
	// the account holds stays true until it commits. fn's error is returned
	// as it is; a transaction that cannot begin or commit is answered with
	// the error the client is given.
	InTx(ctx context.Context, fn func(q dbmodels.Querier) error) error

	// Totp reads the account's authenticator. found is false when no
	// enrollment was ever started.
	Totp(ctx context.Context, q dbmodels.Querier) (totp Totp, found bool, err error)
	// Passkeys counts the passkeys that settle a challenge for the account.
	// A principal without passkeys answers zero.
	Passkeys(ctx context.Context, q dbmodels.Querier) (int64, error)
	// StoreTotpSecret puts an unconfirmed authenticator in place of whatever
	// unconfirmed one the account held.
	StoreTotpSecret(ctx context.Context, q dbmodels.Querier, encrypted string) error
	// ClaimTotpStep records step as the last one the account's authenticator
	// was accepted for, and reports false when that step or a later one
	// already was: the code is a replay.
	ClaimTotpStep(ctx context.Context, q dbmodels.Querier, step int64) (claimed bool, err error)
	// EnableTotp marks the authenticator confirmed, and reports false when a
	// concurrent confirmation already had.
	EnableTotp(ctx context.Context, q dbmodels.Querier) (enabled bool, err error)
	// DeleteTotp removes the authenticator.
	DeleteTotp(ctx context.Context, q dbmodels.Querier) error

	// Locked reports whether refused attempts have locked the account for
	// now.
	Locked(ctx context.Context, q dbmodels.Querier) (bool, error)
	// CountFailure counts one refused attempt and reports whether the account
	// is locked after it.
	CountFailure(ctx context.Context, q dbmodels.Querier) (locked bool, err error)
	// ResetFailures forgets the refused attempts counted so far.
	ResetFailures(ctx context.Context, q dbmodels.Querier) error

	// UnusedRecoveryCodes lists the codes the account may still spend.
	UnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) ([]RecoveryCode, error)
	// MarkRecoveryCodeUsed spends the code id names, and reports false when a
	// concurrent request spent it first.
	MarkRecoveryCodeUsed(ctx context.Context, q dbmodels.Querier, id uuid.UUID) (spent bool, err error)
	// CountUnusedRecoveryCodes counts the codes the account may still spend.
	CountUnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) (int64, error)
	// DeleteRecoveryCodes removes every code the account holds, used or not.
	DeleteRecoveryCodes(ctx context.Context, q dbmodels.Querier) error
	// CreateRecoveryCode stores one code by its hash.
	CreateRecoveryCode(ctx context.Context, q dbmodels.Querier, id uuid.UUID, hash string) error
	// ReleaseRecoveryCodes deletes the account's recovery codes once nothing
	// they could stand in for is left. The authenticator has just been
	// removed on q, and the codes stay while another factor remains.
	ReleaseRecoveryCodes(ctx context.Context, q dbmodels.Querier) error

	// FromChallenge reports whether the account was identified by the
	// challenge a password alone earned, rather than by a session. Only then
	// does finishing an enrollment also finish the sign-in, and only then is
	// there a challenge to claim.
	FromChallenge() bool
	// ClaimChallenge records the challenge as spent, and reports false when
	// it already was.
	ClaimChallenge(ctx context.Context, q dbmodels.Querier) (claimed bool, err error)
	// CanIssueSession reports whether IssueSession has what it needs, so an
	// enrollment can refuse before it commits rather than after.
	CanIssueSession() bool
	// IssueSession finishes a sign-in the second factor has settled.
	IssueSession(ctx context.Context) (*publirattypesv1.User, *publirattypesv1.AccessToken, error)

	// Encryptor seals the authenticator's secret. It is nil on a server
	// started without one.
	Encryptor() Encryptor
	// OTPAuthLabel is the issuer and the account name an authenticator app
	// lists the enrollment under.
	OTPAuthLabel() (issuer, accountName string)

	// Actions names the audit actions the principal records.
	Actions() Actions
	// Audit records one entry on the principal's audit trail.
	Audit(ctx context.Context, action, outcome, reason string)
	// LogVerification writes the security log line for a sign-in's second
	// step.
	LogVerification(ctx context.Context, outcome, reason string)
	// InternalError logs err with the account it happened to and answers the
	// generic error the client is given.
	InternalError(ctx context.Context, msg string, err error) error
}

// Encryptor seals and opens a stored secret.
type Encryptor interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

// Totp is an account's authenticator, confirmed or not.
type Totp struct {
	SecretEncrypted string
	EnabledAt       sql.NullTime
}

// RecoveryCode is one stored recovery code. Only its bcrypt hash is kept.
type RecoveryCode struct {
	ID       uuid.UUID
	CodeHash string
}

// Actions are the audit actions a principal records for its second factor. A
// wrong code is the same action as a right one with outcome failure, which is
// how both audit trails tell the two apart.
type Actions struct {
	Enrolled                 string
	Verified                 string
	RecoveryCodeUsed         string
	Disabled                 string
	RecoveryCodesRegenerated string
}

// The factors an audit entry names as the one that settled a step.
const (
	FactorTotp         = "totp"
	FactorRecoveryCode = "recovery_code"
	FactorPasskey      = "passkey"
)

// Factors is what an account holds of its second factors. A TOTP row that was
// started and never confirmed is not a factor: it cannot settle a challenge.
type Factors struct {
	Totp      Totp
	TotpFound bool
	Passkeys  int64
}

// TotpEnabled reports whether the account holds a confirmed authenticator.
func (f Factors) TotpEnabled() bool {
	return f.TotpFound && f.Totp.EnabledAt.Valid
}

// Any reports whether the account holds a factor at all.
func (f Factors) Any() bool {
	return f.TotpEnabled() || f.Passkeys > 0
}

// FactorsOf reads what the account holds of its second factors on q.
func FactorsOf(ctx context.Context, acct Account, q dbmodels.Querier) (Factors, error) {
	totp, found, err := acct.Totp(ctx, q)
	if err != nil {
		return Factors{}, acct.InternalError(ctx, "failed to get mfa totp", err)
	}
	passkeys, err := acct.Passkeys(ctx, q)
	if err != nil {
		return Factors{}, acct.InternalError(ctx, "failed to count passkeys", err)
	}
	return Factors{Totp: totp, TotpFound: found, Passkeys: passkeys}, nil
}
