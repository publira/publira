package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/recommendfeatures"
)

// The two orders ListMyRecommendedSeries can answer in, named in the first key
// of every token it hands back. A reader's features appear and disappear only
// when the daily batch runs, so a traversal almost always stays in one order;
// a token from the other one points at a position that order does not have.
const (
	readerRecommendedOrderKey = "reader_features"
	tenantRecommendedOrderKey = "tenant_ranking"
)

// bindRecommendedOrderTokens puts the order a page was built in in front of
// each token the response hands back. An empty token stays empty.
func bindRecommendedOrderTokens(order string, tokens ...*string) {
	for _, token := range tokens {
		if *token == "" {
			continue
		}
		cursor, err := pagination.Decode(*token)
		if err != nil {
			continue
		}
		*token = pagination.Encode(cursor.Direction, append([]string{order}, cursor.Keys...)...)
	}
}

// decodeRecommendedOrderToken takes the order key off a cursor, and refuses a
// token built in the other order.
func decodeRecommendedOrderToken(cursor pagination.Cursor, order string) (pagination.Cursor, error) {
	if cursor.IsZero() {
		return cursor, nil
	}
	if len(cursor.Keys) == 0 {
		return pagination.Cursor{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	if cursor.Keys[0] != order {
		return pagination.Cursor{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another recommendation order"))
	}
	cursor.Keys = cursor.Keys[1:]
	return cursor, nil
}

// readerRecommendedSortKeys is what the scan reported about one row beyond its
// id: whether the reader already engaged with it, the score it was scored at,
// and the tenant-wide popularity that breaks a tie on that score.
type readerRecommendedSortKeys struct {
	engaged    int32
	score      int64
	popularity int64
}

// The reader-order cursor carries the sort keys of the query in order. They
// are the values the query reported for that row, never ones recomputed here:
// a token built on something the scan did not sort by points at a page that
// does not exist. Token rules: proto/README.md.
func encodeReaderRecommendedCursor(
	direction pagination.Direction,
	sortKeys readerRecommendedSortKeys,
	row dbmodels.ListActiveSeriesByIDsRow,
) string {
	return pagination.Encode(
		direction,
		strconv.FormatInt(int64(sortKeys.engaged), 10),
		strconv.FormatInt(sortKeys.score, 10),
		strconv.FormatInt(sortKeys.popularity, 10),
		row.PublishedAt.Time.UTC().Format(time.RFC3339Nano),
		row.ID.String(),
	)
}

// A recovery token includes the boundary once, so the boundary row stays in
// the page when the rows beyond it were unpublished after the original token
// was issued.
func encodeReaderRecommendedRecoveryToken(direction pagination.Direction, keys readerRecommendedCursorKeys) string {
	return pagination.Encode(
		direction,
		strconv.FormatInt(int64(keys.engaged.Int32), 10),
		strconv.FormatInt(keys.score.Int64, 10),
		strconv.FormatInt(keys.popularity.Int64, 10),
		keys.publishedAt.Time.UTC().Format(time.RFC3339Nano),
		keys.id.UUID.String(),
		seriesInclusiveKey,
	)
}

// readerRecommendedCursorKeys is the decoded token, in the shape the keyset
// queries take.
type readerRecommendedCursorKeys struct {
	engaged     sql.NullInt32
	score       sql.NullInt64
	popularity  sql.NullInt64
	publishedAt sql.NullTime
	id          uuid.NullUUID
	inclusive   bool
}

func decodeReaderRecommendedCursorKeys(cursor pagination.Cursor) (readerRecommendedCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 5 && len(cursor.Keys) != 6 {
		return readerRecommendedCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 6
	if inclusive && cursor.Keys[5] != seriesInclusiveKey {
		return readerRecommendedCursorKeys{}, invalid
	}
	engaged, err := strconv.ParseInt(cursor.Keys[0], 10, 32)
	if err != nil || (engaged != 0 && engaged != 1) {
		return readerRecommendedCursorKeys{}, invalid
	}
	score, err := strconv.ParseInt(cursor.Keys[1], 10, 64)
	if err != nil {
		return readerRecommendedCursorKeys{}, invalid
	}
	popularity, err := strconv.ParseInt(cursor.Keys[2], 10, 64)
	if err != nil {
		return readerRecommendedCursorKeys{}, invalid
	}
	publishedAt, err := time.Parse(time.RFC3339Nano, cursor.Keys[3])
	if err != nil {
		return readerRecommendedCursorKeys{}, invalid
	}
	id, err := uuid.Parse(cursor.Keys[4])
	if err != nil {
		return readerRecommendedCursorKeys{}, invalid
	}
	return readerRecommendedCursorKeys{
		engaged:     sql.NullInt32{Int32: int32(engaged), Valid: true},
		id:          uuid.NullUUID{UUID: id, Valid: true},
		inclusive:   inclusive,
		popularity:  sql.NullInt64{Int64: popularity, Valid: true},
		publishedAt: sql.NullTime{Time: publishedAt, Valid: true},
		score:       sql.NullInt64{Int64: score, Valid: true},
	}, nil
}

// readerRecommendedPageRow is one row of the keyset scan.
type readerRecommendedPageRow struct {
	id       uuid.UUID
	sortKeys readerRecommendedSortKeys
}

func (s *apiServer) readerRecommendedPageRows(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	surface string,
	reversed bool,
	keys readerRecommendedCursorKeys,
	limit int32,
) ([]readerRecommendedPageRow, error) {
	params := dbmodels.ListMyRecommendedSeriesIDsParams{
		CursorEngaged:     keys.engaged,
		CursorID:          keys.id,
		CursorInclusive:   keys.inclusive,
		CursorPopularity:  keys.popularity,
		CursorPublishedAt: keys.publishedAt,
		CursorScore:       keys.score,
		FeatureVersion:    recommendfeatures.FeatureVersion,
		Limit:             limit,
		Surface:           surface,
		TenantID:          tenantID,
		UserID:            userID,
	}
	queries := s.queriesFor(ctx)

	if reversed {
		rows, err := queries.ListMyRecommendedSeriesIDsReversed(ctx, dbmodels.ListMyRecommendedSeriesIDsReversedParams(params))
		if err != nil {
			return nil, err
		}
		page := make([]readerRecommendedPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, readerRecommendedPageRow{
				id:       row.ID,
				sortKeys: readerRecommendedSortKeys{engaged: row.Engaged, score: row.Score, popularity: row.Popularity},
			})
		}
		return page, nil
	}

	rows, err := queries.ListMyRecommendedSeriesIDs(ctx, params)
	if err != nil {
		return nil, err
	}
	page := make([]readerRecommendedPageRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, readerRecommendedPageRow{
			id:       row.ID,
			sortKeys: readerRecommendedSortKeys{engaged: row.Engaged, score: row.Score, popularity: row.Popularity},
		})
	}
	return page, nil
}

// readerRecommendedSeriesPage answers one page of the reader's own order. Like
// tenantRecommendedSeriesPage it takes a cursor with no surface or order key
// on it and hands back tokens without either.
func (s *apiServer) readerRecommendedSeriesPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	surface string,
	limit int32,
	cursor pagination.Cursor,
) (*publirav1.ListMyRecommendedSeriesResponse, error) {
	var keys readerRecommendedCursorKeys
	if !cursor.IsZero() {
		var err error
		keys, err = decodeReaderRecommendedCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}

	// One row past the page: its presence is what says another page exists.
	pageRows, err := s.readerRecommendedPageRows(
		ctx,
		tenantID,
		userID,
		surface,
		cursor.Direction == pagination.Backward,
		keys,
		limit+1,
	)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the reader's recommended series", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	pageRows, hasMore := pagination.Page(pageRows, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(pageRows))
	sortKeysByID := make(map[uuid.UUID]readerRecommendedSortKeys, len(pageRows))
	for _, pageRow := range pageRows {
		ids = append(ids, pageRow.id)
		sortKeysByID[pageRow.id] = pageRow.sortKeys
	}

	rows, err := s.activeSeriesRowsInOrder(ctx, tenantID, surface, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the reader's recommended series", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.ListMyRecommendedSeriesResponse{
		Series: items,
		Source: publirav1.RecommendationSource_RECOMMENDATION_SOURCE_READER_FEATURES,
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = encodeReaderRecommendedCursor(pagination.Backward, sortKeysByID[first.ID], first)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeReaderRecommendedCursor(pagination.Forward, sortKeysByID[last.ID], last)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, and only once:
	// a recovery token that comes back empty means the boundary is gone too,
	// so both tokens stay empty rather than bouncing between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeReaderRecommendedRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeReaderRecommendedRecoveryToken(pagination.Forward, keys)
	}
	return res, nil
}

// ListMyRecommendedSeries orders the tenant's published series for the
// authenticated member from the features the daily batch built for them, and
// pages through the result. The scoring rule is stated on the RPC and carried
// out by ListMyRecommendedSeriesIDs.
//
// A member without current features is answered with exactly the page
// ListRecommendedSeries would give, so the only difference a new account sees
// between the two reads is that this one is private.
func (s *apiServer) ListMyRecommendedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyRecommendedSeriesRequest],
) (*connect.Response[publirav1.ListMyRecommendedSeriesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRecommendedSeriesPageSize, maxRecommendedSeriesPageSize)
	cursor, err := decodeSurfaceToken(req.Msg.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}

	hasFeatures, err := s.queriesFor(ctx).HasUserRecommendFeatures(ctx, dbmodels.HasUserRecommendFeaturesParams{
		FeatureVersion: recommendfeatures.FeatureVersion,
		TenantID:       tenant.ID,
		UserID:         user.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the reader's recommendation features", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	order := tenantRecommendedOrderKey
	if hasFeatures {
		order = readerRecommendedOrderKey
	}
	cursor, err = decodeRecommendedOrderToken(cursor, order)
	if err != nil {
		return nil, err
	}

	var res *publirav1.ListMyRecommendedSeriesResponse
	if hasFeatures {
		res, err = s.readerRecommendedSeriesPage(ctx, tenant.ID, user.ID, surface, limit, cursor)
		if err != nil {
			return nil, err
		}
	} else {
		page, err := s.tenantRecommendedSeriesPage(ctx, tenant.ID, surface, limit, cursor)
		if err != nil {
			return nil, err
		}
		res = &publirav1.ListMyRecommendedSeriesResponse{
			Series:        page.Series,
			PreviousToken: page.PreviousToken,
			NextToken:     page.NextToken,
			Source:        page.Source,
		}
	}
	bindRecommendedOrderTokens(order, &res.PreviousToken, &res.NextToken)
	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)
	return noStorePrivateResponse(res), nil
}
