package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultFreeWindowListLimit int32 = 20
	maxFreeWindowListLimit     int32 = 100
)

// maxSeriesFreeWindowEpisodes bounds the episodes one CreateSeriesFreeWindows
// call may name, the same bound BulkEditEpisodeCredits puts on its range and
// for the same series: one that runs to roughly 800 episodes still fits in a
// single campaign.
const maxSeriesFreeWindowEpisodes = 1000

// seriesFreeWindowEpisodes reads the episodes a CreateSeriesFreeWindows call
// names. Nil means every episode of the series.
func seriesFreeWindowEpisodes(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	ids, err := recordIDsArg(raw, "episode_ids", "episode")
	if err != nil {
		return nil, err
	}
	if len(ids) > maxSeriesFreeWindowEpisodes {
		return nil, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			fmt.Errorf("episode_ids must name at most %d episodes", maxSeriesFreeWindowEpisodes),
			"episode_ids",
		)
	}
	return ids, nil
}

// selectSeriesFreeWindowEpisodes narrows the series' episodes to the ones the
// call named, keeping the series' own order. An id the series does not have —
// another series' episode, another tenant's, or none at all — fails the whole
// call rather than being skipped, since the campaign the caller composed would
// otherwise be smaller than the one it asked for.
func selectSeriesFreeWindowEpisodes(
	episodes []dbmodels.ListEpisodesBySeriesForTenantRow,
	named []uuid.UUID,
) ([]dbmodels.ListEpisodesBySeriesForTenantRow, error) {
	if named == nil {
		return episodes, nil
	}
	wanted := make(map[uuid.UUID]struct{}, len(named))
	for _, id := range named {
		wanted[id] = struct{}{}
	}
	selected := make([]dbmodels.ListEpisodesBySeriesForTenantRow, 0, len(named))
	for _, episode := range episodes {
		if _, ok := wanted[episode.ID]; ok {
			selected = append(selected, episode)
		}
	}
	if len(selected) != len(named) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("episode_ids names an episode this series does not have"), "episode_ids")
	}
	return selected, nil
}

// freeWindowPeriod is a validated request period, in UTC.
type freeWindowPeriod struct {
	startsAt time.Time
	endsAt   time.Time
}

// openAt reports whether the period covers now. The window is half-open, so the
// end instant is already outside it.
func (p freeWindowPeriod) openAt(now time.Time) bool {
	return !p.startsAt.After(now) && p.endsAt.After(now)
}

// parseFreeWindowPeriod reads the two instants a window is scheduled between.
//
// A window may start in the past — that is how an editor makes an episode free
// right now — but one that has already ended is rejected: it would change
// nothing, and the value an editor meant to type is more likely a mistake than
// a campaign nobody can read.
func parseFreeWindowPeriod(startsAt, endsAt string, now time.Time) (freeWindowPeriod, error) {
	start, err := time.Parse(time.RFC3339, startsAt)
	if err != nil {
		return freeWindowPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("starts_at must be RFC3339"), "starts_at")
	}
	end, err := time.Parse(time.RFC3339, endsAt)
	if err != nil {
		return freeWindowPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be RFC3339"), "ends_at")
	}
	// Both instants are reported back with time.RFC3339, which carries no
	// fractional second. Storing what is reported is what lets a client use one
	// window's ends_at as the next one's starts_at, as the RPC documents:
	// a stored microsecond the response cannot show would make that follow-up
	// overlap by less than a second and be refused.
	period := freeWindowPeriod{
		startsAt: start.UTC().Truncate(time.Second),
		endsAt:   end.UTC().Truncate(time.Second),
	}
	if !period.endsAt.After(period.startsAt) {
		return freeWindowPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be after starts_at"), "ends_at")
	}
	if !period.endsAt.After(now) {
		return freeWindowPeriod{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be in the future"), "ends_at")
	}
	return period, nil
}

// errFreeWindowOverlap is what the database says when a period meets one the
// episode already has. The constraint decides it, so concurrent requests cannot
// both win.
var errFreeWindowOverlap = errors.New("the period overlaps a free window this episode already has")

func freeWindowOverlapError() error {
	return connect.NewError(connect.CodeFailedPrecondition, errFreeWindowOverlap.Error()).WithCause(errFreeWindowOverlap)
}

// createdByUserID names the staff member who scheduled the window, when the
// request carries a session. The column is nullable for the same reason
// access_tickets.created_by_user_id is: the account can be deleted later.
func createdByUserID(ctx context.Context) uuid.NullUUID {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true}
}

func (s *adminServer) recordFreeWindowAudit(
	ctx context.Context,
	tenantID uuid.UUID,
	action, targetType, targetID, clientIP string,
) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  targetType,
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientIP,
	})
}

// recordOpenFreeWindow records the drop of the public caches that answer with an
// episode's price or a series' free-episode count — the tags apply-free-windows
// drops at a boundary — and the sync of the series' search document, and writes
// off each window's start so the batch does not do it again, all on the
// transaction that wrote the windows. It is called only for a window that is
// open the moment it is written: a window still ahead of its start changes
// nothing a cache or the index holds yet, and apply-free-windows is what asks
// for both when it opens.
func (s *adminServer) recordOpenFreeWindow(ctx context.Context, q *dbmodels.Queries, tenantID, seriesID uuid.UUID, windowIDs []uuid.UUID) (revalidate.Owed, error) {
	owed, err := s.reval.Record(ctx, q, tenantID, freewindows.RevalidateTags(tenantID))
	if err != nil {
		return revalidate.Owed{}, fmt.Errorf("record cache invalidation: %w", err)
	}
	if err := catalogindex.Queue(ctx, q, tenantID, catalogindex.SeriesRef(seriesID)); err != nil {
		return revalidate.Owed{}, fmt.Errorf("queue catalog index sync: %w", err)
	}
	for _, windowID := range windowIDs {
		if err := q.MarkEpisodeFreeWindowStartRevalidated(ctx, windowID); err != nil {
			return revalidate.Owed{}, fmt.Errorf("mark free window %s start revalidated: %w", windowID, err)
		}
	}
	return owed, nil
}

func (s *adminServer) CreateEpisodeFreeWindow(
	ctx context.Context,
	req *publiraadminv1.CreateEpisodeFreeWindowRequest,
) (*publiraadminv1.CreateEpisodeFreeWindowResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := parseFreeWindowPeriod(req.StartsAt, req.EndsAt, time.Now())
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	episode, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       episodeID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("episode not found"), "episode_id")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for create free window", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}

	windowID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create episode free window transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	created, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateEpisodeFreeWindowRow, error) {
		return q.CreateEpisodeFreeWindow(ctx, dbmodels.CreateEpisodeFreeWindowParams{
			ID:              windowID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			EpisodeID:       episode.ID,
			StartsAt:        period.startsAt,
			EndsAt:          period.endsAt,
			CreatedByUserID: createdByUserID(ctx),
		})
	})
	if err != nil {
		if dberr.IsExclusionViolation(err) {
			return nil, freeWindowOverlapError()
		}
		return nil, s.internalDBError(ctx, "failed to create episode free window", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	var owed revalidate.Owed
	if period.openAt(time.Now()) {
		if owed, err = s.recordOpenFreeWindow(ctx, q, tenant.ID, episode.SeriesID, []uuid.UUID{created.ID}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for an open free window", err, "tenant_id", tenant.ID.String(), "free_window_id", created.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create episode free window", err, "tenant_id", tenant.ID.String(), "free_window_id", created.ID.String())
	}
	s.reval.Send(ctx, owed)

	row, err := s.queriesFor(ctx).GetEpisodeFreeWindowByIDForTenant(ctx, dbmodels.GetEpisodeFreeWindowByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       created.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load created episode free window", err, "tenant_id", tenant.ID.String(), "free_window_id", created.ID.String())
	}

	s.recordFreeWindowAudit(
		ctx,
		tenant.ID,
		"episode_free_window_created",
		"episode_free_window",
		created.PublicID,
		auditlog.ClientIPFromHeader(rpcmiddleware.RequestHeader(ctx)),
	)

	return &publiraadminv1.CreateEpisodeFreeWindowResponse{
		FreeWindow: freeWindowFromGetRow(row),
	}, nil
}

func (s *adminServer) CreateSeriesFreeWindows(
	ctx context.Context,
	req *publiraadminv1.CreateSeriesFreeWindowsRequest,
) (*publiraadminv1.CreateSeriesFreeWindowsResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := parseFreeWindowPeriod(req.StartsAt, req.EndsAt, time.Now())
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}
	namedEpisodeIDs, err := seriesFreeWindowEpisodes(req.EpisodeIds)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create series free windows transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	// The lock is what keeps a concurrent CreateEpisode out of the series while
	// the windows are written, so the campaign covers the episode list the
	// caller is answered with.
	series, err := q.LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       seriesID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("series not found"), "series_id")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for create series free windows", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	episodes, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		SeriesID: series.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes for create series free windows", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	if len(episodes) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "series has no episodes")
	}
	episodes, err = selectSeriesFreeWindowEpisodes(episodes, namedEpisodeIDs)
	if err != nil {
		return nil, err
	}

	createdBy := createdByUserID(ctx)
	windows := make([]*publiraadminv1.AdminEpisodeFreeWindow, 0, len(episodes))
	windowIDs := make([]uuid.UUID, 0, len(episodes))
	for _, episode := range episodes {
		windowID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, connect.NewError(connect.CodeInternal, idErr.Error()).WithCause(idErr)
		}
		created, createErr := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateEpisodeFreeWindowRow, error) {
			return q.CreateEpisodeFreeWindow(ctx, dbmodels.CreateEpisodeFreeWindowParams{
				ID:              windowID,
				TenantID:        tenant.ID,
				PublicID:        publicID,
				EpisodeID:       episode.ID,
				StartsAt:        period.startsAt,
				EndsAt:          period.endsAt,
				CreatedByUserID: createdBy,
			})
		})
		if createErr != nil {
			if dberr.IsExclusionViolation(createErr) {
				return nil, freeWindowOverlapError()
			}
			return nil, s.internalDBError(ctx, "failed to create episode free window", createErr, "tenant_id", tenant.ID.String(), "episode_public_id", episode.PublicID)
		}
		windowIDs = append(windowIDs, created.ID)
		windows = append(windows, &publiraadminv1.AdminEpisodeFreeWindow{
			Id:              created.ID.String(),
			PublicId:        created.PublicID,
			EpisodeId:       episode.ID.String(),
			EpisodePublicId: episode.PublicID,
			EpisodeTitle:    episode.Title,
			SeriesId:        series.ID.String(),
			SeriesPublicId:  series.PublicID,
			StartsAt:        created.StartsAt.UTC().Format(time.RFC3339),
			EndsAt:          created.EndsAt.UTC().Format(time.RFC3339),
			CreatedAt:       created.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	var owed revalidate.Owed
	if period.openAt(time.Now()) {
		if owed, err = s.recordOpenFreeWindow(ctx, q, tenant.ID, series.ID, windowIDs); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for open free windows", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create series free windows", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordFreeWindowAudit(
		ctx,
		tenant.ID,
		"series_free_windows_created",
		"series",
		series.PublicID,
		auditlog.ClientIPFromHeader(rpcmiddleware.RequestHeader(ctx)),
	)

	return &publiraadminv1.CreateSeriesFreeWindowsResponse{FreeWindows: windows}, nil
}

// freeWindowListScope is the one episode or series ListEpisodeFreeWindows
// lists, and the key its tokens are bound to. Exactly one of the two ids is set.
type freeWindowListScope struct {
	episodeID uuid.NullUUID
	seriesID  uuid.NullUUID
	listKey   pagination.ListKey
}

func parseFreeWindowListScope(req *publiraadminv1.ListEpisodeFreeWindowsRequest) (freeWindowListScope, error) {
	listKey := pagination.NewListKey("starts_at_desc")
	switch scope := req.Scope.(type) {
	case *publiraadminv1.ListEpisodeFreeWindowsRequest_EpisodeId:
		id, err := parseRecordID(scope.EpisodeId, "episode_id")
		if err != nil {
			return freeWindowListScope{}, err
		}
		return freeWindowListScope{
			episodeID: uuid.NullUUID{UUID: id, Valid: true},
			listKey:   listKey.Value("episode_id", id.String()),
		}, nil
	case *publiraadminv1.ListEpisodeFreeWindowsRequest_SeriesId:
		id, err := parseRecordID(scope.SeriesId, "series_id")
		if err != nil {
			return freeWindowListScope{}, err
		}
		return freeWindowListScope{
			seriesID: uuid.NullUUID{UUID: id, Valid: true},
			listKey:  listKey.Value("series_id", id.String()),
		}, nil
	default:
		// A list of every window of the tenant is not something the console
		// shows, so the scope is required rather than optional.
		return freeWindowListScope{}, connect.NewError(connect.CodeInvalidArgument, "episode_id or series_id is required")
	}
}

// freeWindowListRow is a row of any of the ListEpisodeFreeWindows* queries,
// which all select the same columns.
type freeWindowListRow dbmodels.ListEpisodeFreeWindowsByEpisodeForTenantDescRow

func freeWindowListRows[T any](rows []T, convert func(T) freeWindowListRow) []freeWindowListRow {
	mapped := make([]freeWindowListRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, convert(row))
	}
	return mapped
}

// freeWindowPage runs the keyset query for one page. Each scope has queries of
// its own, so neither is planned around a filter it does not use. The list
// reads latest start first, so a backward page is scanned by the ascending
// query and put back into display order by pagination.Page.
func (s *adminServer) freeWindowPage(
	ctx context.Context,
	tenantID uuid.UUID,
	scope freeWindowListScope,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]freeWindowListRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorStartsAt := sql.NullTime{Time: keys.Time, Valid: keys.Valid}
	backward := direction == pagination.Backward

	if scope.episodeID.Valid {
		if backward {
			rows, err := queries.ListEpisodeFreeWindowsByEpisodeForTenantAsc(ctx, dbmodels.ListEpisodeFreeWindowsByEpisodeForTenantAscParams{
				TenantID:        tenantID,
				EpisodeID:       scope.episodeID.UUID,
				CursorID:        cursorID,
				CursorInclusive: keys.Inclusive,
				CursorStartsAt:  cursorStartsAt,
				Limit:           limit,
			})
			return freeWindowListRows(rows, func(row dbmodels.ListEpisodeFreeWindowsByEpisodeForTenantAscRow) freeWindowListRow {
				return freeWindowListRow(row)
			}), err
		}
		rows, err := queries.ListEpisodeFreeWindowsByEpisodeForTenantDesc(ctx, dbmodels.ListEpisodeFreeWindowsByEpisodeForTenantDescParams{
			TenantID:        tenantID,
			EpisodeID:       scope.episodeID.UUID,
			CursorID:        cursorID,
			CursorInclusive: keys.Inclusive,
			CursorStartsAt:  cursorStartsAt,
			Limit:           limit,
		})
		return freeWindowListRows(rows, func(row dbmodels.ListEpisodeFreeWindowsByEpisodeForTenantDescRow) freeWindowListRow {
			return freeWindowListRow(row)
		}), err
	}

	if backward {
		rows, err := queries.ListEpisodeFreeWindowsBySeriesForTenantAsc(ctx, dbmodels.ListEpisodeFreeWindowsBySeriesForTenantAscParams{
			TenantID:        tenantID,
			SeriesID:        scope.seriesID.UUID,
			CursorID:        cursorID,
			CursorInclusive: keys.Inclusive,
			CursorStartsAt:  cursorStartsAt,
			Limit:           limit,
		})
		return freeWindowListRows(rows, func(row dbmodels.ListEpisodeFreeWindowsBySeriesForTenantAscRow) freeWindowListRow {
			return freeWindowListRow(row)
		}), err
	}
	rows, err := queries.ListEpisodeFreeWindowsBySeriesForTenantDesc(ctx, dbmodels.ListEpisodeFreeWindowsBySeriesForTenantDescParams{
		TenantID:        tenantID,
		SeriesID:        scope.seriesID.UUID,
		CursorID:        cursorID,
		CursorInclusive: keys.Inclusive,
		CursorStartsAt:  cursorStartsAt,
		Limit:           limit,
	})
	return freeWindowListRows(rows, func(row dbmodels.ListEpisodeFreeWindowsBySeriesForTenantDescRow) freeWindowListRow {
		return freeWindowListRow(row)
	}), err
}

func (s *adminServer) ListEpisodeFreeWindows(
	ctx context.Context,
	req *publiraadminv1.ListEpisodeFreeWindowsRequest,
) (*publiraadminv1.ListEpisodeFreeWindowsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	scope, err := parseFreeWindowListScope(req)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultFreeWindowListLimit, maxFreeWindowListLimit)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = scope.listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.freeWindowPage(ctx, tenant.ID, scope, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode free windows", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	windows := make([]*publiraadminv1.AdminEpisodeFreeWindow, 0, len(rows))
	for _, row := range rows {
		windows = append(windows, freeWindowFromListRow(row))
	}

	res := &publiraadminv1.ListEpisodeFreeWindowsResponse{FreeWindows: windows}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = scope.listKey.EncodeTimeUUID(pagination.Backward, rows[0].StartsAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = scope.listKey.EncodeTimeUUID(pagination.Forward, last.StartsAt, last.ID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = scope.listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = scope.listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return res, nil
}

func (s *adminServer) DeleteEpisodeFreeWindow(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeFreeWindowRequest,
) (*publiraadminv1.DeleteEpisodeFreeWindowResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	windowID, err := parseRecordID(req.FreeWindowId, "free_window_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.DeleteEpisodeFreeWindowByIDForTenantRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.queriesFor(txCtx).DeleteEpisodeFreeWindowByIDForTenant(txCtx, dbmodels.DeleteEpisodeFreeWindowByIDForTenantParams{
			TenantID: tenant.ID,
			ID:       windowID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "free window not found")
			}
			return nil, s.internalDBError(ctx, "failed to delete episode free window", err, "tenant_id", tenant.ID.String(), "free_window_id", windowID.String())
		}
		deleted = row
		// Only a window that has started and that apply-free-windows has not
		// closed yet is holding a cached page open, or a search document saying
		// a free episode is. One still ahead of its start never reached either.
		// One already over is closed only once the batch has applied its end:
		// past ends_at but not yet applied, deleting the row takes away the
		// boundary the batch would have acted on, so this is the last chance
		// to ask for what it would have.
		if row.StartsAt.After(time.Now()) || row.EndRevalidatedAt.Valid {
			return nil, nil
		}
		if err := catalogindex.Queue(txCtx, s.queriesFor(txCtx), tenant.ID, catalogindex.SeriesRef(row.SeriesID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the search index sync for the free window's series", err, "tenant_id", tenant.ID.String(), "free_window_id", windowID.String())
		}
		return freewindows.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recordFreeWindowAudit(
		ctx,
		tenant.ID,
		"episode_free_window_deleted",
		"episode_free_window",
		deleted.PublicID,
		auditlog.ClientIPFromHeader(rpcmiddleware.RequestHeader(ctx)),
	)

	return &publiraadminv1.DeleteEpisodeFreeWindowResponse{}, nil
}

func freeWindowFromGetRow(row dbmodels.GetEpisodeFreeWindowByIDForTenantRow) *publiraadminv1.AdminEpisodeFreeWindow {
	return &publiraadminv1.AdminEpisodeFreeWindow{
		Id:              row.ID.String(),
		PublicId:        row.PublicID,
		EpisodeId:       row.EpisodeID.String(),
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesId:        row.SeriesID.String(),
		SeriesPublicId:  row.SeriesPublicID,
		StartsAt:        row.StartsAt.UTC().Format(time.RFC3339),
		EndsAt:          row.EndsAt.UTC().Format(time.RFC3339),
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func freeWindowFromListRow(row freeWindowListRow) *publiraadminv1.AdminEpisodeFreeWindow {
	return &publiraadminv1.AdminEpisodeFreeWindow{
		Id:              row.ID.String(),
		PublicId:        row.PublicID,
		EpisodeId:       row.EpisodeID.String(),
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesId:        row.SeriesID.String(),
		SeriesPublicId:  row.SeriesPublicID,
		StartsAt:        row.StartsAt.UTC().Format(time.RFC3339),
		EndsAt:          row.EndsAt.UTC().Format(time.RFC3339),
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
	}
}
