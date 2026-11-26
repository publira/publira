package adminapi

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/mfaflow"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// errFactorChangeUnconfirmed is a factor the account gained between the check
// of a request's confirmation and the change it was sent for: the request had
// nothing to prove when it was checked, and now it has.
var errFactorChangeUnconfirmed = errors.New("factor change unconfirmed")

// confirmFactorChange decides whether a signed-in account may add a second
// factor or remove one. An account that holds none adds its first on the
// session alone. One that holds a factor proves it still does with
// confirmation: a code from its authenticator, a recovery code, or an
// assertion from one of its passkeys, as the second step of a sign-in takes
// them. A session shows only that the step was answered once, and a factor
// added or removed on it alone would change what every later sign-in asks for
// without asking it.
//
// confirmed reports that a factor was proved, and factor names which, for the
// audit trail. A refusal has been recorded under action, and the error is the
// one to hand the client.
func (s *adminServer) confirmFactorChange(
	ctx context.Context,
	actor mfaActor,
	action string,
	confirmation *publiraadminv1.MfaConfirmation,
) (confirmed bool, factor string, err error) {
	acct := s.mfaAccount(actor)
	factors, err := mfaflow.FactorsOf(ctx, acct, acct.Queries(ctx))
	if err != nil {
		return false, "", err
	}
	if !factors.Any() {
		return false, "", nil
	}
	refuse := func(reason string, err error) (bool, string, error) {
		s.recordMfaAudit(ctx, actor, action, auditlog.OutcomeFailure, reason)
		return false, "", err
	}

	code := strings.TrimSpace(confirmation.GetCode())
	assertion := strings.TrimSpace(confirmation.GetPasskeyCredentialJson())
	switch {
	case code != "" && assertion != "":
		return refuse("invalid_input", connect.NewError(connect.CodeInvalidArgument, "send either code or passkey_credential_json, not both"))
	case assertion != "":
		if factors.Passkeys == 0 {
			return refuse("passkey_not_registered", passkeyNotRegisteredError())
		}
		_, reason, err := s.checkPasskeyAssertion(ctx, actor, assertion)
		if err != nil {
			if reason == "" {
				return false, "", err
			}
			return refuse(reason, err)
		}
		return true, mfaflow.FactorPasskey, nil
	default:
		var totp *mfaflow.Totp
		if factors.TotpEnabled() {
			totp = &factors.Totp
		}
		// A recovery code counts, as it does for DisableMfa: an account whose
		// authenticator or passkey is gone has to be able to put another in
		// its place.
		outcome, err := mfaflow.CheckCode(ctx, acct, totp, code, true)
		if err != nil {
			return refuse(outcome.Reason, err)
		}
		if outcome.RecoveryUsed {
			return true, mfaflow.FactorRecoveryCode, nil
		}
		return true, mfaflow.FactorTotp, nil
	}
}
