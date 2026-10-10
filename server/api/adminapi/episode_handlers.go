package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/episodeimages"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func parseScheduledAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, "scheduled_at must be RFC3339")
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

// episodeRevalidateTags names the public caches that answer with what an
// episode holds and how it reads — its pages, its place and number in its
// series, its credits, its layout, and how it may be bought: the series detail
// every cached episode read is also tagged with. No series list shows any of
// those, so the lists are left standing. Whether an episode is readable at all,
// and where, changes the lists as well, so a publication, a schedule, and a
// surface drop [publishepisodes.RevalidateTags] instead, and a free window
// [freewindows.RevalidateTags].
func episodeRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

const (
	defaultEpisodePageSize = int32(20)
	maxEpisodePageSize     = int32(100)
	episodeInclusiveKey    = "inclusive"
)

// episodeCursorKeys is a decoded ListEpisodes token, in the shape the keyset
// queries take. Its zero value means the request carried no token.
type episodeCursorKeys struct {
	orderIndex sql.NullInt32
	id         uuid.NullUUID
	inclusive  bool
}

// The ListEpisodes cursor carries the series it lists, then the sort keys of
// the boundary row in query order: order_index, then the id that breaks its
// ties. A recovery token adds the inclusive marker so the boundary row itself
// comes back once. Token rules: proto/README.md.
func encodeEpisodeCursor(direction pagination.Direction, listKey pagination.ListKey, row episodePageRow) string {
	return listKey.Encode(direction, strconv.FormatInt(int64(row.orderIndex), 10), row.id.String())
}

func encodeEpisodeRecoveryToken(direction pagination.Direction, listKey pagination.ListKey, keys episodeCursorKeys) string {
	return listKey.Encode(
		direction,
		strconv.FormatInt(int64(keys.orderIndex.Int32), 10),
		keys.id.UUID.String(),
		episodeInclusiveKey,
	)
}

func decodeEpisodeCursorKeys(cursor pagination.Cursor) (episodeCursorKeys, error) {
	if len(cursor.Keys) != 2 && len(cursor.Keys) != 3 {
		return episodeCursorKeys{}, pagination.ErrInvalidToken
	}
	inclusive := len(cursor.Keys) == 3
	if inclusive && cursor.Keys[2] != episodeInclusiveKey {
		return episodeCursorKeys{}, pagination.ErrInvalidToken
	}

	orderIndex, err := strconv.ParseInt(cursor.Keys[0], 10, 32)
	if err != nil {
		return episodeCursorKeys{}, pagination.ErrInvalidToken
	}
	episodeID, err := uuid.Parse(cursor.Keys[1])
	if err != nil {
		return episodeCursorKeys{}, pagination.ErrInvalidToken
	}

	return episodeCursorKeys{
		orderIndex: sql.NullInt32{Int32: int32(orderIndex), Valid: true},
		id:         uuid.NullUUID{UUID: episodeID, Valid: true},
		inclusive:  inclusive,
	}, nil
}

// episodePageRow is one row of an admin episode page, shared by the ascending
// and descending keyset queries so the handler reads a single shape.
type episodePageRow struct {
	id                 uuid.UUID
	publicID           string
	title              string
	orderIndex         int32
	price              int32
	readingPeriodHours sql.NullInt32
	status             string
	scheduledAt        sql.NullTime
	publishedAt        sql.NullTime
	availability       sql.NullString
}

func (r episodePageRow) toProto() (*publirattypesv1.Episode, error) {
	episode := &publirattypesv1.Episode{
		Id:         r.id.String(),
		PublicId:   r.publicID,
		Title:      r.title,
		OrderIndex: r.orderIndex,
		Price:      r.price,
		Status:     r.status,
	}
	if r.readingPeriodHours.Valid {
		episode.ReadingPeriodHours = r.readingPeriodHours.Int32
	}
	if r.scheduledAt.Valid {
		episode.ScheduledAt = r.scheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if r.publishedAt.Valid {
		episode.PublishedAt = r.publishedAt.Time.UTC().Format(time.RFC3339)
	}
	if err := setEpisodeAvailability(episode, r.availability); err != nil {
		return nil, err
	}
	return episode, nil
}

// setEpisodeAvailability puts the episode's own availability onto it, which
// every console episode read carries so the lists can mark an episode that is
// not on both surfaces.
func setEpisodeAvailability(episode *publirattypesv1.Episode, stored sql.NullString) error {
	availability, err := protomapper.SurfaceAvailabilityOverrideFromStored(stored)
	if err != nil {
		return err
	}
	episode.Availability = availability
	return nil
}

// episodePurchaseAvailability puts where the episode may be bought, resolved,
// onto it and answers the episode's own override beside it, the pair the
// console's single-episode reads respond with.
func episodePurchaseAvailability(
	episode *publirattypesv1.Episode,
	override sql.NullString,
	resolved string,
) (publirattypesv1.SurfaceAvailability, error) {
	resolvedAvailability, err := protomapper.SurfaceAvailabilityFromStored(resolved)
	if err != nil {
		return publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED, err
	}
	episode.PurchaseAvailability = resolvedAvailability
	return protomapper.SurfaceAvailabilityOverrideFromStored(override)
}

func mapEpisodeAscRows(rows []dbmodels.ListEpisodesBySeriesForTenantAscRow) []episodePageRow {
	mapped := make([]episodePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, episodePageRow{
			id:                 row.ID,
			publicID:           row.PublicID,
			title:              row.Title,
			orderIndex:         row.OrderIndex,
			price:              row.Price,
			readingPeriodHours: row.ReadingPeriodHours,
			status:             row.Status,
			scheduledAt:        row.ScheduledAt,
			publishedAt:        row.PublishedAt,
			availability:       row.Availability,
		})
	}
	return mapped
}

func mapEpisodeDescRows(rows []dbmodels.ListEpisodesBySeriesForTenantDescRow) []episodePageRow {
	mapped := make([]episodePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, episodePageRow{
			id:                 row.ID,
			publicID:           row.PublicID,
			title:              row.Title,
			orderIndex:         row.OrderIndex,
			price:              row.Price,
			readingPeriodHours: row.ReadingPeriodHours,
			status:             row.Status,
			scheduledAt:        row.ScheduledAt,
			publishedAt:        row.PublishedAt,
			availability:       row.Availability,
		})
	}
	return mapped
}

// episodePage runs the keyset query for one page. The list reads oldest order
// index first, so a backward page is scanned by the descending query and put
// back into display order by pagination.Page.
func (s *adminServer) episodePage(
	ctx context.Context,
	tenantID uuid.UUID,
	seriesID uuid.UUID,
	keys episodeCursorKeys,
	direction pagination.Direction,
	limit int32,
) ([]episodePageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodesBySeriesForTenantDesc(ctx, dbmodels.ListEpisodesBySeriesForTenantDescParams{
			TenantID:         tenantID,
			SeriesID:         seriesID,
			CursorID:         keys.id,
			CursorInclusive:  keys.inclusive,
			CursorOrderIndex: keys.orderIndex,
			Limit:            limit,
		})
		if err != nil {
			return nil, err
		}
		return mapEpisodeDescRows(rows), nil
	}

	rows, err := queries.ListEpisodesBySeriesForTenantAsc(ctx, dbmodels.ListEpisodesBySeriesForTenantAscParams{
		TenantID:         tenantID,
		SeriesID:         seriesID,
		CursorID:         keys.id,
		CursorInclusive:  keys.inclusive,
		CursorOrderIndex: keys.orderIndex,
		Limit:            limit,
	})
	if err != nil {
		return nil, err
	}
	return mapEpisodeAscRows(rows), nil
}

func (s *adminServer) ListEpisodes(
	ctx context.Context,
	req *publiraadminv1.ListEpisodesRequest,
) (*publiraadminv1.ListEpisodesResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
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

	limit := pagination.NormalizeLimit(req.Limit, defaultEpisodePageSize, maxEpisodePageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	listKey := pagination.NewListKey("order_index_asc").Value("series_id", seriesID.String())
	var keys episodeCursorKeys
	if !cursor.IsZero() {
		inner, keyErr := listKey.Decode(cursor)
		if keyErr != nil {
			return nil, rpcerrors.NewPageTokenError(keyErr)
		}
		keys, err = decodeEpisodeCursorKeys(inner)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.episodePage(ctx, tenant.ID, seriesID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	episodes := make([]*publirattypesv1.Episode, 0, len(rows))
	for _, row := range rows {
		episode, mapErr := row.toProto()
		if mapErr != nil {
			return nil, s.internalError(ctx, "episode holds an availability this build does not know", mapErr, "tenant_id", tenant.ID.String(), "episode_public_id", row.publicID)
		}
		episodes = append(episodes, episode)
	}

	res := &publiraadminv1.ListEpisodesResponse{Episodes: episodes}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeEpisodeCursor(pagination.Backward, listKey, rows[0])
		}
		if hasNext {
			res.NextToken = encodeEpisodeCursor(pagination.Forward, listKey, rows[len(rows)-1])
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeEpisodeRecoveryToken(pagination.Backward, listKey, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeEpisodeRecoveryToken(pagination.Forward, listKey, keys)
	}

	return res, nil
}

func (s *adminServer) GetEpisode(
	ctx context.Context,
	req *publiraadminv1.GetEpisodeRequest,
) (*publiraadminv1.GetEpisodeResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "series_public_id is required")
	}
	if strings.TrimSpace(req.PublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "public_id is required")
	}

	row, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenantAndSeries(ctx, dbmodels.GetEpisodeByPublicIDForTenantAndSeriesParams{
		TenantID:   tenant.ID,
		PublicID:   req.SeriesPublicId,
		PublicID_2: req.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode", err, "tenant_id", tenant.ID.String())
	}

	episode := protomapper.EpisodeFromGetEpisodeByPublicIDForTenantAndSeriesRow(row)
	readingDirection, spreadStartIndex, err := episodeReadingLayout(episode, protomapper.StoredReadingLayout{
		ReadingDirection:       row.ReadingDirection,
		SpreadStartIndex:       row.SpreadStartIndex,
		SeriesReadingDirection: row.SeriesReadingDirection,
		SeriesSpreadStartIndex: row.SeriesSpreadStartIndex,
	})
	if err != nil {
		return nil, s.internalError(ctx, "episode layout holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", row.PublicID)
	}
	if err := setEpisodeAvailability(episode, row.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", row.PublicID)
	}
	purchaseAvailability, err := episodePurchaseAvailability(episode, row.PurchaseAvailability, row.ResolvedPurchaseAvailability)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", row.PublicID)
	}

	return &publiraadminv1.GetEpisodeResponse{
		Episode:              episode,
		ReadingDirection:     readingDirection,
		SpreadStartIndex:     spreadStartIndex,
		PurchaseAvailability: purchaseAvailability,
	}, nil
}

// episodeReadingLayout puts the resolved layout onto the episode and answers
// the episode's own overrides beside it, the pair every admin episode read
// that carries a layout responds with.
func episodeReadingLayout(
	episode *publirattypesv1.Episode,
	stored protomapper.StoredReadingLayout,
) (publirattypesv1.ReadingDirection, *int32, error) {
	if err := protomapper.SetResolvedReadingLayout(episode, stored); err != nil {
		return publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED, nil, err
	}
	readingDirection, err := protomapper.ReadingDirectionOverrideFromStored(stored.ReadingDirection)
	if err != nil {
		return publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED, nil, err
	}
	return readingDirection, protomapper.SpreadStartIndexOverrideFromStored(stored.SpreadStartIndex), nil
}

func listEpisodeIDs(rows []dbmodels.ListEpisodesBySeriesForTenantRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

// episodeOrderArg is the order a reorder asks for and the order it was
// composed against.
type episodeOrderArg struct {
	desired  []uuid.UUID
	expected []uuid.UUID
}

func parseEpisodeOrderArg(msg *publiraadminv1.ReorderEpisodesRequest) (episodeOrderArg, error) {
	desired, err := recordIDsArg(msg.EpisodeIds, "episode_ids", "episode")
	if err != nil {
		return episodeOrderArg{}, err
	}
	expected, err := recordIDsArg(msg.ExpectedEpisodeIds, "expected_episode_ids", "episode")
	if err != nil {
		return episodeOrderArg{}, err
	}
	if !samePublicIDSet(uuidStrings(desired), uuidStrings(expected)) {
		return episodeOrderArg{}, connect.NewError(connect.CodeInvalidArgument, "episode_ids must be a permutation of expected_episode_ids")
	}
	return episodeOrderArg{desired: desired, expected: expected}, nil
}

// resolve reads the order against the series' current rows: whether it was
// composed against them, and the desired order.
func (arg episodeOrderArg) resolve(rows []dbmodels.ListEpisodesBySeriesForTenantRow) ([]uuid.UUID, bool) {
	return arg.desired, slices.Equal(listEpisodeIDs(rows), arg.expected)
}

func uuidStrings(ids []uuid.UUID) []string {
	values := make([]string, 0, len(ids))
	for _, id := range ids {
		values = append(values, id.String())
	}
	return values
}

func (s *adminServer) ReorderEpisodes(
	ctx context.Context,
	req *publiraadminv1.ReorderEpisodesRequest,
) (*publiraadminv1.ReorderEpisodesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	order, err := parseEpisodeOrderArg(req)
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin reorder episodes transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if _, err := q.LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       seriesID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "series not found")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for reorder episodes", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	// Read after the lock so READ COMMITTED sees rows committed while this
	// transaction waited. Matching expected_episode_ids is what says the
	// client's merge is still based on the current series order.
	rows, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		SeriesID: seriesID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes for reorder", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	desired, current := order.resolve(rows)
	if !current {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "episode order has changed")
	}

	for index, episodeID := range desired {
		if err := q.UpdateEpisodeOrderIndexByIDForTenantAndSeries(ctx, dbmodels.UpdateEpisodeOrderIndexByIDForTenantAndSeriesParams{
			TenantID:   tenant.ID,
			SeriesID:   seriesID,
			ID:         episodeID,
			OrderIndex: int32(index + 1),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode order_index", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String(), "episode_id", episodeID.String())
		}
	}

	updatedRows, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		SeriesID: seriesID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes after reorder", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	// The series page lists the episodes in this order and numbers them by it.
	owed, err := s.reval.Record(ctx, q, tenant.ID, episodeRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the reordered episodes", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit reorder episodes", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	s.reval.Send(ctx, owed)

	episodes := make([]*publirattypesv1.Episode, 0, len(updatedRows))
	for _, row := range updatedRows {
		episode := protomapper.EpisodeFromListEpisodesBySeriesForTenantRow(row)
		if err := setEpisodeAvailability(episode, row.Availability); err != nil {
			return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", row.PublicID)
		}
		episodes = append(episodes, episode)
	}

	return &publiraadminv1.ReorderEpisodesResponse{Episodes: episodes}, nil
}

func (s *adminServer) CreateEpisode(
	ctx context.Context,
	req *publiraadminv1.CreateEpisodeRequest,
) (*publiraadminv1.CreateEpisodeResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "title is required")
	}
	if req.OrderIndex < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "order_index must be greater than or equal to 0")
	}
	if req.Price < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "price must be greater than or equal to 0")
	}
	if req.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "reading_period_hours must be greater than or equal to 0")
	}
	scheduledAt, err := parseScheduledAtOrZero(req.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt.Time = scheduledAt.Time.UTC()
	// A time that has already passed publishes the episode as it is created,
	// the way a series is public from the moment a past time is saved.
	now := time.Now().UTC()
	publishNow := scheduledAt.Valid && !scheduledAt.Time.After(now)
	availability, err := protomapper.SurfaceAvailabilityOverrideToStored(req.Availability)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "availability")
	}
	purchaseAvailability, err := protomapper.SurfaceAvailabilityOverrideToStored(req.PurchaseAvailability)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "purchase_availability")
	}

	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create episode transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, q)
	if _, err := q.LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       seriesID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "series not found")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for create episode", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	// An unset order_index means "append". Resolving it here keeps the client
	// from having to read the whole series to find the end, which a paged
	// ListEpisodes can no longer hand it in one call. The MAX is a separate
	// statement from the lock so READ COMMITTED sees rows committed while
	// this transaction waited.
	orderIndex := req.OrderIndex
	if orderIndex == 0 {
		maxOrderIndex, maxErr := q.GetMaxEpisodeOrderIndexBySeriesForTenant(ctx, dbmodels.GetMaxEpisodeOrderIndexBySeriesForTenantParams{
			TenantID: tenant.ID,
			SeriesID: seriesID,
		})
		if maxErr != nil {
			return nil, s.internalDBError(ctx, "failed to resolve episode order_index", maxErr, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		if maxOrderIndex == math.MaxInt32 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "episode order_index limit reached")
		}
		orderIndex = maxOrderIndex + 1
	}
	episodeID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	base, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.Episode, error) {
		return q.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{
			ID:                   episodeID,
			OrderIndex:           orderIndex,
			PublicID:             publicID,
			SeriesID:             seriesID,
			TenantID:             tenant.ID,
			Title:                req.Title,
			Availability:         availability,
			PurchaseAvailability: purchaseAvailability,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create episode", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	status := "draft"
	publishedAt := sql.NullTime{}
	switch {
	case publishNow:
		status = "published"
		publishedAt = sql.NullTime{Time: now, Valid: true}
	case scheduledAt.Valid:
		status = "scheduled"
	}
	listing, err := q.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID:          base.ID,
		Price:              req.Price,
		PublishedAt:        publishedAt,
		ReadingPeriodHours: sql.NullInt32{Int32: req.ReadingPeriodHours, Valid: req.ReadingPeriodHours > 0},
		ScheduledAt:        scheduledAt,
		Status:             status,
		TenantID:           tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert episode listing", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	// The episode is credited to the team the series carries at this moment,
	// in the same transaction that creates it, so an episode never exists
	// without credits. Editing the series afterwards changes what the next
	// episode is created with and leaves this one as it shipped.
	err = q.BakeSeriesCreatorsOntoEpisode(ctx, dbmodels.BakeSeriesCreatorsOntoEpisodeParams{
		TenantID:  tenant.ID,
		SeriesID:  seriesID,
		EpisodeID: base.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to bake series credits onto episode", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	resolvedPurchaseAvailability, err := q.GetResolvedEpisodePurchaseAvailability(ctx, dbmodels.GetResolvedEpisodePurchaseAvailabilityParams{
		TenantID:  tenant.ID,
		EpisodeID: base.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve created episode purchase availability", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	var owed revalidate.Owed
	if publishNow {
		if err := recordEpisodePublication(txCtx, q, tenant.ID, seriesID, base.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the publication of the created episode", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
		}
		owed, err = s.recordRevalidation(txCtx, tenant.ID, publishepisodes.RevalidateTags(tenant.ID))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to record a next cache invalidation", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create episode", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	episode := &publirattypesv1.Episode{Id: base.ID.String(), PublicId: base.PublicID, Title: base.Title, OrderIndex: base.OrderIndex, Price: listing.Price, Status: listing.Status}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	if err := setEpisodeAvailability(episode, base.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", base.PublicID)
	}
	savedPurchaseAvailability, err := episodePurchaseAvailability(episode, base.PurchaseAvailability, resolvedPurchaseAvailability)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", base.PublicID)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_created",
			TargetType:  "episode",
			TargetID:    base.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.CreateEpisodeResponse{Episode: episode, PurchaseAvailability: savedPurchaseAvailability}, nil
}

// recordEpisodePublication writes down, in the transaction that publishes the
// episode, what the scheduled publication job would have written in its own:
// the sync of the series' search document, and the notice to the episode's
// followers, which the worker writes because this connection cannot see them.
// The drop of the caches that list the episode and its series is the caller's
// to record with the rest of its write.
func recordEpisodePublication(txCtx context.Context, q Querier, tenantID, seriesID, episodeID uuid.UUID) error {
	payload, err := json.Marshal(outbox.EpisodePublishedNotificationPayload{
		TenantID:  tenantID.String(),
		EpisodeID: episodeID.String(),
	})
	if err != nil {
		return fmt.Errorf("encode episode published notification payload: %w", err)
	}
	if err := insertAdminOutboxEvent(txCtx, q, tenantID, outbox.EventTypeEpisodePublishedNotification, payload, outbox.EpisodePublishedIdempotencyKey(episodeID)); err != nil {
		return fmt.Errorf("queue episode published notification: %w", err)
	}
	if err := catalogindex.Queue(txCtx, q, tenantID, catalogindex.SeriesRef(seriesID)); err != nil {
		return fmt.Errorf("queue catalog index sync: %w", err)
	}
	return nil
}

func (s *adminServer) UploadEpisodeImages(
	ctx context.Context,
	req *publiraadminv1.UploadEpisodeImagesRequest,
) (*publiraadminv1.UploadEpisodeImagesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	requestEpisodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	seriesID, err := recordIDArg(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}
	items, episodeID, err := episodeimages.Service{Queries: s.queriesFor(ctx), Storage: s.storage, Recorder: s.recorderFor(ctx)}.Upload(ctx, episodeimages.UploadRequest{
		Tenant:          tenant,
		SeriesID:        seriesID,
		EpisodeID:       requestEpisodeID,
		Images:          req.Images,
		ArchiveData:     req.ArchiveData,
		ArchiveFilename: req.ArchiveFilename,
		ArchiveType:     req.ArchiveContentType,
	})
	// The pages are stored one by one, each with its own statements and objects,
	// so there is no transaction for the drop to ride: it is recorded once the
	// upload is over, and a record that fails then has nothing left to undo. An
	// upload that failed part way still stored the pages before the failure,
	// which Upload says by naming the episode beside the error.
	if episodeID != uuid.Nil {
		owed, recordErr := s.recordRevalidation(ctx, tenant.ID, episodeRevalidateTags(tenant.ID.String()))
		if recordErr != nil {
			s.logger.WarnContext(ctx, "failed to record the cache invalidation for uploaded episode images",
				"tenant_id", tenant.ID.String(),
				"episode_id", episodeID.String(),
				"error", recordErr,
			)
		}
		s.reval.Send(ctx, owed)
	}
	if err != nil {
		return nil, err
	}
	if err := s.attachAdminMediaToken(ctx, tenant.ID, episodeID, items); err != nil {
		return nil, err
	}

	return &publiraadminv1.UploadEpisodeImagesResponse{Images: items}, nil
}

func (s *adminServer) ListEpisodeImages(
	ctx context.Context,
	req *publiraadminv1.ListEpisodeImagesRequest,
) (*publiraadminv1.ListEpisodeImagesResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for list episode images", err, "tenant_id", tenant.ID.String())
	}
	rows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode images", err, "tenant_id", tenant.ID.String())
	}

	images := make([]*publirattypesv1.EpisodeImage, 0, len(rows))
	for _, row := range rows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}
	if err := s.attachAdminMediaToken(ctx, tenant.ID, episode.ID, images); err != nil {
		return nil, err
	}

	return &publiraadminv1.ListEpisodeImagesResponse{Images: images}, nil
}

func (s *adminServer) ReorderEpisodeImages(
	ctx context.Context,
	req *publiraadminv1.ReorderEpisodeImagesRequest,
) (*publiraadminv1.ReorderEpisodeImagesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	if len(req.ImageIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids are required")
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for reorder images", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	rows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode images for reorder", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if len(rows) != len(req.ImageIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids must include all images in the episode")
	}

	validImageIDs := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		validImageIDs[row.ID.String()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(req.ImageIds))
	for _, imageID := range req.ImageIds {
		if strings.TrimSpace(imageID) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids contains empty value")
		}
		if _, ok := validImageIDs[imageID]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids contains unknown image")
		}
		if _, ok := seen[imageID]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids contains duplicate image")
		}
		seen[imageID] = struct{}{}
	}

	// The viewer shows the pages in this order, so the new order and the drop
	// of the pages the site holds commit together.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		for index, imageID := range req.ImageIds {
			parsedImageID, err := uuid.Parse(imageID)
			if err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, "image_ids contains invalid uuid")
			}
			if err := s.queriesFor(txCtx).UpdateEpisodeImageDisplayOrderByIDForEpisode(txCtx, dbmodels.UpdateEpisodeImageDisplayOrderByIDForEpisodeParams{
				ID:           parsedImageID,
				EpisodeID:    episode.ID,
				DisplayOrder: int32(index + 1),
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to update episode image order", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "image_id", parsedImageID.String())
			}
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	updatedRows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode images after reorder", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	images := make([]*publirattypesv1.EpisodeImage, 0, len(updatedRows))
	for _, row := range updatedRows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}
	if err := s.attachAdminMediaToken(ctx, tenant.ID, episode.ID, images); err != nil {
		return nil, err
	}

	return &publiraadminv1.ReorderEpisodeImagesResponse{Images: images}, nil
}

func (s *adminServer) DeleteEpisodeImage(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeImageRequest,
) (*publiraadminv1.DeleteEpisodeImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	imageID, err := parseRecordID(req.ImageId, "image_id")
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for delete image", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}

	// The viewer shows the pages that are left, so the delete and the drop of
	// the pages the site holds commit together.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if _, err := s.queriesFor(txCtx).DeleteEpisodeImageByIDForEpisode(txCtx, dbmodels.DeleteEpisodeImageByIDForEpisodeParams{
			ID:        imageID,
			EpisodeID: episode.ID,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "episode image not found")
			}
			return nil, s.internalDBError(ctx, "failed to delete episode image", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "image_id", imageID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	s.recordEpisodeUpdated(ctx, tenant.ID, episode.PublicID)

	images, err := s.episodeImages(ctx, tenant.ID, episode.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteEpisodeImageResponse{Images: images}, nil
}

func (s *adminServer) ReplaceEpisodeImage(
	ctx context.Context,
	req *publiraadminv1.ReplaceEpisodeImageRequest,
) (*publiraadminv1.ReplaceEpisodeImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	imageID, err := parseRecordID(req.ImageId, "image_id")
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for replace image", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	// Looked up before anything is stored, so a page that is not the episode's
	// costs no upload. The delete below is what decides it.
	current, err := s.queriesFor(ctx).GetEpisodeImageByIDForTenant(ctx, dbmodels.GetEpisodeImageByIDForTenantParams{ID: imageID, TenantID: tenant.ID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode image not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode image for replace", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "image_id", imageID.String())
	}
	if current.EpisodeID != episode.ID {
		return nil, connect.NewError(connect.CodeNotFound, "episode image not found")
	}

	staged, err := episodeimages.Service{Storage: s.storage}.Stage(ctx, tenant, episode.PublicID, req.Filename, req.ContentType, req.Data)
	if err != nil {
		return nil, err
	}
	// The old page goes and the new one takes its place in one transaction, so
	// the body never shows both or neither, and the drop of the pages the site
	// holds commits with them.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		displayOrder, err := q.DeleteEpisodeImageByIDForEpisode(txCtx, dbmodels.DeleteEpisodeImageByIDForEpisodeParams{
			ID:        imageID,
			EpisodeID: episode.ID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "episode image not found")
			}
			return nil, s.internalDBError(ctx, "failed to delete the replaced episode image", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "image_id", imageID.String())
		}
		if err := staged.Insert(txCtx, q, tenant.ID, episode.ID, displayOrder); err != nil {
			return nil, s.internalDBError(ctx, "failed to insert the replacing episode image", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String(), "image_id", imageID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	s.recordEpisodeUpdated(ctx, tenant.ID, episode.PublicID)

	images, err := s.episodeImages(ctx, tenant.ID, episode.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ReplaceEpisodeImageResponse{Images: images}, nil
}

// episodeImages answers the episode's pages in reading order, as
// ListEpisodeImages does.
func (s *adminServer) episodeImages(ctx context.Context, tenantID, episodeID uuid.UUID) ([]*publirattypesv1.EpisodeImage, error) {
	rows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episodeID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode images", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	images := make([]*publirattypesv1.EpisodeImage, 0, len(rows))
	for _, row := range rows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}
	if err := s.attachAdminMediaToken(ctx, tenantID, episodeID, images); err != nil {
		return nil, err
	}
	return images, nil
}

// recordEpisodeUpdated writes the episode_updated audit entry for a write the
// caller's session made.
func (s *adminServer) recordEpisodeUpdated(ctx context.Context, tenantID uuid.UUID, episodePublicID string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "episode_updated",
		TargetType:  "episode",
		TargetID:    episodePublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})
}

// attachAdminMediaToken puts the short-lived credential a browser <img> needs
// onto each image URL. The admin access token cannot travel with that
// request, and without this query token image-server would apply the public
// publish/price rule.
func (s *adminServer) attachAdminMediaToken(
	ctx context.Context,
	tenantID uuid.UUID,
	episodeID uuid.UUID,
	images []*publirattypesv1.EpisodeImage,
) error {
	session, ok := rpcmiddleware.SessionContextFromContext(ctx)
	// A media token names the operator it is issued to, and the service
	// principal is none, so it is refused even when there is nothing to sign.
	if ok && session.Service {
		return serviceProcedureDeniedError()
	}
	if len(images) == 0 {
		return nil
	}
	if !ok || s.tokens == nil {
		return connect.NewError(connect.CodeInternal, "internal server error")
	}
	token, _, err := s.tokens.IssueAdminMediaToken(
		session.User.PublicID,
		tenantID.String(),
		episodeID.String(),
		session.User.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to issue episode admin media token",
			"tenant_id", tenantID.String(),
			"episode_id", episodeID.String(),
			"error", err,
		)
		return connect.NewError(connect.CodeInternal, "internal server error")
	}
	for _, image := range images {
		image.ImageUrl = auth.WithMediaTokenQuery(image.ImageUrl, token)
	}
	return nil
}

func (s *adminServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodePublishScheduleRequest,
) (*publiraadminv1.UpdateEpisodePublishScheduleResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt.Time = scheduledAt.Time.UTC()
	// A time that has already passed publishes the episode now, the way
	// CreateEpisode publishes one created with it, rather than leaving it for
	// the scheduled publication job to reach.
	publishNow := scheduledAt.Valid && !scheduledAt.Time.After(time.Now())
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	var ep dbmodels.GetEpisodeByIDForTenantRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		published := false
		if publishNow {
			rows, err := q.PublishEpisodeNowByIDForTenant(txCtx, dbmodels.PublishEpisodeNowByIDForTenantParams{TenantID: tenant.ID, ID: episodeID, ScheduledAt: scheduledAt.Time})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to publish episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
			}
			published = rows > 0
		} else if err := q.UpdateEpisodePublishScheduleByIDForTenant(txCtx, dbmodels.UpdateEpisodePublishScheduleByIDForTenantParams{TenantID: tenant.ID, ID: episodeID, ScheduledAt: scheduledAt}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode publish schedule", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		row, err := q.GetEpisodeByIDForTenant(txCtx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "episode not found")
			}
			return nil, s.internalDBError(ctx, "failed to get episode after schedule update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		ep = row
		switch {
		case published:
			if err := recordEpisodePublication(txCtx, q, tenant.ID, row.SeriesID, episodeID); err != nil {
				return nil, s.internalDBError(ctx, "failed to record the publication of the episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
			}
		case publishNow:
			// The episode was already published, and a time that has passed
			// leaves it as it is: nothing a reader sees has changed.
			return nil, nil
		default:
			// A schedule saved over a published episode takes it down, which can
			// change its series' latest episode and whether a free one is open.
			if err := catalogindex.Queue(txCtx, q, tenant.ID, catalogindex.SeriesRef(row.SeriesID)); err != nil {
				return nil, s.internalDBError(ctx, "failed to queue the search index sync for the episode's series", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
			}
		}
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_updated",
			TargetType:  "episode",
			TargetID:    ep.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(ep)
	if err := setEpisodeAvailability(mapped, ep.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", ep.PublicID)
	}
	if _, err := episodePurchaseAvailability(mapped, ep.PurchaseAvailability, ep.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", ep.PublicID)
	}
	return &publiraadminv1.UpdateEpisodePublishScheduleResponse{Episode: mapped}, nil
}

func (s *adminServer) UpdateEpisodeTitle(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodeTitleRequest,
) (*publiraadminv1.UpdateEpisodeTitleResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "title is required")
	}

	// The series page lists its episodes by title, and the viewer heads the body
	// with it. No series list shows it and neither does the search document, so
	// the lists stay cached and no sync is queued.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		updated, err := s.queriesFor(txCtx).UpdateEpisodeTitleByIDForTenant(txCtx, dbmodels.UpdateEpisodeTitleByIDForTenantParams{
			TenantID: tenant.ID,
			ID:       episodeID,
			Title:    req.Title,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode title", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if updated == 0 {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get episode after title update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(updated)
	if err := setEpisodeAvailability(mapped, updated.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	if _, err := episodePurchaseAvailability(mapped, updated.PurchaseAvailability, updated.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	s.recordEpisodeUpdated(ctx, tenant.ID, updated.PublicID)
	return &publiraadminv1.UpdateEpisodeTitleResponse{Episode: mapped}, nil
}

func (s *adminServer) UpdateEpisodePricing(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodePricingRequest,
) (*publiraadminv1.UpdateEpisodePricingResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	if req.Price < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "price must be greater than or equal to 0")
	}
	if req.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "reading_period_hours must be greater than or equal to 0")
	}

	// Purchases, and the checkouts and store purchase intents already started,
	// carry the terms they were made on, so only the listing is written. The
	// store products follow from the listings' prices and need nothing here.
	var updated dbmodels.GetEpisodeByIDForTenantRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		rows, err := q.UpdateEpisodePricingByIDForTenant(txCtx, dbmodels.UpdateEpisodePricingByIDForTenantParams{
			TenantID:           tenant.ID,
			EpisodeID:          episodeID,
			Price:              req.Price,
			ReadingPeriodHours: sql.NullInt32{Int32: req.ReadingPeriodHours, Valid: req.ReadingPeriodHours > 0},
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode pricing", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if rows == 0 {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		row, err := q.GetEpisodeByIDForTenant(txCtx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get episode after pricing update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		updated = row
		// A published episode at no price is a free one, which the series
		// lists filter on and the search document records, so a price moved to
		// or from zero changes its series there as well as on its own page.
		if err := catalogindex.Queue(txCtx, q, tenant.ID, catalogindex.SeriesRef(row.SeriesID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the search index sync for the episode's series", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(updated)
	if err := setEpisodeAvailability(mapped, updated.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	if _, err := episodePurchaseAvailability(mapped, updated.PurchaseAvailability, updated.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	s.recordEpisodeUpdated(ctx, tenant.ID, updated.PublicID)
	return &publiraadminv1.UpdateEpisodePricingResponse{Episode: mapped}, nil
}

func (s *adminServer) UpdateEpisodeLayout(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodeLayoutRequest,
) (*publiraadminv1.UpdateEpisodeLayoutResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	storedReadingDirection, err := protomapper.ReadingDirectionOverrideToStored(req.ReadingDirection)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "reading_direction")
	}
	storedSpreadStartIndex := sql.NullInt32{}
	if req.SpreadStartIndex != nil {
		if *req.SpreadStartIndex < 0 {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, protomapper.ErrNegativeSpreadStartIndex, "spread_start_index")
		}
		storedSpreadStartIndex = sql.NullInt32{Int32: *req.SpreadStartIndex, Valid: true}
	}

	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for layout update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	// The count is read outside a lock, so a page added or deleted meanwhile
	// can leave it stale either way. Neither is worth one: an index that ends up
	// past the last page lays the episode out without a spread, which is where
	// deleting a page after a valid index was stored leads as well.
	if storedSpreadStartIndex.Valid {
		pageCount, countErr := s.queriesFor(ctx).CountEpisodeImagesByEpisodeID(ctx, episode.ID)
		if countErr != nil {
			return nil, s.internalDBError(ctx, "failed to count episode pages for layout update", countErr, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
		if storedSpreadStartIndex.Int32 >= pageCount {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("spread_start_index must name one of the episode's pages"), "spread_start_index")
		}
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if err := s.queriesFor(txCtx).UpdateEpisodeLayoutByIDForTenant(txCtx, dbmodels.UpdateEpisodeLayoutByIDForTenantParams{
			TenantID:         tenant.ID,
			ID:               episode.ID,
			ReadingDirection: storedReadingDirection,
			SpreadStartIndex: storedSpreadStartIndex,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode layout", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get episode after layout update", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(updated)
	readingDirection, spreadStartIndex, err := episodeReadingLayout(mapped, protomapper.StoredReadingLayout{
		ReadingDirection:       updated.ReadingDirection,
		SpreadStartIndex:       updated.SpreadStartIndex,
		SeriesReadingDirection: updated.SeriesReadingDirection,
		SeriesSpreadStartIndex: updated.SeriesSpreadStartIndex,
	})
	if err != nil {
		return nil, s.internalError(ctx, "episode layout holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	if err := setEpisodeAvailability(mapped, updated.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	if _, err := episodePurchaseAvailability(mapped, updated.PurchaseAvailability, updated.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}

	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_updated",
			TargetType:  "episode",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	return &publiraadminv1.UpdateEpisodeLayoutResponse{
		Episode:          mapped,
		ReadingDirection: readingDirection,
		SpreadStartIndex: spreadStartIndex,
	}, nil
}

func (s *adminServer) UpdateEpisodeAvailability(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodeAvailabilityRequest,
) (*publiraadminv1.UpdateEpisodeAvailabilityResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	availability, err := protomapper.SurfaceAvailabilityOverrideToStored(req.Availability)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "availability")
	}

	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for availability update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if err := s.queriesFor(txCtx).UpdateEpisodeAvailabilityByIDForTenant(txCtx, dbmodels.UpdateEpisodeAvailabilityByIDForTenantParams{
			TenantID:     tenant.ID,
			ID:           episode.ID,
			Availability: availability,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode availability", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
		// The surfaces an episode is shown on decide where it counts as its
		// series' latest episode and as a free one.
		if err := catalogindex.Queue(txCtx, s.queriesFor(txCtx), tenant.ID, catalogindex.SeriesRef(episode.SeriesID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the search index sync for the episode's series", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get episode after availability update", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(updated)
	if err := setEpisodeAvailability(mapped, updated.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	if _, err := episodePurchaseAvailability(mapped, updated.PurchaseAvailability, updated.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}

	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_updated",
			TargetType:  "episode",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	return &publiraadminv1.UpdateEpisodeAvailabilityResponse{Episode: mapped}, nil
}

func (s *adminServer) UpdateEpisodePurchaseAvailability(
	ctx context.Context,
	req *publiraadminv1.UpdateEpisodePurchaseAvailabilityRequest,
) (*publiraadminv1.UpdateEpisodePurchaseAvailabilityResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	purchaseAvailability, err := protomapper.SurfaceAvailabilityOverrideToStored(req.PurchaseAvailability)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "purchase_availability")
	}

	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for purchase availability update", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if err := s.queriesFor(txCtx).UpdateEpisodePurchaseAvailabilityByIDForTenant(txCtx, dbmodels.UpdateEpisodePurchaseAvailabilityByIDForTenantParams{
			TenantID:             tenant.ID,
			ID:                   episode.ID,
			PurchaseAvailability: purchaseAvailability,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update episode purchase availability", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get episode after purchase availability update", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	mapped := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(updated)
	if err := setEpisodeAvailability(mapped, updated.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}
	savedPurchaseAvailability, err := episodePurchaseAvailability(mapped, updated.PurchaseAvailability, updated.ResolvedPurchaseAvailability)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", updated.PublicID)
	}

	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_updated",
			TargetType:  "episode",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	return &publiraadminv1.UpdateEpisodePurchaseAvailabilityResponse{
		Episode:              mapped,
		PurchaseAvailability: savedPurchaseAvailability,
	}, nil
}
