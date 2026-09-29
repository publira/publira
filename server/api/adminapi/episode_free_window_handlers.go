package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

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
	return connect.NewError(connect.CodeFailedPrecondition, errFreeWindowOverlap)
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
// episode's price, and writes off each window's start so the batch does not do
// it again, both on the transaction that wrote the windows. It is called only
// for a window that is open the moment it is written: a window still ahead of
// its start changes nothing a cache holds yet, and apply-free-windows is what
// drops them when it opens.
func (s *adminServer) recordOpenFreeWindow(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, windowIDs []uuid.UUID) (revalidate.Owed, error) {
	owed, err := s.reval.Record(ctx, q, tenantID, episodeScheduleRevalidateTags(tenantID.String()))
	if err != nil {
		return revalidate.Owed{}, fmt.Errorf("record cache invalidation: %w", err)
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
	req *connect.Request[publiraadminv1.CreateEpisodeFreeWindowRequest],
) (*connect.Response[publiraadminv1.CreateEpisodeFreeWindowResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := parseFreeWindowPeriod(req.Msg.StartsAt, req.Msg.EndsAt, time.Now())
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.Msg.EpisodeId, "episode_id")
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		if owed, err = s.recordOpenFreeWindow(ctx, q, tenant.ID, []uuid.UUID{created.ID}); err != nil {
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
		auditlog.ClientIPFromHeader(req.Header()),
	)

	return connect.NewResponse(&publiraadminv1.CreateEpisodeFreeWindowResponse{
		FreeWindow: freeWindowFromGetRow(row),
	}), nil
}

func (s *adminServer) CreateSeriesFreeWindows(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateSeriesFreeWindowsRequest],
) (*connect.Response[publiraadminv1.CreateSeriesFreeWindowsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := parseFreeWindowPeriod(req.Msg.StartsAt, req.Msg.EndsAt, time.Now())
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.Msg.SeriesId, "series_id")
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
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("series has no episodes"))
	}

	createdBy := createdByUserID(ctx)
	windows := make([]*publiraadminv1.AdminEpisodeFreeWindow, 0, len(episodes))
	windowIDs := make([]uuid.UUID, 0, len(episodes))
	for _, episode := range episodes {
		windowID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, connect.NewError(connect.CodeInternal, idErr)
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
		if owed, err = s.recordOpenFreeWindow(ctx, q, tenant.ID, windowIDs); err != nil {
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
		auditlog.ClientIPFromHeader(req.Header()),
	)

	return connect.NewResponse(&publiraadminv1.CreateSeriesFreeWindowsResponse{FreeWindows: windows}), nil
}

func (s *adminServer) DeleteEpisodeFreeWindow(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteEpisodeFreeWindowRequest],
) (*connect.Response[publiraadminv1.DeleteEpisodeFreeWindowResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	windowID, err := parseRecordID(req.Msg.FreeWindowId, "free_window_id")
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
				return nil, connect.NewError(connect.CodeNotFound, errors.New("free window not found"))
			}
			return nil, s.internalDBError(ctx, "failed to delete episode free window", err, "tenant_id", tenant.ID.String(), "free_window_id", windowID.String())
		}
		deleted = row
		// Only a window that was open is holding a cached page open. One still
		// ahead of its start never reached the public site, and one already over
		// was closed by apply-free-windows when it ended.
		window := freeWindowPeriod{startsAt: row.StartsAt, endsAt: row.EndsAt}
		if !window.openAt(time.Now()) {
			return nil, nil
		}
		return episodeScheduleRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	s.recordFreeWindowAudit(
		ctx,
		tenant.ID,
		"episode_free_window_deleted",
		"episode_free_window",
		deleted.PublicID,
		auditlog.ClientIPFromHeader(req.Header()),
	)

	return connect.NewResponse(&publiraadminv1.DeleteEpisodeFreeWindowResponse{}), nil
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
