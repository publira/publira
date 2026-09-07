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
	defaultRankedSeriesPageSize = int32(20)
	maxRankedSeriesPageSize     = int32(100)
)

// rankingSnapshotPairSize is how many snapshots one page reads: the one it
// shows, and the one before it, which is where a previous position comes from.
const rankingSnapshotPairSize = int32(2)

// rankingKeyForPeriod maps the requested period onto the key the batch files
// its snapshots under. An unspecified period is the daily ranking, the way an
// unspecified order is the default order elsewhere; a value from a newer
// client names a period this build cannot rank, and saying so beats quietly
// answering with a different one.
func rankingKeyForPeriod(period publirav1.RankingPeriod) (string, error) {
	switch period {
	case publirav1.RankingPeriod_RANKING_PERIOD_UNSPECIFIED, publirav1.RankingPeriod_RANKING_PERIOD_DAILY:
		return contentranking.DailyRankingKey, nil
	case publirav1.RankingPeriod_RANKING_PERIOD_WEEKLY:
		return contentranking.WeeklyRankingKey, nil
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("period is unknown"))
	}
}

// rankingItem is one entry of a snapshot's items array, cut down to what a
// position needs. The rank is a pointer so an item written without one is told
// apart from an item at position 0 instead of folded into it.
type rankingItem struct {
	EntityID uuid.UUID `json:"entity_id"`
	Rank     *int32    `json:"rank"`
}

// rankingSnapshots is the pair one page of the ranking is built from.
type rankingSnapshots struct {
	// current is the snapshot the page comes from. Only meaningful when found.
	current dbmodels.ContentRankingSnapshot
	// previousRanks is the position each series held in the snapshot before
	// current. A series missing from it is a new entry, which is why the map
	// is read with the two-value form rather than compared against zero.
	previousRanks map[uuid.UUID]int32
	// found reports whether the tenant has been ranked at all.
	found bool
}

// latestRankingSnapshots reads the snapshot a page is built from together with
// the one before it.
//
// A tenant the batch has not ranked yet is not an error: the batch runs daily
// and a tenant created since the last run simply has nothing yet.
func (s *apiServer) latestRankingSnapshots(
	ctx context.Context,
	tenantID uuid.UUID,
	rankingKey string,
) (rankingSnapshots, error) {
	rows, err := s.queriesFor(ctx).ListLatestContentRankingSnapshots(ctx, dbmodels.ListLatestContentRankingSnapshotsParams{
		TenantID:   tenantID,
		RankingKey: rankingKey,
		EntityType: seriesRankingEntityType,
		Limit:      rankingSnapshotPairSize,
	})
	if err != nil {
		return rankingSnapshots{}, err
	}
	if len(rows) == 0 {
		return rankingSnapshots{}, nil
	}

	snapshots := rankingSnapshots{current: rows[0], found: true}
	if len(rows) > 1 {
		snapshots.previousRanks = s.rankPositions(ctx, rows[1])
	}
	return snapshots, nil
}

// rankPositions reads the positions of one snapshot into a lookup.
//
// Duplicate entity ids are folded with the lowest rank, which is what the
// keyset scan does with min(), so a movement marker compares the position the
// list would itself have shown for that snapshot.
//
// A snapshot this repository's own batch wrote wrong costs the page its up and
// down markers, not the ranking: the markers decorate positions that are
// correct without them. It is logged, because nothing else would notice.
func (s *apiServer) rankPositions(ctx context.Context, snapshot dbmodels.ContentRankingSnapshot) map[uuid.UUID]int32 {
	var items []rankingItem
	if err := json.Unmarshal(snapshot.Items, &items); err != nil {
		s.logger.ErrorContext(ctx, "ranking snapshot items are unreadable; serving the ranking without movement markers",
			"tenant_id", snapshot.TenantID.String(),
			"snapshot_id", snapshot.ID.String(),
			"error", err,
		)
		return nil
	}

	positions := make(map[uuid.UUID]int32, len(items))
	for _, item := range items {
		if item.Rank == nil {
			continue
		}
		if existing, ok := positions[item.EntityID]; ok && existing <= *item.Rank {
			continue
		}
		positions[item.EntityID] = *item.Rank
	}
	return positions
}

// The ListRankedSeries cursor carries the period it was built for, then the
// sort keys of the scan: the position the row holds in the snapshot, and the
// series id that keeps that key unique. A token from the other period is
// rejected rather than reinterpreted — the same position names a different
// series there. Token rules: proto/README.md.
func encodeRankedSeriesCursor(direction pagination.Direction, rankingKey string, rank int32, id uuid.UUID) string {
	return pagination.Encode(direction, rankingKey, strconv.FormatInt(int64(rank), 10), id.String())
}

// A recovery token includes the boundary once, so the boundary row stays in
// the page when the rows beyond it were unpublished after the original token
// was issued.
func encodeRankedSeriesRecoveryToken(
	direction pagination.Direction,
	rankingKey string,
	keys rankedSeriesCursorKeys,
) string {
	return pagination.Encode(
		direction,
		rankingKey,
		strconv.FormatInt(int64(keys.rank.Int32), 10),
		keys.id.UUID.String(),
		seriesInclusiveKey,
	)
}

// rankedSeriesCursorKeys is the decoded token, in the shape the keyset queries
// take.
type rankedSeriesCursorKeys struct {
	rank      sql.NullInt32
	id        uuid.NullUUID
	inclusive bool
}

func decodeRankedSeriesCursorKeys(cursor pagination.Cursor, rankingKey string) (rankedSeriesCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return rankedSeriesCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != seriesInclusiveKey {
		return rankedSeriesCursorKeys{}, invalid
	}
	if cursor.Keys[0] != rankingKey {
		return rankedSeriesCursorKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another period"))
	}
	rank, err := strconv.ParseInt(cursor.Keys[1], 10, 32)
	if err != nil {
		return rankedSeriesCursorKeys{}, invalid
	}
	id, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return rankedSeriesCursorKeys{}, invalid
	}
	return rankedSeriesCursorKeys{
		id:        uuid.NullUUID{UUID: id, Valid: true},
		inclusive: inclusive,
		rank:      sql.NullInt32{Int32: int32(rank), Valid: true},
	}, nil
}

// rankedSeriesPageRow is one row of the keyset scan: the series, and the
// position the snapshot gave it.
type rankedSeriesPageRow struct {
	id   uuid.UUID
	rank int32
}

func (s *apiServer) rankedSeriesPageRows(
	ctx context.Context,
	tenantID uuid.UUID,
	items json.RawMessage,
	reversed bool,
	keys rankedSeriesCursorKeys,
	limit int32,
) ([]rankedSeriesPageRow, error) {
	queries := s.queriesFor(ctx)

	if reversed {
		rows, err := queries.ListRankedSeriesIDsReversed(ctx, dbmodels.ListRankedSeriesIDsReversedParams{
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorRank:      keys.rank,
			Limit:           limit,
			RankingItems:    items,
			TenantID:        tenantID,
		})
		if err != nil {
			return nil, err
		}
		page := make([]rankedSeriesPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, rankedSeriesPageRow{id: row.ID, rank: row.Rank})
		}
		return page, nil
	}

	rows, err := queries.ListRankedSeriesIDs(ctx, dbmodels.ListRankedSeriesIDsParams{
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorRank:      keys.rank,
		Limit:           limit,
		RankingItems:    items,
		TenantID:        tenantID,
	})
	if err != nil {
		return nil, err
	}
	page := make([]rankedSeriesPageRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, rankedSeriesPageRow{id: row.ID, rank: row.Rank})
	}
	return page, nil
}

// ListRankedSeries pages through the latest ranking snapshot of one period,
// in the positions that snapshot recorded.
//
// This is the leaderboard, not the storefront's recommendation order: it shows
// only what the batch ranked, at the positions it assigned, so a series that
// has since been unpublished leaves its position empty rather than pulling the
// rest of the list up. ListRecommendedSeries is the other read of the same
// snapshot, and orders the whole catalogue instead.
func (s *apiServer) ListRankedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListRankedSeriesRequest],
) (*connect.Response[publirav1.ListRankedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	rankingKey, err := rankingKeyForPeriod(req.Msg.Period)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRankedSeriesPageSize, maxRankedSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys rankedSeriesCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeRankedSeriesCursorKeys(cursor, rankingKey)
		if err != nil {
			return nil, err
		}
	}

	snapshots, err := s.latestRankingSnapshots(ctx, tenant.ID, rankingKey)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the ranking snapshot", err, "tenant_id", tenant.ID.String())
	}
	// Nothing has been ranked yet. The period bounds and the computed time
	// describe a snapshot that does not exist, so they stay empty too, and
	// there is no page in either direction to hand a token back to.
	if !snapshots.found {
		return connect.NewResponse(&publirav1.ListRankedSeriesResponse{}), nil
	}

	// One row past the page: its presence is what says another page exists.
	pageRows, err := s.rankedSeriesPageRows(
		ctx,
		tenant.ID,
		snapshots.current.Items,
		cursor.Direction == pagination.Backward,
		keys,
		limit+1,
	)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list ranked series", err, "tenant_id", tenant.ID.String())
	}
	pageRows, hasMore := pagination.Page(pageRows, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(pageRows))
	rankByID := make(map[uuid.UUID]int32, len(pageRows))
	for _, pageRow := range pageRows {
		ids = append(ids, pageRow.id)
		rankByID[pageRow.id] = pageRow.rank
	}

	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list ranked series", err, "tenant_id", tenant.ID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	rankedSeries := make([]*publirav1.RankedSeries, 0, len(rows))
	for i, row := range rows {
		ranked := &publirav1.RankedSeries{Rank: rankByID[row.ID], Series: items[i]}
		if previousRank, ok := snapshots.previousRanks[row.ID]; ok {
			ranked.PreviousRank = &previousRank
		}
		rankedSeries = append(rankedSeries, ranked)
	}

	res := &publirav1.ListRankedSeriesResponse{
		RankedSeries: rankedSeries,
		ComputedAt:   snapshots.current.ComputedAt.UTC().Format(time.RFC3339),
		PeriodStart:  snapshots.current.PeriodStart.Format(time.DateOnly),
		PeriodEnd:    snapshots.current.PeriodEnd.Format(time.DateOnly),
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = encodeRankedSeriesCursor(pagination.Backward, rankingKey, rankByID[first.ID], first.ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeRankedSeriesCursor(pagination.Forward, rankingKey, rankByID[last.ID], last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. Recover only once: a
	// recovery token that comes back empty leaves both tokens empty rather
	// than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeRankedSeriesRecoveryToken(pagination.Backward, rankingKey, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeRankedSeriesRecoveryToken(pagination.Forward, rankingKey, keys)
	}
	return connect.NewResponse(res), nil
}
