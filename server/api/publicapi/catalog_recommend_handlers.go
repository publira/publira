package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/contentranking"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultRecommendedSeriesSize = int32(20)
	maxRecommendedSeriesSize     = int32(100)
)

// recommendedRankingEntityType is the half of the ranking snapshots this slot
// reads. The batch also ranks episodes; the storefront slot links to series.
const recommendedRankingEntityType = "series"

// recommendedRankingKey picks the weekly snapshot over the daily one. Both are
// rebuilt every run from the same daily stats, and a week of signal moves the
// slot with what readers are actually reading instead of with whatever one day
// happened to hold.
const recommendedRankingKey = contentranking.WeeklyRankingKey

// newestSeriesOrder is the order the top-up runs in: the newest-first list
// this slot showed before there were any rankings to read.
var newestSeriesOrder = seriesOrders[publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC]

// rankingSnapshotItem is the part of one content_ranking_snapshots item this
// handler reads. The snapshot also carries the score and the counts behind it;
// the slot needs the order the batch already decided, so the rest stays in the
// JSON rather than being restated here.
type rankingSnapshotItem struct {
	EntityID string `json:"entity_id"`
}

// rankedSeriesIDs returns the series the latest snapshot ranks, best first.
// A tenant that has never been ranked is not an error: it is the cold start
// this slot has a fallback for, and it comes back as an empty list.
func (s *apiServer) rankedSeriesIDs(ctx context.Context, tenantID uuid.UUID) ([]uuid.UUID, error) {
	snapshot, err := s.queriesFor(ctx).GetLatestContentRankingSnapshot(ctx, dbmodels.GetLatestContentRankingSnapshotParams{
		TenantID:   tenantID,
		RankingKey: recommendedRankingKey,
		EntityType: recommendedRankingEntityType,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var items []rankingSnapshotItem
	if err := json.Unmarshal(snapshot.Items, &items); err != nil {
		return nil, err
	}

	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		id, err := uuid.Parse(item.EntityID)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// newestSeriesIDsExcluding returns up to `want` of the newest published series
// that are not already in `taken`. The ranked part of the list is fetched
// first, so the top-up must skip what it already holds; over-fetching by the
// size of that part is what guarantees enough rows survive the skip.
func (s *apiServer) newestSeriesIDsExcluding(
	ctx context.Context,
	tenantID uuid.UUID,
	taken map[uuid.UUID]struct{},
	want int32,
) ([]uuid.UUID, error) {
	candidates, err := s.activeSeriesPageIDs(
		ctx,
		tenantID,
		newestSeriesOrder,
		newestSeriesOrder.descending,
		seriesCursorKeys{},
		want+int32(len(taken)),
	)
	if err != nil {
		return nil, err
	}

	ids := make([]uuid.UUID, 0, want)
	for _, id := range candidates {
		if _, ok := taken[id]; ok {
			continue
		}
		ids = append(ids, id)
		if int32(len(ids)) == want {
			break
		}
	}
	return ids, nil
}

// ListRecommendedSeries fills the storefront recommendation slot from the
// latest ranking snapshot, and tops the list up with new arrivals so the slot
// is never short. A ranked series that has since been unpublished simply drops
// out and the top-up takes its place: a snapshot is a batch's view of a past
// window, not a statement about what is published now.
func (s *apiServer) ListRecommendedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListRecommendedSeriesRequest],
) (*connect.Response[publirav1.ListRecommendedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRecommendedSeriesSize, maxRecommendedSeriesSize)

	rankedIDs, err := s.rankedSeriesIDs(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the ranking snapshot", err, "tenant_id", tenant.ID.String())
	}
	if int32(len(rankedIDs)) > limit {
		rankedIDs = rankedIDs[:limit]
	}
	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, rankedIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recommended series", err, "tenant_id", tenant.ID.String())
	}

	source := publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING
	if len(rows) == 0 {
		source = publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS
	}

	if int32(len(rows)) < limit {
		taken := make(map[uuid.UUID]struct{}, len(rows))
		for _, row := range rows {
			taken[row.ID] = struct{}{}
		}
		fillIDs, err := s.newestSeriesIDsExcluding(ctx, tenant.ID, taken, limit-int32(len(rows)))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list recommended series", err, "tenant_id", tenant.ID.String())
		}
		fillRows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, fillIDs)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list recommended series", err, "tenant_id", tenant.ID.String())
		}
		rows = append(rows, fillRows...)
	}

	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirav1.ListRecommendedSeriesResponse{
		Series: items,
		Source: source,
	}), nil
}
