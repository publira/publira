package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenantwebauthn"
)

// auditActionReaderMfaReset is what a Tenant admin removing a reader's
// two-step verification is recorded as.
const auditActionReaderMfaReset = "reader_mfa_reset"

// ResetReaderMfa removes the two-step verification of an account of the
// tenant, for a reader who lost every factor and recovery code, as
// publiractl tenant member reset-mfa does for staff: it is the same reset,
// with the Tenant admin as the actor on the tenant's own audit trail. The
// caller's own account is refused: a stolen session could otherwise strip the
// account of the factor that guards every other sign-in to it.
func (s *adminServer) ResetReaderMfa(
	ctx context.Context,
	req *publiraadminv1.ResetReaderMfaRequest,
) (*publiraadminv1.ResetReaderMfaResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	readerID, err := readerIDArg(req.ReaderId)
	if err != nil {
		return nil, err
	}
	if readerID == sessionCtx.User.ID {
		return nil, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			errors.New("an administrator cannot remove the two-step verification of their own account"),
			rpcerrors.ReasonOwnAccount,
		)
	}

	var reader *publiraadminv1.AdminReader
	err = s.changeReader(ctx, sessionCtx, auditActionReaderMfaReset, readerID, func(tx *sql.Tx, queries *dbmodels.Queries) (string, error) {
		row, err := queries.GetTenantReaderByID(ctx, dbmodels.GetTenantReaderByIDParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			ID:       readerID,
		})
		if err != nil {
			return "", err
		}
		if _, err := tenantmembers.ResetMFA(ctx, tx, tenantmembers.ResetMFAParams{
			TenantID:     tenant.ID,
			UserPublicID: row.PublicID,
		}); err != nil {
			if errors.Is(err, tenantmembers.ErrMFANotSetUp) {
				return "", connect.NewError(connect.CodeFailedPrecondition, "the reader has no two-step verification set up")
			}
			return "", err
		}
		reader, err = adminReaderDetail(ctx, queries, tenant.ID, readerRow(row))
		return row.PublicID, err
	})
	if errors.Is(err, errReaderUnchanged) {
		// The only row the write can miss is the reader's own.
		return nil, readerNotFoundError()
	}
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ResetReaderMfaResponse{Reader: reader}, nil
}

// readerMfaEnabled reports whether the account holds a second factor that
// ResetReaderMfa removes. It counts a console passkey of any RP ID, as the
// reset deletes them all, and no passkey the account signs in to the site
// with, which the reset leaves.
func readerMfaEnabled(ctx context.Context, q Querier, userID uuid.UUID) (bool, error) {
	totp, err := q.GetUserMfaTotpByUserID(ctx, userID)
	switch {
	case err == nil:
		if totp.EnabledAt.Valid {
			return true, nil
		}
	case !errors.Is(err, sql.ErrNoRows):
		return false, fmt.Errorf("get mfa totp: %w", err)
	}
	passkeys, err := q.CountUserWebauthnCredentials(ctx, dbmodels.CountUserWebauthnCredentialsParams{
		UserID:       userID,
		RelyingParty: tenantwebauthn.KindAdminConsole,
	})
	if err != nil {
		return false, fmt.Errorf("count console passkeys: %w", err)
	}
	return passkeys > 0, nil
}
