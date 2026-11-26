package publicapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// accountConfirmation is the proof of the account that BeginPasskeyRegistration,
// DeletePasskey and UnlinkIdentity take on top of the session, in the three
// forms DeleteMe and RequestEmailChange already take: the password, a fresh
// sign-in to a linked provider, or an assertion made with one of the account's
// passkeys. Each of the three steps adds or takes away a way to sign in, so a
// session alone, which may be one left open on a shared device, should not be
// enough to take one; a confirmation that is sent is checked and spent.
type accountConfirmation struct {
	password    string
	provider    publirav1.IdentityProvider
	idToken     string
	nonce       string
	passkeyJSON string
}

// sent reports whether any of the three forms was sent. A client of the
// release before this one sends none, and the step still takes it on the
// session alone until the clients that ask for a confirmation are out.
func (c accountConfirmation) sent() bool {
	return strings.TrimSpace(c.password) != "" ||
		strings.TrimSpace(c.idToken) != "" ||
		strings.TrimSpace(c.passkeyJSON) != ""
}

// single reports whether exactly one of the three forms was sent.
func (c accountConfirmation) single() bool {
	return confirmationsGiven(
		strings.TrimSpace(c.password) != "",
		strings.TrimSpace(c.idToken) != "",
		strings.TrimSpace(c.passkeyJSON) != "",
	) == 1
}

func accountConfirmationRequiredError() error {
	return connect.NewError(connect.CodeInvalidArgument, "one of password, id_token or passkey_credential_json is required")
}

// confirmAccount checks the confirmation against user, the account row as the
// caller holds it, and spends a sign-in or an assertion on q, so a caller
// inside a transaction spends it only with the step it confirms. A password is
// charged against the account's step-up allowance first, as every password
// checked on top of a session is. The reason it returns is the audit outcome
// of a refusal.
func (s *apiServer) confirmAccount(
	ctx context.Context,
	q dbmodels.Querier,
	tenant dbmodels.Tenant,
	user dbmodels.User,
	confirmation accountConfirmation,
) (string, error) {
	switch {
	case strings.TrimSpace(confirmation.password) != "":
		if err := s.chargeStepUp(ctx, tenant.ID, user.ID); err != nil {
			return "rate_limited", err
		}
		if !auth.VerifyUserPassword(confirmation.password, user.PasswordHash) {
			// Not Unauthenticated: the session is fine, the confirmation field
			// is wrong, and a client drops a session it gets Unauthenticated
			// for.
			return "invalid_password", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("invalid password"), "password")
		}
		s.clearStepUp(ctx, tenant.ID, user.ID)
	case strings.TrimSpace(confirmation.idToken) != "":
		if err := s.confirmWithIdentity(ctx, q, tenant.ID, user.ID, confirmation.provider, confirmation.idToken, confirmation.nonce); err != nil {
			return "invalid_identity_confirmation", err
		}
	default:
		if err := s.confirmWithPasskey(ctx, q, tenant, user, confirmation.passkeyJSON); err != nil {
			return "invalid_passkey_confirmation", err
		}
	}
	return "", nil
}

// enqueueReaderSignInMethodChangedNoticeEmail queues the mail that tells the
// account's confirmed address a way to sign in was added or taken away. The
// confirmation the step asked for proves the caller knew the account, not
// that they are its owner, so the owner hears of every such change.
//
// subject is the row the change is about, the passkey or the provider link,
// which keeps a retried step to one mail and two changes to two.
func enqueueReaderSignInMethodChangedNoticeEmail(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID, userID uuid.UUID,
	change, provider string,
	subject uuid.UUID,
) error {
	payload, err := json.Marshal(outbox.ReaderSignInMethodChangedNoticeEmailPayload{
		TenantID: tenantID.String(),
		UserID:   userID.String(),
		Change:   change,
		Provider: provider,
	})
	if err != nil {
		return fmt.Errorf("marshal reader sign-in method changed notice email event: %w", err)
	}
	return insertPublicOutboxEvent(ctx, queries, tenantID, outbox.EventTypeReaderSignInMethodChangedNoticeEmail, payload,
		"reader_sign_in_method_changed_notice_email:"+change+":"+subject.String())
}
