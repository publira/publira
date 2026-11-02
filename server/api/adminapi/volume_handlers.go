package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// A volume's writes that also touch the series lock the series row first and
// the volume row after it, so two writes never wait on each other's second
// lock: an assignment moves episodes the whole series shares, and the series
// row is what serializes those.

const (
	// maxVolumesPerSeries is how many volumes one series may hold. The console
	// orders all of them on one screen, which is why no list of them is paged,
	// and a reorder request carries the whole list.
	maxVolumesPerSeries = 100

	// maxVolumeTitleRunes is what volumes_title_check holds the column to.
	maxVolumeTitleRunes = 255

	// maxVolumeBookstoreLinks is how many bookstore links one volume carries:
	// enough for every store a printed book is commonly sold at, and few
	// enough that the series page shows them as buttons beside the volume.
	maxVolumeBookstoreLinks = 10

	// maxBookstoreLinkLabelRunes and maxBookstoreLinkURLRunes are what
	// volume_bookstore_links_label_check and volume_bookstore_links_url_check
	// hold the columns to.
	maxBookstoreLinkLabelRunes = 50
	maxBookstoreLinkURLRunes   = 2048
)

// normalizeVolumeTitle reads a volume's title, which is required and bounded
// as the column is.
func normalizeVolumeTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("title is required"), "title")
	}
	if utf8.RuneCountInString(title) > maxVolumeTitleRunes {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("title must be at most %d characters", maxVolumeTitleRunes), "title")
	}
	return title, nil
}

// requireVolumePrice refuses a price a volume cannot carry: a volume is never
// free, since an episode that should cost nothing is made free itself.
func requireVolumePrice(price int32) error {
	if price <= 0 {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("price must be greater than 0"), "price")
	}
	return nil
}

// volumeRow is a volume as every admin volume RPC answers with it, whichever
// query read it.
type volumeRow struct {
	id                  uuid.UUID
	publicID            string
	seriesID            uuid.UUID
	title               string
	orderIndex          int32
	price               int32
	coverImageID        uuid.NullUUID
	coverImageUpdatedAt sql.NullTime
	published           bool
	publishedAt         sql.NullTime
	createdAt           time.Time
	updatedAt           time.Time
}

func volumeRowFromGet(row dbmodels.GetVolumeByIDForTenantRow) volumeRow {
	return volumeRow{
		id:                  row.ID,
		publicID:            row.PublicID,
		seriesID:            row.SeriesID,
		title:               row.Title,
		orderIndex:          row.OrderIndex,
		price:               row.Price,
		coverImageID:        row.CoverImageID,
		coverImageUpdatedAt: row.CoverImageUpdatedAt,
		published:           row.IsPublished,
		publishedAt:         row.PublishedAt,
		createdAt:           row.CreatedAt,
		updatedAt:           row.UpdatedAt,
	}
}

func volumeRowFromList(row dbmodels.ListVolumesForSeriesRow) volumeRow {
	return volumeRow{
		id:                  row.ID,
		publicID:            row.PublicID,
		seriesID:            row.SeriesID,
		title:               row.Title,
		orderIndex:          row.OrderIndex,
		price:               row.Price,
		coverImageID:        row.CoverImageID,
		coverImageUpdatedAt: row.CoverImageUpdatedAt,
		published:           row.IsPublished,
		publishedAt:         row.PublishedAt,
		createdAt:           row.CreatedAt,
		updatedAt:           row.UpdatedAt,
	}
}

// volumeMessages builds the answer for a list of volumes, reading the
// episodes of all of them in one query, their bookstore links in another, and
// their covers in a third.
func (s *adminServer) volumeMessages(ctx context.Context, tenantID uuid.UUID, rows []volumeRow) ([]*publiraadminv1.AdminVolume, error) {
	volumes := make([]*publiraadminv1.AdminVolume, 0, len(rows))
	if len(rows) == 0 {
		return volumes, nil
	}
	volumeIDs := make([]uuid.UUID, 0, len(rows))
	coverIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		volumeIDs = append(volumeIDs, row.id)
		if row.coverImageID.Valid {
			coverIDs = append(coverIDs, row.coverImageID.UUID)
		}
	}
	queries := s.queriesFor(ctx)
	episodeRows, err := queries.ListVolumeEpisodesByVolumeIDs(ctx, dbmodels.ListVolumeEpisodesByVolumeIDsParams{
		TenantID:  tenantID,
		VolumeIds: volumeIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list volume episodes", err, "tenant_id", tenantID.String())
	}
	linkRows, err := queries.ListVolumeBookstoreLinksByVolumeIDs(ctx, dbmodels.ListVolumeBookstoreLinksByVolumeIDsParams{
		TenantID:  tenantID,
		VolumeIds: volumeIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list volume bookstore links", err, "tenant_id", tenantID.String())
	}
	covers, err := s.ownerImageVariants(ctx, volumeCoverImages, tenantID, coverIDs)
	if err != nil {
		return nil, err
	}
	episodesByVolume := protomapper.VolumeEpisodeIDs(episodeRows)
	linksByVolume := protomapper.VolumeBookstoreLinks(linkRows)
	for _, row := range rows {
		episodeIDs := make([]string, 0, len(episodesByVolume[row.id]))
		for _, episodeID := range episodesByVolume[row.id] {
			episodeIDs = append(episodeIDs, episodeID.String())
		}
		volume := &publiraadminv1.AdminVolume{
			Id:             row.id.String(),
			PublicId:       row.publicID,
			SeriesId:       row.seriesID.String(),
			Title:          row.title,
			OrderIndex:     row.orderIndex,
			Price:          row.price,
			EpisodeIds:     episodeIDs,
			Published:      row.published,
			CreatedAt:      row.createdAt.UTC().Format(time.RFC3339),
			UpdatedAt:      row.updatedAt.UTC().Format(time.RFC3339),
			BookstoreLinks: linksByVolume[row.id],
		}
		if row.publishedAt.Valid {
			volume.PublishedAt = row.publishedAt.Time.UTC().Format(time.RFC3339)
		}
		if row.coverImageID.Valid && row.coverImageUpdatedAt.Valid {
			volume.CoverImageUpdatedAt = row.coverImageUpdatedAt.Time.UTC().Format(time.RFC3339)
			volume.CoverImageVariants = covers[row.coverImageID.UUID]
		}
		volumes = append(volumes, volume)
	}
	return volumes, nil
}

// volumeByID reads the volume a request names.
func (s *adminServer) volumeByID(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetVolumeByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetVolumeByIDForTenant(ctx, dbmodels.GetVolumeByIDForTenantParams{TenantID: tenantID, ID: id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetVolumeByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "volume not found")
		}
		return dbmodels.GetVolumeByIDForTenantRow{}, s.internalDBError(ctx, "failed to get volume", err, "tenant_id", tenantID.String(), "volume_id", id.String())
	}
	return row, nil
}

// lockVolume locks the volume row and then reads the volume as a separate
// statement, so two writes on one volume serialize and the second sees what
// the first committed.
func (s *adminServer) lockVolume(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetVolumeByIDForTenantRow, error) {
	if _, err := s.queriesFor(ctx).LockVolumeByIDForTenant(ctx, dbmodels.LockVolumeByIDForTenantParams{TenantID: tenantID, ID: id}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetVolumeByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "volume not found")
		}
		return dbmodels.GetVolumeByIDForTenantRow{}, s.internalDBError(ctx, "failed to lock volume", err, "tenant_id", tenantID.String(), "volume_id", id.String())
	}
	return s.volumeByID(ctx, tenantID, id)
}

// lockSeriesForVolumes locks the series row the writes that move a series'
// volumes or episodes serialize on, answering not_found for a series of
// another tenant or none at all.
func (s *adminServer) lockSeriesForVolumes(ctx context.Context, tenantID, seriesID uuid.UUID) (dbmodels.LockSeriesByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{TenantID: tenantID, ID: seriesID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.LockSeriesByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "series not found")
		}
		return dbmodels.LockSeriesByIDForTenantRow{}, s.internalDBError(ctx, "failed to lock series for its volumes", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	return row, nil
}

// volumeMessageByID re-reads a volume after a write, so the answer carries
// what the write committed and the cover delivery now serves.
func (s *adminServer) volumeMessageByID(ctx context.Context, tenantID, id uuid.UUID) (*publiraadminv1.AdminVolume, error) {
	row, err := s.volumeByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	volumes, err := s.volumeMessages(ctx, tenantID, []volumeRow{volumeRowFromGet(row)})
	if err != nil {
		return nil, err
	}
	return volumes[0], nil
}

func (s *adminServer) volumesOfSeries(ctx context.Context, tenantID, seriesID uuid.UUID) ([]*publiraadminv1.AdminVolume, error) {
	rows, err := s.queriesFor(ctx).ListVolumesForSeries(ctx, dbmodels.ListVolumesForSeriesParams{TenantID: tenantID, SeriesID: seriesID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list volumes", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	mapped := make([]volumeRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, volumeRowFromList(row))
	}
	return s.volumeMessages(ctx, tenantID, mapped)
}

// volumeRevalidateTags is what a write on a volume owes the site caches. The
// series pages carry the volumes on sale, so a write on a volume that was not
// on sale before it and is not after it is in no cached answer and owes
// nothing.
func volumeRevalidateTags(tenantID uuid.UUID, wasPublished, isPublished bool) []string {
	if !wasPublished && !isPublished {
		return nil
	}
	return publishepisodes.RevalidateTags(tenantID)
}

// recordVolumeChange files the audit entry for one volume write. A volume is
// something readers pay for, so every write is recorded, not only the ones
// that put it on sale.
func (s *adminServer) recordVolumeChange(ctx context.Context, tenantID uuid.UUID, action, targetType, targetID string) {
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
		ClientIP:    clientip.FromContext(ctx),
	})
}

func (s *adminServer) ListVolumes(
	ctx context.Context,
	req *publiraadminv1.ListVolumesRequest,
) (*publiraadminv1.ListVolumesResponse, error) {
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
	volumes, err := s.volumesOfSeries(ctx, tenant.ID, seriesID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ListVolumesResponse{Volumes: volumes}, nil
}

func (s *adminServer) CreateVolume(
	ctx context.Context,
	req *publiraadminv1.CreateVolumeRequest,
) (*publiraadminv1.CreateVolumeResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
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
	title, err := normalizeVolumeTitle(req.Title)
	if err != nil {
		return nil, err
	}
	if err := requireVolumePrice(req.Price); err != nil {
		return nil, err
	}
	volumeID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create volume transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	if err := s.checkPriceCurrency(txCtx, queries, tenant.ID, req.Price, req.Currency); err != nil {
		return nil, err
	}
	// The series lock keeps two creates from both counting one short of the
	// cap, or both taking the same next position.
	if _, err := s.lockSeriesForVolumes(txCtx, tenant.ID, seriesID); err != nil {
		return nil, err
	}
	count, err := queries.CountVolumesForSeries(txCtx, dbmodels.CountVolumesForSeriesParams{TenantID: tenant.ID, SeriesID: seriesID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count volumes", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if count >= maxVolumesPerSeries {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Sprintf("a series holds at most %d volumes", maxVolumesPerSeries))
	}
	maxOrderIndex, err := queries.GetMaxVolumeOrderIndexForSeries(txCtx, dbmodels.GetMaxVolumeOrderIndexForSeriesParams{TenantID: tenant.ID, SeriesID: seriesID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve the next volume position", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	created, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.CreateVolumeRow, error) {
		return queries.CreateVolume(txCtx, dbmodels.CreateVolumeParams{
			ID:         volumeID,
			TenantID:   tenant.ID,
			PublicID:   publicID,
			SeriesID:   seriesID,
			Title:      title,
			OrderIndex: maxOrderIndex + 1,
			Price:      req.Price,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create volume", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create volume", err, "tenant_id", tenant.ID.String())
	}

	s.recordVolumeChange(ctx, tenant.ID, "volume_created", "volume", created.PublicID)

	volume, err := s.volumeMessageByID(ctx, tenant.ID, created.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.CreateVolumeResponse{Volume: volume}, nil
}

func (s *adminServer) UpdateVolume(
	ctx context.Context,
	req *publiraadminv1.UpdateVolumeRequest,
) (*publiraadminv1.UpdateVolumeResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}
	title, err := normalizeVolumeTitle(req.Title)
	if err != nil {
		return nil, err
	}
	if err := requireVolumePrice(req.Price); err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		if err := s.checkPriceCurrency(txCtx, queries, tenant.ID, req.Price, req.Currency); err != nil {
			return nil, err
		}
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if err := queries.UpdateVolume(txCtx, dbmodels.UpdateVolumeParams{
			TenantID: tenant.ID,
			ID:       current.ID,
			Title:    title,
			Price:    req.Price,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update volume", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		return volumeRevalidateTags(tenant.ID, current.IsPublished, current.IsPublished), nil
	}); err != nil {
		return nil, err
	}

	s.recordVolumeChange(ctx, tenant.ID, "volume_updated", "volume", publicID)

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdateVolumeResponse{Volume: volume}, nil
}

func (s *adminServer) PublishVolume(
	ctx context.Context,
	req *publiraadminv1.PublishVolumeRequest,
) (*publiraadminv1.PublishVolumeResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}

	var (
		publicID string
		changed  bool
	)
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// The volume lock also holds off SetVolumeEpisodes, so a volume cannot
		// be emptied between the check below and the write.
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if req.Published {
			episodes, err := queries.ListVolumeEpisodesByVolumeIDs(txCtx, dbmodels.ListVolumeEpisodesByVolumeIDsParams{
				TenantID:  tenant.ID,
				VolumeIds: []uuid.UUID{current.ID},
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to list volume episodes", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
			}
			if len(episodes) == 0 {
				return nil, connect.NewError(connect.CodeFailedPrecondition, "a volume with no episodes cannot be put on sale")
			}
		}
		changed = current.IsPublished != req.Published
		if err := queries.SetVolumePublished(txCtx, dbmodels.SetVolumePublishedParams{
			TenantID:    tenant.ID,
			ID:          current.ID,
			IsPublished: req.Published,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to publish volume", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		if !changed {
			return nil, nil
		}
		return volumeRevalidateTags(tenant.ID, current.IsPublished, req.Published), nil
	}); err != nil {
		return nil, err
	}

	if changed {
		action := "volume_unpublished"
		if req.Published {
			action = "volume_published"
		}
		s.recordVolumeChange(ctx, tenant.ID, action, "volume", publicID)
	}

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.PublishVolumeResponse{Volume: volume}, nil
}

// volumeEpisodeIDs reads the episodes an assignment names: each a valid id,
// and none named twice, since an episode stands at one place in a volume.
func volumeEpisodeIDs(raw []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(raw))
	seen := make(map[uuid.UUID]struct{}, len(raw))
	for _, value := range raw {
		id, err := parseRecordID(value, "episode_ids")
		if err != nil {
			return nil, err
		}
		if _, ok := seen[id]; ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("episode %s is named more than once", id), "episode_ids")
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *adminServer) SetVolumeEpisodes(
	ctx context.Context,
	req *publiraadminv1.SetVolumeEpisodesRequest,
) (*publiraadminv1.SetVolumeEpisodesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}
	episodeIDs, err := volumeEpisodeIDs(req.EpisodeIds)
	if err != nil {
		return nil, err
	}
	// The series is read before anything is locked, so the series row can be
	// locked ahead of the volume's; a volume never changes series.
	unlocked, err := s.volumeByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		if _, err := s.lockSeriesForVolumes(txCtx, tenant.ID, unlocked.SeriesID); err != nil {
			return nil, err
		}
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID

		if len(episodeIDs) > 0 {
			inSeries, err := queries.CountSeriesEpisodesByIDs(txCtx, dbmodels.CountSeriesEpisodesByIDsParams{
				TenantID:   tenant.ID,
				SeriesID:   current.SeriesID,
				EpisodeIds: episodeIDs,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to check the episodes of a volume", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
			}
			if int(inSeries) != len(episodeIDs) {
				return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("every episode must be an episode of the volume's series"), "episode_ids")
			}
			elsewhere, err := queries.CountEpisodesInOtherVolumes(txCtx, dbmodels.CountEpisodesInOtherVolumesParams{
				TenantID:   tenant.ID,
				VolumeID:   current.ID,
				EpisodeIds: episodeIDs,
			})
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to check the volumes of episodes", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
			}
			if elsewhere > 0 {
				return nil, connect.NewError(connect.CodeFailedPrecondition, "an episode is already in another volume")
			}
		}

		held, err := queries.ListVolumeEpisodesByVolumeIDs(txCtx, dbmodels.ListVolumeEpisodesByVolumeIDsParams{
			TenantID:  tenant.ID,
			VolumeIds: []uuid.UUID{current.ID},
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list volume episodes", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		takesOut := slices.ContainsFunc(held, func(row dbmodels.ListVolumeEpisodesByVolumeIDsRow) bool {
			return !slices.Contains(episodeIDs, row.EpisodeID)
		})
		// A purchase of the volume opens what the volume holds, so an episode
		// taken out of it is taken from every buyer. Once the volume has been on
		// sale, a checkout started then can still complete after it is taken
		// off, so the episodes it held stay in it for good. A checkout reads
		// is_published without this lock, which is why the rule is the first
		// publication rather than the current one: published_at is set before
		// any checkout of the volume can start, and never cleared.
		if takesOut && current.PublishedAt.Valid {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "an episode cannot be taken out of a volume that has been on sale")
		}

		if err := queries.DeleteVolumeEpisodes(txCtx, dbmodels.DeleteVolumeEpisodesParams{
			TenantID: tenant.ID,
			VolumeID: current.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to clear volume episodes", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		if len(episodeIDs) > 0 {
			if err := queries.InsertVolumeEpisodes(txCtx, dbmodels.InsertVolumeEpisodesParams{
				TenantID:   tenant.ID,
				VolumeID:   current.ID,
				EpisodeIds: episodeIDs,
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to write volume episodes", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
			}
		}
		return volumeRevalidateTags(tenant.ID, current.IsPublished, current.IsPublished), nil
	}); err != nil {
		return nil, err
	}

	s.recordVolumeChange(ctx, tenant.ID, "volume_updated", "volume", publicID)

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.SetVolumeEpisodesResponse{Volume: volume}, nil
}

// volumeBookstoreLinks reads the links a SetVolumeBookstoreLinks request
// names, each held to what its column is, into the labels and the URLs the
// insert takes pairwise. A violation names the link by its place in the list,
// so the console can point at the field that is wrong.
func volumeBookstoreLinks(links []*publirattypesv1.BookstoreLink) (labels, urls []string, err error) {
	if len(links) > maxVolumeBookstoreLinks {
		return nil, nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("a volume carries at most %d bookstore links", maxVolumeBookstoreLinks), "bookstore_links")
	}
	labels = make([]string, 0, len(links))
	urls = make([]string, 0, len(links))
	for index, link := range links {
		label := strings.TrimSpace(link.GetLabel())
		labelField := fmt.Sprintf("bookstore_links[%d].label", index)
		if label == "" {
			return nil, nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("label is required"), labelField)
		}
		if utf8.RuneCountInString(label) > maxBookstoreLinkLabelRunes {
			return nil, nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("label must be at most %d characters", maxBookstoreLinkLabelRunes), labelField)
		}
		raw := strings.TrimSpace(link.GetUrl())
		urlField := fmt.Sprintf("bookstore_links[%d].url", index)
		if utf8.RuneCountInString(raw) > maxBookstoreLinkURLRunes {
			return nil, nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("url must be at most %d characters", maxBookstoreLinkURLRunes), urlField)
		}
		// The prefix is checked as written, since the column's CHECK is: a
		// parser would also accept HTTPS:// in capitals.
		parsed, err := url.Parse(raw)
		if err != nil || !strings.HasPrefix(raw, "https://") || parsed.Hostname() == "" || parsed.User != nil {
			return nil, nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("url must be an absolute https URL"), urlField)
		}
		labels = append(labels, label)
		urls = append(urls, raw)
	}
	return labels, urls, nil
}

func (s *adminServer) SetVolumeBookstoreLinks(
	ctx context.Context,
	req *publiraadminv1.SetVolumeBookstoreLinksRequest,
) (*publiraadminv1.SetVolumeBookstoreLinksResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}
	labels, urls, err := volumeBookstoreLinks(req.BookstoreLinks)
	if err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if err := queries.DeleteVolumeBookstoreLinks(txCtx, dbmodels.DeleteVolumeBookstoreLinksParams{
			TenantID: tenant.ID,
			VolumeID: current.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to clear volume bookstore links", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		if len(labels) > 0 {
			if err := queries.InsertVolumeBookstoreLinks(txCtx, dbmodels.InsertVolumeBookstoreLinksParams{
				TenantID: tenant.ID,
				VolumeID: current.ID,
				Labels:   labels,
				Urls:     urls,
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to write volume bookstore links", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
			}
		}
		return volumeRevalidateTags(tenant.ID, current.IsPublished, current.IsPublished), nil
	}); err != nil {
		return nil, err
	}

	s.recordVolumeChange(ctx, tenant.ID, "volume_bookstore_links_updated", "volume", publicID)

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.SetVolumeBookstoreLinksResponse{Volume: volume}, nil
}

func (s *adminServer) ReorderVolumes(
	ctx context.Context,
	req *publiraadminv1.ReorderVolumesRequest,
) (*publiraadminv1.ReorderVolumesResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
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
	order, expected, err := reorderIDs(
		reorderList{req.VolumeIds, "volume_ids"},
		reorderList{req.ExpectedVolumeIds, "expected_volume_ids"},
		"volume",
	)
	if err != nil {
		return nil, err
	}

	var seriesPublicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		series, err := s.lockSeriesForVolumes(txCtx, tenant.ID, seriesID)
		if err != nil {
			return nil, err
		}
		seriesPublicID = series.PublicID
		// Locking every volume of the series is what makes the comparison
		// below mean something: no concurrent write can move one between the
		// check and the write.
		locked, err := queries.LockVolumesForSeries(txCtx, dbmodels.LockVolumesForSeriesParams{TenantID: tenant.ID, SeriesID: seriesID})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to lock volumes for reorder", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
		}
		currentOrder := make([]string, 0, len(locked))
		for _, id := range locked {
			currentOrder = append(currentOrder, id.String())
		}
		if !slices.Equal(currentOrder, expected) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "volume order has changed")
		}
		for index, key := range order {
			if err := queries.UpdateVolumeOrderIndex(txCtx, dbmodels.UpdateVolumeOrderIndexParams{
				TenantID:   tenant.ID,
				ID:         uuid.MustParse(key),
				OrderIndex: int32(index),
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to update volume order", err, "tenant_id", tenant.ID.String(), "volume_id", key)
			}
		}
		// The order is what the series page lists its volumes in, so the drop
		// is owed whichever of them are on sale.
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recordVolumeChange(ctx, tenant.ID, "volumes_reordered", "series", seriesPublicID)

	volumes, err := s.volumesOfSeries(ctx, tenant.ID, seriesID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ReorderVolumesResponse{Volumes: volumes}, nil
}

func (s *adminServer) UploadVolumeCoverImage(
	ctx context.Context,
	req *publiraadminv1.UploadVolumeCoverImageRequest,
) (*publiraadminv1.UploadVolumeCoverImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.ImageData, req.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}
	// Cut before the transaction, so a refused image costs no database work
	// and the cut does not run while the volume row is held.
	variants, err := imageproc.BuildEyeCatchVariants(image.Data, image.ContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		imageID, err := s.storeOwnerImage(txCtx, volumeCoverImages, ownerImageRef(tenant, current.ID, current.PublicID), variants)
		if err != nil {
			return nil, err
		}
		if err := s.queriesFor(txCtx).SetVolumeCoverImageID(txCtx, dbmodels.SetVolumeCoverImageIDParams{
			TenantID:     tenant.ID,
			ID:           current.ID,
			CoverImageID: uuid.NullUUID{UUID: imageID, Valid: true},
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to point the volume at its cover", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		return volumeRevalidateTags(tenant.ID, current.IsPublished, current.IsPublished), nil
	}); err != nil {
		return nil, err
	}

	s.recordVolumeChange(ctx, tenant.ID, "volume_updated", "volume", publicID)

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadVolumeCoverImageResponse{Volume: volume}, nil
}

func (s *adminServer) DeleteVolumeCoverImage(
	ctx context.Context,
	req *publiraadminv1.DeleteVolumeCoverImageRequest,
) (*publiraadminv1.DeleteVolumeCoverImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.VolumeId, "volume_id")
	if err != nil {
		return nil, err
	}

	var (
		publicID string
		removed  bool
	)
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockVolume(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if !current.CoverImageID.Valid {
			return nil, nil
		}
		// The cover's rows and objects are left for the orphan image sweep,
		// which reclaims a cover no volume points at.
		if err := s.queriesFor(txCtx).SetVolumeCoverImageID(txCtx, dbmodels.SetVolumeCoverImageIDParams{
			TenantID: tenant.ID,
			ID:       current.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to clear the volume's cover", err, "tenant_id", tenant.ID.String(), "volume_id", current.ID.String())
		}
		removed = true
		return volumeRevalidateTags(tenant.ID, current.IsPublished, current.IsPublished), nil
	}); err != nil {
		return nil, err
	}
	if removed {
		s.recordVolumeChange(ctx, tenant.ID, "volume_updated", "volume", publicID)
	}

	volume, err := s.volumeMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteVolumeCoverImageResponse{Volume: volume}, nil
}
