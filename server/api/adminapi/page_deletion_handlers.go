package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// pageDeletionBlockers maps what GetPageDeletionBlocker answers to the
// ErrorInfo reason the refusal carries.
var pageDeletionBlockers = map[string]string{
	"published":  rpcerrors.ReasonPagePublished,
	"legal_page": rpcerrors.ReasonPageIsLegalPage,
	"agreed_to":  rpcerrors.ReasonPageAgreedTo,
}

func (s *adminServer) DeletePage(
	ctx context.Context,
	req *publiraadminv1.DeletePageRequest,
) (*publiraadminv1.DeletePageResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.PageId)
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.LockPageForDeletionRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.deletePage(txCtx, tenant.ID, pageID)
		if err != nil {
			return nil, err
		}
		deleted = row
		// No translation of the page is published, so the storefront serves
		// nothing of it any more. The drop is the one unpublishing makes, so
		// nothing it cached of the page, at its id or at its slug, outlives it.
		return pageRevalidateTags(tenant.ID, pageID), nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_deleted",
		TargetType:  "page",
		TargetID:    deleted.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      fmt.Sprintf("%s (%s)", deleted.Title, deleted.Slug),
		ClientIP:    clientip.FromContext(ctx),
	})
	return &publiraadminv1.DeletePageResponse{}, nil
}

// deletePage deletes the page in the transaction txCtx carries, or refuses it
// with the first reason it has to be kept. It answers the row it locked, which
// still names what was deleted.
func (s *adminServer) deletePage(txCtx context.Context, tenantID, pageID uuid.UUID) (dbmodels.LockPageForDeletionRow, error) {
	q := s.queriesFor(txCtx)
	fail := func(msg string, err error) error {
		return s.internalDBError(txCtx, msg, err, "tenant_id", tenantID.String(), "page_id", pageID.String())
	}

	page, err := q.LockPageForDeletion(txCtx, dbmodels.LockPageForDeletionParams{TenantID: tenantID, ID: pageID})
	if errors.Is(err, sql.ErrNoRows) {
		return page, connect.NewError(connect.CodeNotFound, "page not found")
	}
	if err != nil {
		return page, fail("failed to lock the page for deletion", err)
	}
	if err := q.LockPageVersionsForDeletion(txCtx, dbmodels.LockPageVersionsForDeletionParams{TenantID: tenantID, PageID: pageID}); err != nil {
		return page, fail("failed to lock the page's versions for deletion", err)
	}

	blocker, err := q.GetPageDeletionBlocker(txCtx, dbmodels.GetPageDeletionBlockerParams{TenantID: tenantID, PageID: pageID})
	if err != nil {
		return page, fail("failed to check whether the page has to be kept", err)
	}
	if blocker != "" {
		reason, ok := pageDeletionBlockers[blocker]
		if !ok {
			return page, s.internalError(txCtx, "the page deletion check answered a reason this build does not know", fmt.Errorf("blocker %q", blocker), "tenant_id", tenantID.String(), "page_id", pageID.String())
		}
		return page, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			fmt.Errorf("page has to be kept (%s) and cannot be deleted", blocker),
			reason,
		)
	}

	if err := q.DeletePageByIDForTenant(txCtx, dbmodels.DeletePageByIDForTenantParams{TenantID: tenantID, ID: pageID}); err != nil {
		return page, fail("failed to delete the page", err)
	}
	return page, nil
}
