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

// labelDeletionBlockers maps what GetLabelDeletionBlocker answers to the
// ErrorInfo reason the refusal carries.
var labelDeletionBlockers = map[string]string{
	"series":            rpcerrors.ReasonLabelHasSeries,
	"subscription_plan": rpcerrors.ReasonLabelInSubscriptionPlan,
	"promotion_code":    rpcerrors.ReasonLabelInPromotionCode,
}

func (s *adminServer) DeleteLabel(
	ctx context.Context,
	req *publiraadminv1.DeleteLabelRequest,
) (*publiraadminv1.DeleteLabelResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	labelID, err := parseRecordID(req.LabelId, "label_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.LockLabelForDeletionRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.deleteLabel(txCtx, tenant.ID, labelID)
		if err != nil {
			return nil, err
		}
		deleted = row
		// No series names the label, so only the label list, its page, and
		// the sitemap, all cached under `:labels`, still show it.
		return []string{fmt.Sprintf("tenant:%s:labels", tenant.ID.String())}, nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "label_deleted",
		TargetType:  "label",
		TargetID:    deleted.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      deleted.Name,
		ClientIP:    clientip.FromContext(ctx),
	})
	return &publiraadminv1.DeleteLabelResponse{}, nil
}

// deleteLabel deletes the label in the transaction txCtx carries, or refuses
// it with the reason the first reference to it names. It answers the row it
// locked, which still names what was deleted.
func (s *adminServer) deleteLabel(txCtx context.Context, tenantID, labelID uuid.UUID) (dbmodels.LockLabelForDeletionRow, error) {
	q := s.queriesFor(txCtx)
	fail := func(msg string, err error) error {
		return s.internalDBError(txCtx, msg, err, "tenant_id", tenantID.String(), "label_id", labelID.String())
	}

	label, err := q.LockLabelForDeletion(txCtx, dbmodels.LockLabelForDeletionParams{TenantID: tenantID, ID: labelID})
	if errors.Is(err, sql.ErrNoRows) {
		return label, connect.NewError(connect.CodeNotFound, "label not found")
	}
	if err != nil {
		return label, fail("failed to lock the label for deletion", err)
	}

	blocker, err := q.GetLabelDeletionBlocker(txCtx, dbmodels.GetLabelDeletionBlockerParams{TenantID: tenantID, LabelID: labelID})
	if err != nil {
		return label, fail("failed to check what refers to the label", err)
	}
	if blocker != "" {
		reason, ok := labelDeletionBlockers[blocker]
		if !ok {
			return label, s.internalError(txCtx, "the label deletion check answered a reference this build does not know", fmt.Errorf("blocker %q", blocker), "tenant_id", tenantID.String(), "label_id", labelID.String())
		}
		return label, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			fmt.Errorf("label has a %s and cannot be deleted", blocker),
			reason,
		)
	}

	if err := q.DeleteLabelByIDForTenant(txCtx, dbmodels.DeleteLabelByIDForTenantParams{TenantID: tenantID, ID: labelID}); err != nil {
		return label, fail("failed to delete the label", err)
	}
	if err := q.DeleteLabelPromotionCodes(txCtx, dbmodels.DeleteLabelPromotionCodesParams{TenantID: tenantID, LabelID: labelID}); err != nil {
		return label, fail("failed to delete the promotion codes for the label", err)
	}
	if err := catalogindex.Queue(txCtx, q, tenantID, catalogindex.LabelRef(labelID)); err != nil {
		return label, fail("failed to queue the search index sync for the deleted label", err)
	}
	return label, nil
}
