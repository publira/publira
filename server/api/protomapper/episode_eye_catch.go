package protomapper

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// EpisodeEyeCatchCollection is the image server route an episode's own
// eye-catch is delivered under. It is not `episodes`: that route serves the
// pages of the body, behind the access check a page needs and an eye-catch
// does not.
const EpisodeEyeCatchCollection = "episode-eye-catches"

// EpisodeIDs reads the ids of the episodes a response is about to carry, the
// argument ListEpisodeEyeCatchVariantsByEpisodeIDs takes.
func EpisodeIDs(episodes []*publirattypesv1.Episode) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(episodes))
	for _, episode := range episodes {
		id, err := uuid.Parse(episode.GetId())
		if err != nil {
			return nil, fmt.Errorf("episode %q has no valid id: %w", episode.GetPublicId(), err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// SetEpisodeEyeCatches puts each episode's own eye-catch onto it from the rows
// ListEpisodeEyeCatchVariantsByEpisodeIDs read for them. An episode no row
// names keeps both fields empty, which is how a response says it has none.
func SetEpisodeEyeCatches(origin ImageOrigin, episodes []*publirattypesv1.Episode, rows []dbmodels.ListEpisodeEyeCatchVariantsByEpisodeIDsRow) {
	byID := make(map[string]*publirattypesv1.Episode, len(episodes))
	for _, episode := range episodes {
		byID[episode.GetId()] = episode
	}
	for _, row := range rows {
		episode, ok := byID[row.EpisodeID.String()]
		if !ok {
			continue
		}
		episode.EyeCatchImageUpdatedAt = row.ImageUpdatedAt.UTC().Format(time.RFC3339)
		episode.EyeCatchImageVariants = append(episode.EyeCatchImageVariants, &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           EyeCatchVariantURL(origin, EpisodeEyeCatchCollection, row.EpisodeEyeCatchImageID, row.VariantType, row.Width, row.ID),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
}
