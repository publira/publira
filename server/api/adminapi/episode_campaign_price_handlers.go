package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/campaignprices"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	defaultCampaignPriceListLimit int32 = 20
	maxCampaignPriceListLimit     int32 = 100
)

// checkCampaignPrice refuses a campaign price at or below zero. A campaign at
// no price would be a free window, which is what opens an episode to everyone.
func checkCampaignPrice(price int32) error {
	if price <= 0 {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("price must be greater than 0"), "price")
	}
	return nil
}

// checkCampaignUndercuts refuses a campaign price that does not cut the
// episode's own: a free episode has nothing to cut, and a campaign at or above
// the price would sell for no less.
func checkCampaignUndercuts(campaignPrice, episodePrice int32) error {
	if campaignPrice >= episodePrice {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("price must be below the episode's price"), "price")
	}
	return nil
}

// seriesCampaignPriceEpisodes reads the episodes a CreateSeriesCampaignPrices
// call names. Unlike a free window, a campaign is not scheduled on a whole
// series by naming none: its price has to undercut each episode's own, which a
// series of free and priced episodes alike cannot all satisfy.
func seriesCampaignPriceEpisodes(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("episode_ids must name at least one episode"), "episode_ids")
	}
	ids, err := recordIDsArg(raw, "episode_ids", "episode")
	if err != nil {
		return nil, err
	}
	if len(ids) > maxSeriesScheduleEpisodes {
		return nil, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			fmt.Errorf("episode_ids must name at most %d episodes", maxSeriesScheduleEpisodes),
			"episode_ids",
		)
	}
	return ids, nil
}

// errCampaignPriceOverlap is what the database says when a period meets one the
// episode already has. The constraint decides it, so concurrent requests cannot
// both win.
var errCampaignPriceOverlap = errors.New("the period overlaps a campaign price this episode already has")

func campaignPriceOverlapError() error {
	return connect.NewError(connect.CodeFailedPrecondition, errCampaignPriceOverlap.Error()).WithCause(errCampaignPriceOverlap)
}

// recordOpenCampaignPrices records the drop of the public caches that quote an
// episode's price — the tag apply-campaign-prices drops at a boundary — and
// writes off each campaign's start so the batch does not do it again, on the
// transaction that wrote the campaigns. It is called only for a campaign that
// is open the moment it is written: one still ahead of its start changes
// nothing a cache holds yet, and apply-campaign-prices asks for the drop when
// it starts.
func (s *adminServer) recordOpenCampaignPrices(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, campaignIDs []uuid.UUID) (revalidate.Owed, error) {
	owed, err := s.reval.Record(ctx, q, tenantID, campaignprices.RevalidateTags(tenantID))
	if err != nil {
		return revalidate.Owed{}, fmt.Errorf("record cache invalidation: %w", err)
	}
	for _, campaignID := range campaignIDs {
		if err := q.MarkEpisodeCampaignPriceStartRevalidated(ctx, campaignID); err != nil {
			return revalidate.Owed{}, fmt.Errorf("mark campaign price %s start revalidated: %w", campaignID, err)
		}
	}
	return owed, nil
}

func (s *adminServer) CreateEpisodeCampaignPrice(
	ctx context.Context,
	req *publiraadminv1.CreateEpisodeCampaignPriceRequest,
) (*publiraadminv1.CreateEpisodeCampaignPriceResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if err := checkCampaignPrice(req.Price); err != nil {
		return nil, err
	}
	period, err := parseScheduledPeriod(req.StartsAt, req.EndsAt, time.Now())
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
		return nil, s.internalDBError(ctx, "failed to get episode for create campaign price", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	if err := checkCampaignUndercuts(req.Price, episode.Price); err != nil {
		return nil, err
	}

	campaignID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create episode campaign price transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	if err := s.checkPriceCurrency(ctx, q, tenant.ID, req.Price, req.Currency); err != nil {
		return nil, err
	}
	created, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateEpisodeCampaignPriceRow, error) {
		return q.CreateEpisodeCampaignPrice(ctx, dbmodels.CreateEpisodeCampaignPriceParams{
			ID:              campaignID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			EpisodeID:       episode.ID,
			Price:           req.Price,
			StartsAt:        period.startsAt,
			EndsAt:          period.endsAt,
			CreatedByUserID: createdByUserID(ctx),
		})
	})
	if err != nil {
		if dberr.IsExclusionViolation(err) {
			return nil, campaignPriceOverlapError()
		}
		return nil, s.internalDBError(ctx, "failed to create episode campaign price", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	var owed revalidate.Owed
	if period.openAt(time.Now()) {
		if owed, err = s.recordOpenCampaignPrices(ctx, q, tenant.ID, []uuid.UUID{created.ID}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for an open campaign price", err, "tenant_id", tenant.ID.String(), "campaign_price_id", created.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create episode campaign price", err, "tenant_id", tenant.ID.String(), "campaign_price_id", created.ID.String())
	}
	s.reval.Send(ctx, owed)

	row, err := s.queriesFor(ctx).GetEpisodeCampaignPriceByIDForTenant(ctx, dbmodels.GetEpisodeCampaignPriceByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       created.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load created episode campaign price", err, "tenant_id", tenant.ID.String(), "campaign_price_id", created.ID.String())
	}

	s.recordScheduleAudit(
		ctx,
		tenant.ID,
		"episode_campaign_price_created",
		"episode_campaign_price",
		created.PublicID,
		clientip.FromContext(ctx),
	)

	return &publiraadminv1.CreateEpisodeCampaignPriceResponse{
		CampaignPrice: campaignPriceFromRow(campaignPriceRow(row)),
	}, nil
}

func (s *adminServer) CreateSeriesCampaignPrices(
	ctx context.Context,
	req *publiraadminv1.CreateSeriesCampaignPricesRequest,
) (*publiraadminv1.CreateSeriesCampaignPricesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if err := checkCampaignPrice(req.Price); err != nil {
		return nil, err
	}
	period, err := parseScheduledPeriod(req.StartsAt, req.EndsAt, time.Now())
	if err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}
	namedEpisodeIDs, err := seriesCampaignPriceEpisodes(req.EpisodeIds)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create series campaign prices transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	// The lock keeps the series' episodes as they were read while the
	// campaigns are written, as CreateSeriesFreeWindows does.
	series, err := q.LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       seriesID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("series not found"), "series_id")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for create series campaign prices", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	episodes, err := q.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		SeriesID: series.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episodes for create series campaign prices", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	episodes, err = selectSeriesEpisodes(episodes, namedEpisodeIDs)
	if err != nil {
		return nil, err
	}
	for _, episode := range episodes {
		if err := checkCampaignUndercuts(req.Price, episode.Price); err != nil {
			return nil, err
		}
	}
	if err := s.checkPriceCurrency(ctx, q, tenant.ID, req.Price, req.Currency); err != nil {
		return nil, err
	}

	createdBy := createdByUserID(ctx)
	campaigns := make([]*publiraadminv1.AdminEpisodeCampaignPrice, 0, len(episodes))
	campaignIDs := make([]uuid.UUID, 0, len(episodes))
	for _, episode := range episodes {
		campaignID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, connect.NewError(connect.CodeInternal, idErr.Error()).WithCause(idErr)
		}
		created, createErr := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.CreateEpisodeCampaignPriceRow, error) {
			return q.CreateEpisodeCampaignPrice(ctx, dbmodels.CreateEpisodeCampaignPriceParams{
				ID:              campaignID,
				TenantID:        tenant.ID,
				PublicID:        publicID,
				EpisodeID:       episode.ID,
				Price:           req.Price,
				StartsAt:        period.startsAt,
				EndsAt:          period.endsAt,
				CreatedByUserID: createdBy,
			})
		})
		if createErr != nil {
			if dberr.IsExclusionViolation(createErr) {
				return nil, campaignPriceOverlapError()
			}
			return nil, s.internalDBError(ctx, "failed to create episode campaign price", createErr, "tenant_id", tenant.ID.String(), "episode_public_id", episode.PublicID)
		}
		campaignIDs = append(campaignIDs, created.ID)
		campaigns = append(campaigns, campaignPriceFromRow(campaignPriceListRow{
			ID:              created.ID,
			PublicID:        created.PublicID,
			Price:           created.Price,
			StartsAt:        created.StartsAt,
			EndsAt:          created.EndsAt,
			CreatedAt:       created.CreatedAt,
			EpisodeID:       episode.ID,
			EpisodePublicID: episode.PublicID,
			EpisodeTitle:    episode.Title,
			SeriesID:        series.ID,
			SeriesPublicID:  series.PublicID,
		}))
	}

	var owed revalidate.Owed
	if period.openAt(time.Now()) {
		if owed, err = s.recordOpenCampaignPrices(ctx, q, tenant.ID, campaignIDs); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for open campaign prices", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create series campaign prices", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordScheduleAudit(
		ctx,
		tenant.ID,
		"series_campaign_prices_created",
		"series",
		series.PublicID,
		clientip.FromContext(ctx),
	)

	return &publiraadminv1.CreateSeriesCampaignPricesResponse{CampaignPrices: campaigns}, nil
}

// campaignPriceListScope is the one episode or series ListEpisodeCampaignPrices
// lists, and the key its tokens are bound to. Exactly one of the two ids is set.
type campaignPriceListScope struct {
	episodeID uuid.NullUUID
	seriesID  uuid.NullUUID
	listKey   pagination.ListKey
}

func parseCampaignPriceListScope(req *publiraadminv1.ListEpisodeCampaignPricesRequest) (campaignPriceListScope, error) {
	listKey := pagination.NewListKey("starts_at_desc")
	switch scope := req.Scope.(type) {
	case *publiraadminv1.ListEpisodeCampaignPricesRequest_EpisodeId:
		id, err := parseRecordID(scope.EpisodeId, "episode_id")
		if err != nil {
			return campaignPriceListScope{}, err
		}
		return campaignPriceListScope{
			episodeID: uuid.NullUUID{UUID: id, Valid: true},
			listKey:   listKey.Value("episode_id", id.String()),
		}, nil
	case *publiraadminv1.ListEpisodeCampaignPricesRequest_SeriesId:
		id, err := parseRecordID(scope.SeriesId, "series_id")
		if err != nil {
			return campaignPriceListScope{}, err
		}
		return campaignPriceListScope{
			seriesID: uuid.NullUUID{UUID: id, Valid: true},
			listKey:  listKey.Value("series_id", id.String()),
		}, nil
	default:
		return campaignPriceListScope{}, connect.NewError(connect.CodeInvalidArgument, "episode_id or series_id is required")
	}
}

// campaignPriceListRow is a row of any of the ListEpisodeCampaignPrices*
// queries, and of GetEpisodeCampaignPriceByIDForTenant, which all select the
// same columns.
type campaignPriceListRow dbmodels.ListEpisodeCampaignPricesByEpisodeForTenantDescRow

func campaignPriceRow(row dbmodels.GetEpisodeCampaignPriceByIDForTenantRow) campaignPriceListRow {
	return campaignPriceListRow(row)
}

func campaignPriceListRows[T any](rows []T, convert func(T) campaignPriceListRow) []campaignPriceListRow {
	mapped := make([]campaignPriceListRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, convert(row))
	}
	return mapped
}

// campaignPricePage runs the keyset query for one page, as freeWindowPage does
// for the free windows.
func (s *adminServer) campaignPricePage(
	ctx context.Context,
	tenantID uuid.UUID,
	scope campaignPriceListScope,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]campaignPriceListRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorStartsAt := sql.NullTime{Time: keys.Time, Valid: keys.Valid}
	backward := direction == pagination.Backward

	if scope.episodeID.Valid {
		if backward {
			rows, err := queries.ListEpisodeCampaignPricesByEpisodeForTenantAsc(ctx, dbmodels.ListEpisodeCampaignPricesByEpisodeForTenantAscParams{
				TenantID:        tenantID,
				EpisodeID:       scope.episodeID.UUID,
				CursorID:        cursorID,
				CursorInclusive: keys.Inclusive,
				CursorStartsAt:  cursorStartsAt,
				Limit:           limit,
			})
			return campaignPriceListRows(rows, func(row dbmodels.ListEpisodeCampaignPricesByEpisodeForTenantAscRow) campaignPriceListRow {
				return campaignPriceListRow(row)
			}), err
		}
		rows, err := queries.ListEpisodeCampaignPricesByEpisodeForTenantDesc(ctx, dbmodels.ListEpisodeCampaignPricesByEpisodeForTenantDescParams{
			TenantID:        tenantID,
			EpisodeID:       scope.episodeID.UUID,
			CursorID:        cursorID,
			CursorInclusive: keys.Inclusive,
			CursorStartsAt:  cursorStartsAt,
			Limit:           limit,
		})
		return campaignPriceListRows(rows, func(row dbmodels.ListEpisodeCampaignPricesByEpisodeForTenantDescRow) campaignPriceListRow {
			return campaignPriceListRow(row)
		}), err
	}

	if backward {
		rows, err := queries.ListEpisodeCampaignPricesBySeriesForTenantAsc(ctx, dbmodels.ListEpisodeCampaignPricesBySeriesForTenantAscParams{
			TenantID:        tenantID,
			SeriesID:        scope.seriesID.UUID,
			CursorID:        cursorID,
			CursorInclusive: keys.Inclusive,
			CursorStartsAt:  cursorStartsAt,
			Limit:           limit,
		})
		return campaignPriceListRows(rows, func(row dbmodels.ListEpisodeCampaignPricesBySeriesForTenantAscRow) campaignPriceListRow {
			return campaignPriceListRow(row)
		}), err
	}
	rows, err := queries.ListEpisodeCampaignPricesBySeriesForTenantDesc(ctx, dbmodels.ListEpisodeCampaignPricesBySeriesForTenantDescParams{
		TenantID:        tenantID,
		SeriesID:        scope.seriesID.UUID,
		CursorID:        cursorID,
		CursorInclusive: keys.Inclusive,
		CursorStartsAt:  cursorStartsAt,
		Limit:           limit,
	})
	return campaignPriceListRows(rows, func(row dbmodels.ListEpisodeCampaignPricesBySeriesForTenantDescRow) campaignPriceListRow {
		return campaignPriceListRow(row)
	}), err
}

func (s *adminServer) ListEpisodeCampaignPrices(
	ctx context.Context,
	req *publiraadminv1.ListEpisodeCampaignPricesRequest,
) (*publiraadminv1.ListEpisodeCampaignPricesResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	scope, err := parseCampaignPriceListScope(req)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultCampaignPriceListLimit, maxCampaignPriceListLimit)
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
	rows, err := s.campaignPricePage(ctx, tenant.ID, scope, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode campaign prices", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	campaigns := make([]*publiraadminv1.AdminEpisodeCampaignPrice, 0, len(rows))
	for _, row := range rows {
		campaigns = append(campaigns, campaignPriceFromRow(row))
	}

	res := &publiraadminv1.ListEpisodeCampaignPricesResponse{CampaignPrices: campaigns}
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
	// An empty page past a boundary row removed since: recover once, as
	// ListEpisodeFreeWindows does.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = scope.listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = scope.listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return res, nil
}

func (s *adminServer) DeleteEpisodeCampaignPrice(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeCampaignPriceRequest,
) (*publiraadminv1.DeleteEpisodeCampaignPriceResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	campaignID, err := parseRecordID(req.CampaignPriceId, "campaign_price_id")
	if err != nil {
		return nil, err
	}

	var deleted dbmodels.DeleteEpisodeCampaignPriceByIDForTenantRow
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.queriesFor(txCtx).DeleteEpisodeCampaignPriceByIDForTenant(txCtx, dbmodels.DeleteEpisodeCampaignPriceByIDForTenantParams{
			TenantID: tenant.ID,
			ID:       campaignID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "campaign price not found")
			}
			return nil, s.internalDBError(ctx, "failed to delete episode campaign price", err, "tenant_id", tenant.ID.String(), "campaign_price_id", campaignID.String())
		}
		deleted = row
		// Only a campaign that has started and that apply-campaign-prices has
		// not ended yet can be quoted by a cached page, for the reason
		// DeleteEpisodeFreeWindow gives for a window.
		if row.StartsAt.After(time.Now()) || row.EndRevalidatedAt.Valid {
			return nil, nil
		}
		return campaignprices.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recordScheduleAudit(
		ctx,
		tenant.ID,
		"episode_campaign_price_deleted",
		"episode_campaign_price",
		deleted.PublicID,
		clientip.FromContext(ctx),
	)

	return &publiraadminv1.DeleteEpisodeCampaignPriceResponse{}, nil
}

func campaignPriceFromRow(row campaignPriceListRow) *publiraadminv1.AdminEpisodeCampaignPrice {
	return &publiraadminv1.AdminEpisodeCampaignPrice{
		Id:              row.ID.String(),
		PublicId:        row.PublicID,
		EpisodeId:       row.EpisodeID.String(),
		EpisodePublicId: row.EpisodePublicID,
		EpisodeTitle:    row.EpisodeTitle,
		SeriesId:        row.SeriesID.String(),
		SeriesPublicId:  row.SeriesPublicID,
		Price:           row.Price,
		StartsAt:        row.StartsAt.UTC().Format(time.RFC3339),
		EndsAt:          row.EndsAt.UTC().Format(time.RFC3339),
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
	}
}
