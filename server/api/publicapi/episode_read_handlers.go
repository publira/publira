package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
)

const (
	defaultEpisodeReadPageSize = int32(20)
	maxEpisodeReadPageSize     = int32(100)
)

// scopeEpisodeReadUser applies the member part of the RLS policies that guard
// a reader's own history — episode_reads and episode_reading_positions — to the
// request connection. Direct handler tests use sqlmock and therefore have no
// request connection to scope.
func (s *apiServer) scopeEpisodeReadUser(ctx context.Context, userID uuid.UUID) error {
	conn, ok := rpcmiddleware.TenantConnFromContext(ctx)
	if !ok {
		return nil
	}
	if err := tenantconn.SetUser(ctx, conn, userID); err != nil {
		return s.internalDBError(ctx, "failed to set episode read member context", err, "user_id", userID.String())
	}
	return nil
}

// MarkEpisodeAsRead records the authenticated member's first completed read
// of an episode. The single write query repeats publication and paid-body
// access checks, so a stale client notification cannot create a read after the
// episode was unpublished or the member's access was revoked.
func (s *apiServer) MarkEpisodeAsRead(
	ctx context.Context,
	req *connect.Request[publirav1.MarkEpisodeAsReadRequest],
) (*connect.Response[publirav1.MarkEpisodeAsReadResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}

	readID, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to allocate episode read id", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	read, err := s.queriesFor(ctx).MarkPublishedEpisodeAsRead(ctx, dbmodels.MarkPublishedEpisodeAsReadParams{
		ID:              readID,
		TenantID:        tenant.ID,
		UserID:          user.ID,
		EpisodePublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Publication, tenant, and entitlement failures deliberately share one
		// response so this member cannot probe for unavailable episode IDs.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to mark episode as read", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	s.projectEpisodeCompleteEvent(ctx, read)

	return noStorePrivateResponse(&publirav1.MarkEpisodeAsReadResponse{
		ReadAt: read.ReadAt.UTC().Format(time.RFC3339Nano),
	}), nil
}

// projectEpisodeCompleteEvent files the analytics counterpart of a stored read.
//
// It reports nothing for the same reason the view instrumentation does not: the
// member's read is already persisted, and failing their request over the
// engagement projection would trade the state they asked for against a number
// nobody is waiting on. What is lost is a row `batch project-episode-reads`
// puts back, because the projection is keyed by the read it came from and can
// be replayed from episode_reads at any time.
func (s *apiServer) projectEpisodeCompleteEvent(ctx context.Context, read dbmodels.EpisodeRead) {
	logAttrs := []any{
		"event_type", "episode_complete",
		"tenant_id", read.TenantID.String(),
		"episode_id", read.EpisodeID.String(),
	}

	eventID, err := uuid.NewV7()
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to allocate episode complete event id", append(logAttrs, "error", err)...)
		return
	}

	_, err = s.queriesFor(ctx).ProjectEpisodeCompleteEvent(ctx, dbmodels.ProjectEpisodeCompleteEventParams{
		ID:        eventID,
		TenantID:  read.TenantID,
		UserID:    read.UserID,
		EpisodeID: read.EpisodeID,
	})
	// ON CONFLICT DO NOTHING returns no rows: this read was already projected,
	// which is a repeated notification rather than a failure.
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.ErrorContext(ctx, "failed to project episode complete event", append(logAttrs, "error", err)...)
	}
}

// ListMyEpisodeReads answers the reader's own reading history: the episodes
// they have finished, most recently finished first.
//
// The page is one query rather than the identifiers-then-display-data pair
// ListMyRecentSeries uses. A history row is an episode title and its series
// title, two joins on the reader's own rows, instead of the series card that
// pair exists to keep out of the keyset scan.
func (s *apiServer) ListMyEpisodeReads(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyEpisodeReadsRequest],
) (*connect.Response[publirav1.ListMyEpisodeReadsResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultEpisodeReadPageSize, maxEpisodeReadPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.episodeReadPage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode reads", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirav1.MyEpisodeRead, 0, len(rows))
	for _, row := range rows {
		items = append(items, myEpisodeReadFromRow(row))
	}

	res := &publirav1.ListMyEpisodeReadsResponse{Reads: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, first.ReadAt, first.ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.ReadAt, last.ID)
		}
	// An empty page means the boundary row moved after the token was issued.
	// Hand back a token to where the client came from, and only once: a
	// recovery token that comes back empty means the boundary is gone too, so
	// both tokens stay empty rather than bouncing between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return noStorePrivateResponse(res), nil
}

// episodeReadPage runs the keyset scan in the direction the cursor asks for.
// The ascending query returns the same columns, so its rows are converted
// rather than mapped through a third type.
func (s *apiServer) episodeReadPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.ListMyEpisodeReadsDescRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyEpisodeReadsDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorReadAt:    sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	if direction == pagination.Backward {
		ascending, err := queries.ListMyEpisodeReadsAsc(ctx, dbmodels.ListMyEpisodeReadsAscParams(params))
		if err != nil {
			return nil, err
		}
		rows := make([]dbmodels.ListMyEpisodeReadsDescRow, 0, len(ascending))
		for _, row := range ascending {
			rows = append(rows, dbmodels.ListMyEpisodeReadsDescRow(row))
		}
		return rows, nil
	}

	return queries.ListMyEpisodeReadsDesc(ctx, params)
}

func myEpisodeReadFromRow(row dbmodels.ListMyEpisodeReadsDescRow) *publirav1.MyEpisodeRead {
	return &publirav1.MyEpisodeRead{
		Series: &publirattypesv1.Series{
			PublicId: row.SeriesPublicID,
			Title:    row.SeriesTitle,
		},
		Episode: &publirattypesv1.Episode{
			PublicId:   row.EpisodePublicID,
			Title:      row.EpisodeTitle,
			OrderIndex: row.EpisodeOrderIndex,
		},
		ReadAt: row.ReadAt.UTC().Format(time.RFC3339Nano),
	}
}
