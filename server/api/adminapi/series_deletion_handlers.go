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

// seriesDeletionBlockers maps what GetSeriesDeletionBlocker answers to the
// ErrorInfo reason the refusal carries.
var seriesDeletionBlockers = map[string]string{
	"episode":           rpcerrors.ReasonSeriesHasEpisodes,
	"volume":            rpcerrors.ReasonSeriesHasVolumes,
	"subscription_plan": rpcerrors.ReasonSeriesInSubscriptionPlan,
	"promotion_code":    rpcerrors.ReasonSeriesInPromotionCode,
}

func (s *adminServer) DeleteSeries(
	ctx context.Context,
	req *publiraadminv1.DeleteSeriesRequest,
) (*publiraadminv1.DeleteSeriesResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.LockSeriesForDeletionRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.deleteSeries(txCtx, tenant.ID, seriesID)
		if err != nil {
			return nil, err
		}
		deleted = row
		// The series leaves every list, page, and sitemap that showed it, and
		// so may the label it was the last published series of.
		return append(seriesRevalidateTags(tenant.ID.String(), row.PublicID), fmt.Sprintf("tenant:%s:labels", tenant.ID.String())), nil
	}); err != nil {
		return nil, err
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "series_deleted",
		TargetType:  "series",
		TargetID:    deleted.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		Reason:      deleted.Title,
		ClientIP:    clientip.FromContext(ctx),
	})
	return &publiraadminv1.DeleteSeriesResponse{}, nil
}

// deleteSeries deletes the series in the transaction txCtx carries, or refuses
// it with the reason the first reference to it names. It answers the row it
// locked, which still names what was deleted.
func (s *adminServer) deleteSeries(txCtx context.Context, tenantID, seriesID uuid.UUID) (dbmodels.LockSeriesForDeletionRow, error) {
	q := s.queriesFor(txCtx)
	fail := func(msg string, err error) error {
		return s.internalDBError(txCtx, msg, err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}

	series, err := q.LockSeriesForDeletion(txCtx, dbmodels.LockSeriesForDeletionParams{TenantID: tenantID, ID: seriesID})
	if errors.Is(err, sql.ErrNoRows) {
		return series, connect.NewError(connect.CodeNotFound, "series not found")
	}
	if err != nil {
		return series, fail("failed to lock the series for deletion", err)
	}

	blocker, err := q.GetSeriesDeletionBlocker(txCtx, dbmodels.GetSeriesDeletionBlockerParams{TenantID: tenantID, SeriesID: seriesID})
	if err != nil {
		return series, fail("failed to check what refers to the series", err)
	}
	if blocker != "" {
		reason, ok := seriesDeletionBlockers[blocker]
		if !ok {
			return series, s.internalError(txCtx, "the series deletion check answered a reference this build does not know", fmt.Errorf("blocker %q", blocker), "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
		return series, rpcerrors.NewErrorInfoError(
			connect.CodeFailedPrecondition,
			fmt.Errorf("series has a %s and cannot be deleted", blocker),
			reason,
		)
	}

	// The Authors it credited are searchable through it, so their documents
	// are read again once it is gone, and so is its label's.
	credited, err := q.DeleteSeriesCreatorsBySeriesID(txCtx, seriesID)
	if err != nil {
		return series, fail("failed to delete the series' credits", err)
	}
	refs := []catalogindex.Ref{catalogindex.SeriesRef(series.ID), catalogindex.LabelRef(series.LabelID.UUID)}
	for _, creatorID := range credited {
		refs = append(refs, catalogindex.CreatorRef(creatorID))
	}

	if err := q.DeleteSeriesContentEvents(txCtx, dbmodels.DeleteSeriesContentEventsParams{TenantID: tenantID, SeriesID: seriesID}); err != nil {
		return series, fail("failed to delete the series' content events", err)
	}
	if err := q.DeleteSeriesBundles(txCtx, dbmodels.DeleteSeriesBundlesParams{TenantID: tenantID, SeriesID: seriesID}); err != nil {
		return series, fail("failed to delete the series' bundle checkouts", err)
	}
	if err := q.DeleteSeriesByIDForTenant(txCtx, dbmodels.DeleteSeriesByIDForTenantParams{TenantID: tenantID, ID: seriesID}); err != nil {
		return series, fail("failed to delete the series", err)
	}
	if err := q.DeleteSeriesPromotionCodes(txCtx, dbmodels.DeleteSeriesPromotionCodesParams{TenantID: tenantID, SeriesID: seriesID}); err != nil {
		return series, fail("failed to delete the promotion codes for the series", err)
	}
	if err := catalogindex.Queue(txCtx, q, tenantID, refs...); err != nil {
		return series, fail("failed to queue the search index sync for the deleted series", err)
	}
	return series, nil
}
