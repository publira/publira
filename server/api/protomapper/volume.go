package protomapper

import (
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// VolumeCoverCollection is the image server route a volume's cover is
// delivered under, and the directory its objects are filed in.
const VolumeCoverCollection = "volume-covers"

// VolumeCoverVariants groups the rows ListVolumeCoverImageVariantsByImageIDs
// read by the cover each belongs to, in the shape a series eye-catch is
// answered in.
func VolumeCoverVariants(origin ImageOrigin, rows []dbmodels.ListVolumeCoverImageVariantsByImageIDsRow) map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant {
	variants := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant)
	for _, row := range rows {
		variants[row.VolumeCoverImageID] = append(variants[row.VolumeCoverImageID], &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           EyeCatchVariantURL(origin, VolumeCoverCollection, row.VolumeCoverImageID, row.VariantType, row.Width, row.ID),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return variants
}

// VolumeEpisodeIDs groups the rows ListVolumeEpisodesByVolumeIDs read by
// volume, each volume's episodes in its own order.
func VolumeEpisodeIDs(rows []dbmodels.ListVolumeEpisodesByVolumeIDsRow) map[uuid.UUID][]uuid.UUID {
	episodes := make(map[uuid.UUID][]uuid.UUID)
	for _, row := range rows {
		episodes[row.VolumeID] = append(episodes[row.VolumeID], row.EpisodeID)
	}
	return episodes
}
