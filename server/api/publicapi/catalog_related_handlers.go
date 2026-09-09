package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	// Twelve is what the strip under a series and the panel at the end of an
	// episode show. The maximum stays the one every other catalogue list uses,
	// so a "see more" view pages on from the strip instead of asking a
	// different RPC.
	defaultRelatedSeriesPageSize = int32(12)
	maxRelatedSeriesPageSize     = int32(100)
)

// The ListRelatedSeries cursor carries the series it was scored against, then
// the sort keys of the query in order: the relatedness score, the ranking
// position that breaks a tie on it, and the publication date and id that order
// the rest. Token rules: proto/README.md.
//
// The public id leads for the same reason an order name leads elsewhere: the
// same row sits somewhere else in another series' list, so a token from one
// cannot be continued in another. The score and the rank are the ones the query
// reported for that row, never values recomputed here — a token built on
// something the scan did not sort by points at a page that does not exist.
func encodeRelatedSeriesCursor(
	direction pagination.Direction,
	seriesPublicID string,
	sortKeys relatedSeriesSortKeys,
	row dbmodels.ListActiveSeriesByIDsRow,
) string {
	return pagination.Encode(
		direction,
		seriesPublicID,
		strconv.FormatInt(int64(sortKeys.score), 10),
		strconv.FormatInt(int64(sortKeys.sortRank), 10),
		row.PublishedAt.Time.UTC().Format(time.RFC3339Nano),
		row.ID.String(),
	)
}

// A recovery token includes the boundary once, so the boundary row stays in
// the page when the rows beyond it were unpublished after the original token
// was issued.
func encodeRelatedSeriesRecoveryToken(
	direction pagination.Direction,
	seriesPublicID string,
	keys relatedSeriesCursorKeys,
) string {
	return pagination.Encode(
		direction,
		seriesPublicID,
		strconv.FormatInt(int64(keys.score.Int32), 10),
		strconv.FormatInt(int64(keys.sortRank.Int32), 10),
		keys.publishedAt.Time.UTC().Format(time.RFC3339Nano),
		keys.id.UUID.String(),
		seriesInclusiveKey,
	)
}

// relatedSeriesCursorKeys is the decoded token, in the shape the keyset queries
// take.
type relatedSeriesCursorKeys struct {
	score       sql.NullInt32
	sortRank    sql.NullInt32
	publishedAt sql.NullTime
	id          uuid.NullUUID
	inclusive   bool
}

func decodeRelatedSeriesCursorKeys(cursor pagination.Cursor, seriesPublicID string) (relatedSeriesCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 5 && len(cursor.Keys) != 6 {
		return relatedSeriesCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 6
	if inclusive && cursor.Keys[5] != seriesInclusiveKey {
		return relatedSeriesCursorKeys{}, invalid
	}
	if cursor.Keys[0] != seriesPublicID {
		return relatedSeriesCursorKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another series"))
	}
	score, err := strconv.ParseInt(cursor.Keys[1], 10, 32)
	if err != nil {
		return relatedSeriesCursorKeys{}, invalid
	}
	sortRank, err := strconv.ParseInt(cursor.Keys[2], 10, 32)
	if err != nil {
		return relatedSeriesCursorKeys{}, invalid
	}
	publishedAt, err := time.Parse(time.RFC3339Nano, cursor.Keys[3])
	if err != nil {
		return relatedSeriesCursorKeys{}, invalid
	}
	id, err := uuid.Parse(cursor.Keys[4])
	if err != nil {
		return relatedSeriesCursorKeys{}, invalid
	}
	return relatedSeriesCursorKeys{
		id:          uuid.NullUUID{UUID: id, Valid: true},
		inclusive:   inclusive,
		publishedAt: sql.NullTime{Time: publishedAt, Valid: true},
		score:       sql.NullInt32{Int32: int32(score), Valid: true},
		sortRank:    sql.NullInt32{Int32: int32(sortRank), Valid: true},
	}, nil
}

// relatedSeriesSortKeys is what the scan reported about one row beyond its id:
// the score it was scored at, and the ranking position it sorted under.
type relatedSeriesSortKeys struct {
	score    int32
	sortRank int32
}

// relatedSeriesPageRow is one row of the keyset scan.
type relatedSeriesPageRow struct {
	id       uuid.UUID
	sortKeys relatedSeriesSortKeys
}

func (s *apiServer) relatedSeriesPageRows(
	ctx context.Context,
	tenantID uuid.UUID,
	seriesID uuid.UUID,
	ranking seriesRanking,
	reversed bool,
	keys relatedSeriesCursorKeys,
	limit int32,
) ([]relatedSeriesPageRow, error) {
	queries := s.queriesFor(ctx)

	if reversed {
		rows, err := queries.ListRelatedSeriesIDsReversed(ctx, dbmodels.ListRelatedSeriesIDsReversedParams{
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			CursorPublishedAt: keys.publishedAt,
			CursorRank:        keys.sortRank,
			CursorScore:       keys.score,
			Limit:             limit,
			RankingItems:      ranking.items,
			SeriesID:          seriesID,
			TenantID:          tenantID,
		})
		if err != nil {
			return nil, err
		}
		page := make([]relatedSeriesPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, relatedSeriesPageRow{
				id:       row.ID,
				sortKeys: relatedSeriesSortKeys{score: row.Score, sortRank: row.SortRank},
			})
		}
		return page, nil
	}

	rows, err := queries.ListRelatedSeriesIDs(ctx, dbmodels.ListRelatedSeriesIDsParams{
		CursorID:          keys.id,
		CursorInclusive:   keys.inclusive,
		CursorPublishedAt: keys.publishedAt,
		CursorRank:        keys.sortRank,
		CursorScore:       keys.score,
		Limit:             limit,
		RankingItems:      ranking.items,
		SeriesID:          seriesID,
		TenantID:          tenantID,
	})
	if err != nil {
		return nil, err
	}
	page := make([]relatedSeriesPageRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, relatedSeriesPageRow{
			id:       row.ID,
			sortKeys: relatedSeriesSortKeys{score: row.Score, sortRank: row.SortRank},
		})
	}
	return page, nil
}

// ListRelatedSeries orders a tenant's other published series by what they share
// with one series, and pages through the result.
//
// The list runs past the related ones on purpose. A series sharing nothing
// still scores 0 and joins the tail in the storefront's own ranking order, so
// the strip under a brand new title shows what the tenant's readers are reading
// instead of nothing at all.
//
// Nothing here is read from the request's reader, so the response is the same
// for everyone who asks and can be cached and shared.
func (s *apiServer) ListRelatedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListRelatedSeriesRequest],
) (*connect.Response[publirav1.ListRelatedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	seriesPublicID := strings.TrimSpace(req.Msg.SeriesPublicId)
	if seriesPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRelatedSeriesPageSize, maxRelatedSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys relatedSeriesCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeRelatedSeriesCursorKeys(cursor, seriesPublicID)
		if err != nil {
			return nil, err
		}
	}

	// The subject is resolved through the same read every member-facing series
	// RPC uses, so an unpublished, foreign, or missing series is one not_found
	// and none of them can be told apart.
	seriesID, err := s.queriesFor(ctx).GetPublishedSeriesIDByPublicID(ctx, dbmodels.GetPublishedSeriesIDByPublicIDParams{
		TenantID: tenant.ID,
		PublicID: seriesPublicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get the series to relate to", err, "tenant_id", tenant.ID.String(), "public_id", seriesPublicID)
	}

	ranking, err := s.latestSeriesRanking(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the ranking snapshot", err, "tenant_id", tenant.ID.String())
	}

	// One row past the page: its presence is what says another page exists.
	pageRows, err := s.relatedSeriesPageRows(
		ctx,
		tenant.ID,
		seriesID,
		ranking,
		cursor.Direction == pagination.Backward,
		keys,
		limit+1,
	)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list related series", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	pageRows, hasMore := pagination.Page(pageRows, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(pageRows))
	sortKeysByID := make(map[uuid.UUID]relatedSeriesSortKeys, len(pageRows))
	for _, pageRow := range pageRows {
		ids = append(ids, pageRow.id)
		sortKeysByID[pageRow.id] = pageRow.sortKeys
	}

	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list related series", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.ListRelatedSeriesResponse{Series: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = encodeRelatedSeriesCursor(
				pagination.Backward, seriesPublicID, sortKeysByID[first.ID], first)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeRelatedSeriesCursor(
				pagination.Forward, seriesPublicID, sortKeysByID[last.ID], last)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeRelatedSeriesRecoveryToken(pagination.Backward, seriesPublicID, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeRelatedSeriesRecoveryToken(pagination.Forward, seriesPublicID, keys)
	}
	return connect.NewResponse(res), nil
}
