package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentranking"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultRecommendedSeriesPageSize = int32(20)
	maxRecommendedSeriesPageSize     = int32(100)
)

// recommendedRankingEntityType is the half of the ranking snapshots this list
// reads. The batch also ranks episodes; the storefront slot links to series.
const recommendedRankingEntityType = "series"

// recommendedRankingKey picks the weekly snapshot over the daily one. Both are
// rebuilt every run from the same daily stats, and a week of signal moves the
// list with what readers are actually reading instead of with whatever one day
// happened to hold.
const recommendedRankingKey = contentranking.WeeklyRankingKey

// emptyRankingItems stands in for a tenant with no usable snapshot. The query
// takes the items array as it is stored, and an empty array simply leaves every
// series unranked — which is the cold-start list, newest first.
var emptyRankingItems = json.RawMessage("[]")

// seriesRanking is the tenant's latest ranking as this list needs it: the
// snapshot items exactly as the query wants them, and whether they say anything
// at all. Nothing is decoded out of the items here — the query owns how a rank
// is read, and the ranks it sorted by come back with its rows.
type seriesRanking struct {
	items json.RawMessage
	// ranked reports whether behavioural signals are behind this list. It is a
	// fact about the tenant, not about the page: a later page of a ranked list
	// is all new arrivals and still comes from a ranked tenant.
	ranked bool
}

// latestSeriesRanking reads the snapshot the recommendation order is built on.
//
// A tenant that has never been ranked is not an error: it is the cold start
// this list falls back for. Neither is a snapshot whose items are not an array
// — the ordering is advisory, and the same series in publication order beats
// failing the storefront over a row this repository's own batch wrote wrong.
// It is logged, because nothing else would notice.
func (s *apiServer) latestSeriesRanking(ctx context.Context, tenantID uuid.UUID) (seriesRanking, error) {
	snapshot, err := s.queriesFor(ctx).GetLatestContentRankingSnapshot(ctx, dbmodels.GetLatestContentRankingSnapshotParams{
		TenantID:   tenantID,
		RankingKey: recommendedRankingKey,
		EntityType: recommendedRankingEntityType,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return seriesRanking{items: emptyRankingItems}, nil
	}
	if err != nil {
		return seriesRanking{}, err
	}

	var items []json.RawMessage
	if err := json.Unmarshal(snapshot.Items, &items); err != nil {
		s.logger.ErrorContext(ctx, "ranking snapshot items are not an array; falling back to new arrivals",
			"tenant_id", tenantID.String(),
			"snapshot_id", snapshot.ID.String(),
			"error", err,
		)
		return seriesRanking{items: emptyRankingItems}, nil
	}
	if len(items) == 0 {
		return seriesRanking{items: emptyRankingItems}, nil
	}
	return seriesRanking{items: snapshot.Items, ranked: true}, nil
}

// The ListRecommendedSeries cursor carries the sort keys of the query in
// order: the rank the row sorted under, then the publication date and the id
// that order the unranked. Token rules: proto/README.md.
//
// The rank is the one the query reported for that row, never one recomputed
// from the snapshot here: a token built on a value the scan did not sort by
// points at a page that does not exist.
func encodeRecommendedCursor(
	direction pagination.Direction,
	sortRank int32,
	row dbmodels.ListActiveSeriesByIDsRow,
) string {
	return pagination.Encode(
		direction,
		strconv.FormatInt(int64(sortRank), 10),
		row.PublishedAt.Time.UTC().Format(time.RFC3339Nano),
		row.ID.String(),
	)
}

// A recovery token includes the boundary once, so the boundary row stays in
// the page when the rows beyond it were unpublished after the original token
// was issued.
func encodeRecommendedRecoveryToken(direction pagination.Direction, keys recommendedCursorKeys) string {
	return pagination.Encode(
		direction,
		strconv.FormatInt(int64(keys.rank.Int32), 10),
		keys.publishedAt.Time.UTC().Format(time.RFC3339Nano),
		keys.id.UUID.String(),
		seriesInclusiveKey,
	)
}

// recommendedCursorKeys is the decoded token, in the shape the keyset queries
// take.
type recommendedCursorKeys struct {
	rank        sql.NullInt32
	publishedAt sql.NullTime
	id          uuid.NullUUID
	inclusive   bool
}

func decodeRecommendedCursorKeys(cursor pagination.Cursor) (recommendedCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return recommendedCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != seriesInclusiveKey {
		return recommendedCursorKeys{}, invalid
	}
	rank, err := strconv.ParseInt(cursor.Keys[0], 10, 32)
	if err != nil {
		return recommendedCursorKeys{}, invalid
	}
	publishedAt, err := time.Parse(time.RFC3339Nano, cursor.Keys[1])
	if err != nil {
		return recommendedCursorKeys{}, invalid
	}
	id, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return recommendedCursorKeys{}, invalid
	}
	return recommendedCursorKeys{
		id:          uuid.NullUUID{UUID: id, Valid: true},
		inclusive:   inclusive,
		publishedAt: sql.NullTime{Time: publishedAt, Valid: true},
		rank:        sql.NullInt32{Int32: int32(rank), Valid: true},
	}, nil
}

// recommendedSeriesPageRow is one row of the keyset scan: the series, and the
// rank it sorted under.
type recommendedSeriesPageRow struct {
	id       uuid.UUID
	sortRank int32
}

func (s *apiServer) recommendedSeriesPageRows(
	ctx context.Context,
	tenantID uuid.UUID,
	ranking seriesRanking,
	reversed bool,
	keys recommendedCursorKeys,
	limit int32,
) ([]recommendedSeriesPageRow, error) {
	queries := s.queriesFor(ctx)

	if reversed {
		rows, err := queries.ListRecommendedSeriesIDsReversed(ctx, dbmodels.ListRecommendedSeriesIDsReversedParams{
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			CursorPublishedAt: keys.publishedAt,
			CursorRank:        keys.rank,
			Limit:             limit,
			RankingItems:      ranking.items,
			TenantID:          tenantID,
		})
		if err != nil {
			return nil, err
		}
		page := make([]recommendedSeriesPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, recommendedSeriesPageRow{id: row.ID, sortRank: row.SortRank})
		}
		return page, nil
	}

	rows, err := queries.ListRecommendedSeriesIDs(ctx, dbmodels.ListRecommendedSeriesIDsParams{
		CursorID:          keys.id,
		CursorInclusive:   keys.inclusive,
		CursorPublishedAt: keys.publishedAt,
		CursorRank:        keys.rank,
		Limit:             limit,
		RankingItems:      ranking.items,
		TenantID:          tenantID,
	})
	if err != nil {
		return nil, err
	}
	page := make([]recommendedSeriesPageRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, recommendedSeriesPageRow{id: row.ID, sortRank: row.SortRank})
	}
	return page, nil
}

// ListRecommendedSeries orders a tenant's published series by the latest
// ranking snapshot and then by publication date, and pages through the result.
// The storefront slot takes the first page; a "see more" view keeps paging into
// the tail, which is the newest-first list the slot showed before rankings
// existed.
//
// A ranked series that has since been unpublished simply drops out, and the
// series behind it move up: a snapshot is a batch's view of a past window, not
// a statement about what is published now.
func (s *apiServer) ListRecommendedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListRecommendedSeriesRequest],
) (*connect.Response[publirav1.ListRecommendedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRecommendedSeriesPageSize, maxRecommendedSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys recommendedCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeRecommendedCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}

	ranking, err := s.latestSeriesRanking(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the ranking snapshot", err, "tenant_id", tenant.ID.String())
	}

	// One row past the page: its presence is what says another page exists.
	pageRows, err := s.recommendedSeriesPageRows(
		ctx,
		tenant.ID,
		ranking,
		cursor.Direction == pagination.Backward,
		keys,
		limit+1,
	)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recommended series", err, "tenant_id", tenant.ID.String())
	}
	pageRows, hasMore := pagination.Page(pageRows, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(pageRows))
	sortRankByID := make(map[uuid.UUID]int32, len(pageRows))
	for _, pageRow := range pageRows {
		ids = append(ids, pageRow.id)
		sortRankByID[pageRow.id] = pageRow.sortRank
	}

	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recommended series", err, "tenant_id", tenant.ID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.ListRecommendedSeriesResponse{
		Series: items,
		Source: publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS,
	}
	if ranking.ranked {
		res.Source = publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = encodeRecommendedCursor(pagination.Backward, sortRankByID[first.ID], first)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeRecommendedCursor(pagination.Forward, sortRankByID[last.ID], last)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeRecommendedRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeRecommendedRecoveryToken(pagination.Forward, keys)
	}
	return connect.NewResponse(res), nil
}
