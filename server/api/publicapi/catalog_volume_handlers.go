package publicapi

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// seriesVolumes answers the series' volumes on sale on surface as
// GetSeriesDetail lists them beside episodes, the series' episodes as that
// read lists them for the surface. Each volume names only the episodes among
// those, so a client never meets an id the same answer does not explain, and a
// volume naming none of them is left out: it would sell nothing the surface
// shows.
func (s *apiServer) seriesVolumes(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	surface string,
	episodes []*publirattypesv1.Episode,
) ([]*publirattypesv1.Volume, error) {
	queries := s.queriesFor(ctx)
	rows, err := queries.ListPublishedVolumesForSeries(ctx, dbmodels.ListPublishedVolumesForSeriesParams{
		TenantID: tenantID,
		SeriesID: seriesID,
		Surface:  surface,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the series' volumes", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	if len(rows) == 0 {
		return []*publirattypesv1.Volume{}, nil
	}

	volumeIDs := make([]uuid.UUID, 0, len(rows))
	coverIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		volumeIDs = append(volumeIDs, row.ID)
		if row.CoverImageID.Valid {
			coverIDs = append(coverIDs, row.CoverImageID.UUID)
		}
	}
	episodeRows, err := queries.ListVolumeEpisodesByVolumeIDs(ctx, dbmodels.ListVolumeEpisodesByVolumeIDsParams{
		TenantID:  tenantID,
		VolumeIds: volumeIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the episodes of the series' volumes", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	covers := map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}
	if len(coverIDs) > 0 {
		coverRows, err := queries.ListVolumeCoverImageVariantsByImageIDs(ctx, dbmodels.ListVolumeCoverImageVariantsByImageIDsParams{
			TenantID: tenantID,
			ImageIds: coverIDs,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the covers of the series' volumes", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
		covers = protomapper.VolumeCoverVariants(coverRows)
	}

	listed := make(map[string]struct{}, len(episodes))
	for _, episode := range episodes {
		listed[episode.GetId()] = struct{}{}
	}
	episodesByVolume := protomapper.VolumeEpisodeIDs(episodeRows)
	volumes := make([]*publirattypesv1.Volume, 0, len(rows))
	for _, row := range rows {
		episodeIDs := make([]string, 0, len(episodesByVolume[row.ID]))
		for _, episodeID := range episodesByVolume[row.ID] {
			if _, ok := listed[episodeID.String()]; ok {
				episodeIDs = append(episodeIDs, episodeID.String())
			}
		}
		if len(episodeIDs) == 0 {
			continue
		}
		volume := &publirattypesv1.Volume{
			Id:         row.ID.String(),
			PublicId:   row.PublicID,
			Title:      row.Title,
			OrderIndex: row.OrderIndex,
			Price:      row.Price,
			EpisodeIds: episodeIDs,
		}
		if row.CoverImageID.Valid && row.CoverImageUpdatedAt.Valid {
			volume.CoverImageUpdatedAt = row.CoverImageUpdatedAt.Time.UTC().Format(time.RFC3339)
			volume.CoverImageVariants = covers[row.CoverImageID.UUID]
		}
		volumes = append(volumes, volume)
	}
	return volumes, nil
}
