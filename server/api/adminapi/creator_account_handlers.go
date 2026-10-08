package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// creatorAccountAuditTargetID names both sides of a link, because the row it
// describes has no identifier of its own and is gone once it is unlinked.
func creatorAccountAuditTargetID(creatorPublicID, readerPublicID string) string {
	return creatorPublicID + "/" + readerPublicID
}

func (s *adminServer) creatorAccounts(ctx context.Context, tenantID, creatorID uuid.UUID) ([]*publiraadminv1.CreatorAccount, error) {
	rows, err := s.queriesFor(ctx).ListCreatorAccountsByCreatorID(ctx, dbmodels.ListCreatorAccountsByCreatorIDParams{TenantID: tenantID, CreatorID: creatorID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator accounts", err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
	}
	accounts := make([]*publiraadminv1.CreatorAccount, 0, len(rows))
	for _, row := range rows {
		accounts = append(accounts, &publiraadminv1.CreatorAccount{
			Reader: adminReader(readerRow{
				ID:              row.ID,
				PublicID:        row.PublicID,
				Name:            row.Name,
				Email:           row.Email,
				Status:          row.Status,
				CreatedAt:       row.CreatedAt,
				EmailVerifiedAt: row.EmailVerifiedAt,
				Role:            row.Role,
			}),
			LinkedAt: row.LinkedAt.UTC().Format(time.RFC3339),
		})
	}
	return accounts, nil
}

// creatorAccountsForSession is the creator's links for a caller allowed to see
// readers, and none for anyone else.
func (s *adminServer) creatorAccountsForSession(ctx context.Context, tenantID, creatorID uuid.UUID) ([]*publiraadminv1.CreatorAccount, error) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok || sessionCtx.Role != auth.RoleTenantAdmin {
		return nil, nil
	}
	return s.creatorAccounts(ctx, tenantID, creatorID)
}

// changeCreatorAccount commits a link write and its audit entry together, and
// answers with the creator's links as they stand afterwards. write reports the
// reader's public_id, or "" when it changed nothing.
func (s *adminServer) changeCreatorAccount(
	ctx context.Context,
	sessionCtx rpcmiddleware.SessionContext,
	action string,
	creator dbmodels.GetCreatorByIDForTenantRow,
	write func(ctx context.Context) (string, error),
) ([]*publiraadminv1.CreatorAccount, error) {
	tenantID := creator.TenantID
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin creator account transaction", err, "tenant_id", tenantID.String(), "action", action)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	readerPublicID, err := write(txCtx)
	if err != nil {
		return nil, err
	}
	if readerPublicID != "" {
		if err := auditlog.WriteTenant(ctx, queries, s.logger, auditlog.TenantEntry{
			TenantID:    tenantID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      action,
			TargetType:  "creator_account",
			TargetID:    creatorAccountAuditTargetID(creator.PublicID, readerPublicID),
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record creator account change", err, "tenant_id", tenantID.String(), "action", action, "creator_id", creator.ID.String())
		}
	}
	accounts, err := s.creatorAccounts(txCtx, tenantID, creator.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit creator account change", err, "tenant_id", tenantID.String(), "action", action, "creator_id", creator.ID.String())
	}
	return accounts, nil
}

// LinkCreatorAccount records that a reader account belongs to a creator. A
// link hands out the creator's paid work, so it is the tenant admin's to make.
func (s *adminServer) LinkCreatorAccount(
	ctx context.Context,
	req *publiraadminv1.LinkCreatorAccountRequest,
) (*publiraadminv1.LinkCreatorAccountResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	creatorID, err := parseRecordID(req.CreatorId, "creator_id")
	if err != nil {
		return nil, err
	}
	readerID, err := readerIDArg(req.ReaderId)
	if err != nil {
		return nil, err
	}
	creator, err := s.creatorByID(ctx, tenant.ID, creatorID)
	if err != nil {
		return nil, err
	}

	accounts, err := s.changeCreatorAccount(ctx, sessionCtx, "creator_account_linked", creator, func(ctx context.Context) (string, error) {
		reader, err := s.tenantReaderByID(ctx, tenant.ID, readerID)
		if err != nil {
			return "", err
		}
		// The readers screen lists staff accounts too, but a link is a
		// reader's: a staff account answers as one of another tenant does.
		if reader.Role != "" {
			return "", readerNotFoundError()
		}
		if reader.Status != "active" {
			return "", rpcerrors.NewFieldViolationError(connect.CodeFailedPrecondition, errors.New("reader is not active"), "reader_id")
		}
		inserted, err := s.queriesFor(ctx).CreateCreatorAccount(ctx, dbmodels.CreateCreatorAccountParams{
			TenantID:  tenant.ID,
			CreatorID: creator.ID,
			UserID:    reader.ID,
		})
		if err != nil {
			// The creator or the account was deleted after it was read.
			if dberr.IsForeignKeyViolation(err) {
				return "", connect.NewError(connect.CodeNotFound, "creator or reader not found")
			}
			return "", s.internalDBError(ctx, "failed to link creator account", err, "tenant_id", tenant.ID.String(), "creator_id", creator.ID.String(), "reader_id", reader.ID.String())
		}
		if inserted == 0 {
			return "", nil
		}
		return reader.PublicID, nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.LinkCreatorAccountResponse{Accounts: accounts}, nil
}

// UnlinkCreatorAccount removes a link. The account need not be a reader any
// more, so a link to an account that has since become staff can still go.
func (s *adminServer) UnlinkCreatorAccount(
	ctx context.Context,
	req *publiraadminv1.UnlinkCreatorAccountRequest,
) (*publiraadminv1.UnlinkCreatorAccountResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	creatorID, err := parseRecordID(req.CreatorId, "creator_id")
	if err != nil {
		return nil, err
	}
	readerID, err := readerIDArg(req.ReaderId)
	if err != nil {
		return nil, err
	}
	creator, err := s.creatorByID(ctx, tenant.ID, creatorID)
	if err != nil {
		return nil, err
	}

	accounts, err := s.changeCreatorAccount(ctx, sessionCtx, "creator_account_unlinked", creator, func(ctx context.Context) (string, error) {
		readerPublicID, err := s.queriesFor(ctx).DeleteCreatorAccount(ctx, dbmodels.DeleteCreatorAccountParams{
			TenantID:  tenant.ID,
			CreatorID: creator.ID,
			UserID:    readerID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", s.internalDBError(ctx, "failed to unlink creator account", err, "tenant_id", tenant.ID.String(), "creator_id", creator.ID.String(), "reader_id", readerID.String())
		}
		return readerPublicID, nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UnlinkCreatorAccountResponse{Accounts: accounts}, nil
}
