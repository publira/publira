package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// creatorDeletionBlockers maps what GetCreatorDeletionBlocker answers to the
// ErrorInfo reason the refusal carries.
var creatorDeletionBlockers = map[string]string{
	"credit":            rpcerrors.ReasonCreatorCredited,
	"royalty_statement": rpcerrors.ReasonCreatorOnRoyaltyStatement,
	"linked_account":    rpcerrors.ReasonCreatorHasLinkedAccount,
}

func (s *adminServer) DeleteCreator(
	ctx context.Context,
	req *publiraadminv1.DeleteCreatorRequest,
) (*publiraadminv1.DeleteCreatorResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	creatorID, err := parseRecordID(req.CreatorId, "creator_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.LockCreatorForDeletionRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.deleteCreator(txCtx, tenant.ID, creatorID)
		if err != nil {
			return nil, err
		}
		deleted = row
		// No series or episode credits the creator, so only the creator list,
		// their page, and the sitemap, all cached under `:creators`, still
		// show them.
		return []string{fmt.Sprintf("tenant:%s:creators", tenant.ID.String())}, nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "creator_deleted",
		TargetType:  "creator",
		TargetID:    deleted.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      deleted.Name,
		ClientIP:    clientip.FromContext(ctx),
	})
	return &publiraadminv1.DeleteCreatorResponse{}, nil
}

// deleteCreator deletes the creator in the transaction txCtx carries, or
// refuses it with the reason the first reference to them names. It answers the
// row it locked, which still names what was deleted.
func (s *adminServer) deleteCreator(txCtx context.Context, tenantID, creatorID uuid.UUID) (dbmodels.LockCreatorForDeletionRow, error) {
	q := s.queriesFor(txCtx)
	fail := func(msg string, err error) error {
		return s.internalDBError(txCtx, msg, err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
	}

	creator, err := q.LockCreatorForDeletion(txCtx, dbmodels.LockCreatorForDeletionParams{TenantID: tenantID, ID: creatorID})
	if errors.Is(err, sql.ErrNoRows) {
		return creator, connect.NewError(connect.CodeNotFound, "creator not found")
	}
	if err != nil {
		return creator, fail("failed to lock the creator for deletion", err)
	}

	blocker, err := q.GetCreatorDeletionBlocker(txCtx, dbmodels.GetCreatorDeletionBlockerParams{TenantID: tenantID, CreatorID: creatorID})
	if err != nil {
		return creator, fail("failed to check what refers to the creator", err)
	}
	if blocker != "" {
		reason, ok := creatorDeletionBlockers[blocker]
		if !ok {
			return creator, s.internalError(txCtx, "the creator deletion check answered a reference this build does not know", fmt.Errorf("blocker %q", blocker), "tenant_id", tenantID.String(), "creator_id", creatorID.String())
		}
		return creator, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			fmt.Errorf("creator has a %s and cannot be deleted", blocker),
			reason,
		)
	}

	if err := q.DeleteCreatorByIDForTenant(txCtx, dbmodels.DeleteCreatorByIDForTenantParams{TenantID: tenantID, ID: creatorID}); err != nil {
		return creator, fail("failed to delete the creator", err)
	}
	if err := catalogindex.Queue(txCtx, q, tenantID, catalogindex.CreatorRef(creatorID)); err != nil {
		return creator, fail("failed to queue the search index sync for the deleted creator", err)
	}
	return creator, nil
}
