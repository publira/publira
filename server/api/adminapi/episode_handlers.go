package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/episodeimages"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func parseScheduledAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be RFC3339"))
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

func normalizeAndValidateScheduledAt(scheduledAt sql.NullTime, now time.Time) (sql.NullTime, error) {
	if !scheduledAt.Valid {
		return scheduledAt, nil
	}
	normalized := scheduledAt.Time.UTC()
	if !normalized.After(now.UTC()) {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be in the future"))
	}
	return sql.NullTime{Time: normalized, Valid: true}, nil
}

func episodeScheduleRevalidateTags(tenantID string) []string {
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

// The ListEpisodes cursor carries the sort keys of the boundary row in query
// order: order_index, then the id that breaks its ties. A recovery token adds
// the inclusive marker so the boundary row itself comes back once. Token rules:
// proto/README.md.
func encodeEpisodeCursor(direction pagination.Direction, row episodePageRow) string {
	return pagination.Encode(direction, strconv.FormatInt(int64(row.orderIndex), 10), row.id.String())
}

func encodeEpisodeRecoveryToken(direction pagination.Direction, keys episodeCursorKeys) string {
	return pagination.Encode(
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
}

func (r episodePageRow) toProto() *publirattypesv1.Episode {
	episode := &publirattypesv1.Episode{
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
	return episode
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
	seriesPublicID string,
	keys episodeCursorKeys,
	direction pagination.Direction,
	limit int32,
) ([]episodePageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListEpisodesBySeriesForTenantDesc(ctx, dbmodels.ListEpisodesBySeriesForTenantDescParams{
			TenantID:         tenantID,
			PublicID:         seriesPublicID,
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
		PublicID:         seriesPublicID,
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
	req *connect.Request[publiraadminv1.ListEpisodesRequest],
) (*connect.Response[publiraadminv1.ListEpisodesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultEpisodePageSize, maxEpisodePageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys episodeCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeEpisodeCursorKeys(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.episodePage(ctx, tenant.ID, req.Msg.SeriesPublicId, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError("failed to list episodes", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	episodes := make([]*publirattypesv1.Episode, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, row.toProto())
	}

	res := &publiraadminv1.ListEpisodesResponse{Episodes: episodes}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeEpisodeCursor(pagination.Backward, rows[0])
		}
		if hasNext {
			res.NextToken = encodeEpisodeCursor(pagination.Forward, rows[len(rows)-1])
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeEpisodeRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeEpisodeRecoveryToken(pagination.Forward, keys)
	}

	return connect.NewResponse(res), nil
}

func (s *adminServer) GetEpisode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetEpisodeRequest],
) (*connect.Response[publiraadminv1.GetEpisodeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}
	if strings.TrimSpace(req.Msg.PublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	row, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenantAndSeries(ctx, dbmodels.GetEpisodeByPublicIDForTenantAndSeriesParams{
		TenantID:   tenant.ID,
		PublicID:   req.Msg.SeriesPublicId,
		PublicID_2: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError("failed to get episode", err, "tenant_id", tenant.ID.String())
	}

	return connect.NewResponse(&publiraadminv1.GetEpisodeResponse{
		Episode: protomapper.EpisodeFromGetEpisodeByPublicIDForTenantAndSeriesRow(row),
	}), nil
}

func validateEpisodePublicIDList(ids []string, field string) error {
	if len(ids) == 0 {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s are required", field))
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains empty value", field))
		}
		if _, ok := seen[id]; ok {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("%s contains duplicate episode", field))
		}
		seen[id] = struct{}{}
	}
	return nil
}

func sameEpisodePublicIDSet(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	want := make(map[string]struct{}, len(left))
	for _, id := range left {
		want[id] = struct{}{}
	}
	for _, id := range right {
		if _, ok := want[id]; !ok {
			return false
		}
	}
	return true
}

func listEpisodePublicIDs(rows []dbmodels.ListEpisodesBySeriesForTenantRow) []string {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.PublicID)
	}
	return ids
}

func (s *adminServer) ReorderEpisodes(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderEpisodesRequest],
) (*connect.Response[publiraadminv1.ReorderEpisodesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}
	if err := validateEpisodePublicIDList(req.Msg.EpisodePublicIds, "episode_public_ids"); err != nil {
		return nil, err
	}
	if err := validateEpisodePublicIDList(req.Msg.ExpectedEpisodePublicIds, "expected_episode_public_ids"); err != nil {
		return nil, err
	}
	if !sameEpisodePublicIDSet(req.Msg.EpisodePublicIds, req.Msg.ExpectedEpisodePublicIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids must be a permutation of expected_episode_public_ids"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError("failed to begin reorder episodes transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	seriesID, err := q.LockSeriesByPublicIDForTenant(ctx, dbmodels.LockSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError("failed to lock series for reorder episodes", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.SeriesPublicId)
	}

	// Read after the lock so READ COMMITTED sees rows committed while this
	// transaction waited. Matching expected_episode_public_ids is what says
	// the client's merge is still based on the current series order.
	rows, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		return nil, s.internalDBError("failed to list episodes for reorder", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if !slices.Equal(listEpisodePublicIDs(rows), req.Msg.ExpectedEpisodePublicIds) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("episode order has changed"))
	}

	for index, episodePublicID := range req.Msg.EpisodePublicIds {
		if err := q.UpdateEpisodeOrderIndexByPublicIDForTenantAndSeries(ctx, dbmodels.UpdateEpisodeOrderIndexByPublicIDForTenantAndSeriesParams{
			TenantID:   tenant.ID,
			PublicID:   req.Msg.SeriesPublicId,
			PublicID_2: episodePublicID,
			OrderIndex: int32(index + 1),
		}); err != nil {
			return nil, s.internalDBError("failed to update episode order_index", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String(), "episode_public_id", episodePublicID)
		}
	}

	updatedRows, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		return nil, s.internalDBError("failed to list episodes after reorder", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit reorder episodes", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	episodes := make([]*publirattypesv1.Episode, 0, len(updatedRows))
	for _, row := range updatedRows {
		episodes = append(episodes, protomapper.EpisodeFromListEpisodesBySeriesForTenantRow(row))
	}

	return connect.NewResponse(&publiraadminv1.ReorderEpisodesResponse{Episodes: episodes}), nil
}

func (s *adminServer) CreateEpisode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateEpisodeRequest],
) (*connect.Response[publiraadminv1.CreateEpisodeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.OrderIndex < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("order_index must be greater than or equal to 0"))
	}
	if req.Msg.Price < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("price must be greater than or equal to 0"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError("failed to begin create episode transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	seriesID, err := q.LockSeriesByPublicIDForTenant(ctx, dbmodels.LockSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError("failed to lock series for create episode", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.SeriesPublicId)
	}

	// An unset order_index means "append". Resolving it here keeps the client
	// from having to read the whole series to find the end, which a paged
	// ListEpisodes can no longer hand it in one call. The MAX is a separate
	// statement from the lock so READ COMMITTED sees rows committed while
	// this transaction waited.
	orderIndex := req.Msg.OrderIndex
	if orderIndex == 0 {
		maxOrderIndex, maxErr := q.GetMaxEpisodeOrderIndexBySeriesForTenant(ctx, dbmodels.GetMaxEpisodeOrderIndexBySeriesForTenantParams{
			TenantID: tenant.ID,
			PublicID: req.Msg.SeriesPublicId,
		})
		if maxErr != nil {
			return nil, s.internalDBError("failed to resolve episode order_index", maxErr, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.SeriesPublicId)
		}
		if maxOrderIndex == math.MaxInt32 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("episode order_index limit reached"))
		}
		orderIndex = maxOrderIndex + 1
	}
	episodeID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.Episode, error) {
		return q.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{
			ID:         episodeID,
			OrderIndex: orderIndex,
			PublicID:   publicID,
			SeriesID:   seriesID,
			TenantID:   tenant.ID,
			Title:      req.Msg.Title,
		})
	})
	if err != nil {
		return nil, s.internalDBError("failed to create episode", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.SeriesPublicId)
	}
	status := "draft"
	if scheduledAt.Valid {
		status = "scheduled"
	}
	listing, err := q.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID:          base.ID,
		Price:              req.Msg.Price,
		PublishedAt:        sql.NullTime{},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		ScheduledAt:        scheduledAt,
		Status:             status,
		TenantID:           tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError("failed to upsert episode listing", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError("failed to commit create episode", err, "tenant_id", tenant.ID.String(), "episode_id", base.ID.String())
	}
	episode := &publirattypesv1.Episode{PublicId: base.PublicID, Title: base.Title, OrderIndex: base.OrderIndex, Price: listing.Price, Status: listing.Status}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
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
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.CreateEpisodeResponse{Episode: episode}), nil
}

func (s *adminServer) UploadEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.UploadEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	items, err := episodeimages.Service{Queries: s.queriesFor(ctx), Storage: s.storage, Recorder: s.recorderFor(ctx)}.Upload(ctx, episodeimages.UploadRequest{
		Tenant:          tenant,
		SeriesPublicID:  req.Msg.SeriesPublicId,
		EpisodePublicID: req.Msg.EpisodePublicId,
		Images:          req.Msg.Images,
		ArchiveData:     req.Msg.ArchiveData,
		ArchiveFilename: req.Msg.ArchiveFilename,
		ArchiveType:     req.Msg.ArchiveContentType,
		Headers:         req.Header(),
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.UploadEpisodeImagesResponse{Images: items}), nil
}

func (s *adminServer) ListEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.ListEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: episodePublicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError("failed to get episode for list episode images", err, "tenant_id", tenant.ID.String())
	}
	rows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, s.internalDBError("failed to list episode images", err, "tenant_id", tenant.ID.String())
	}

	images := make([]*publirattypesv1.EpisodeImage, 0, len(rows))
	for _, row := range rows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}

	return connect.NewResponse(&publiraadminv1.ListEpisodeImagesResponse{Images: images}), nil
}

func (s *adminServer) ReorderEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.ReorderEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	if len(req.Msg.ImageIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids are required"))
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: episodePublicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(req.Msg.ImageIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids must include all images in the episode"))
	}

	validImageIDs := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		validImageIDs[row.ID.String()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(req.Msg.ImageIds))
	for _, imageID := range req.Msg.ImageIds {
		if strings.TrimSpace(imageID) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains empty value"))
		}
		if _, ok := validImageIDs[imageID]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains unknown image"))
		}
		if _, ok := seen[imageID]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains duplicate image"))
		}
		seen[imageID] = struct{}{}
	}

	for index, imageID := range req.Msg.ImageIds {
		parsedImageID, err := uuid.Parse(imageID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains invalid uuid"))
		}
		if err := s.queriesFor(ctx).UpdateEpisodeImageDisplayOrderByIDForEpisode(ctx, dbmodels.UpdateEpisodeImageDisplayOrderByIDForEpisodeParams{
			ID:           parsedImageID,
			EpisodeID:    episode.ID,
			DisplayOrder: int32(index + 1),
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	updatedRows, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	images := make([]*publirattypesv1.EpisodeImage, 0, len(updatedRows))
	for _, row := range updatedRows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}

	return connect.NewResponse(&publiraadminv1.ReorderEpisodeImagesResponse{Images: images}), nil
}

func (s *adminServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateEpisodePublishScheduleRequest],
) (*connect.Response[publiraadminv1.UpdateEpisodePublishScheduleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
	if err != nil {
		return nil, err
	}
	err = s.queriesFor(ctx).UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId, ScheduledAt: scheduledAt})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	ep, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
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
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenant.ID.String(), tenant.Domain, episodeScheduleRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after episode schedule update", "tenant_public_id", tenant.PublicID, "episode_public_id", req.Msg.EpisodePublicId, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.UpdateEpisodePublishScheduleResponse{Episode: protomapper.EpisodeFromGetEpisodeByPublicIDForTenantRow(ep)}), nil
}
