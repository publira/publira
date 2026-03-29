package protomapper

import (
	"time"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func SeriesFromGetSeriesByPublicIDForTenantRow(row dbmodels.GetSeriesByPublicIDForTenantRow) *publirattypesv1.Series {
	series := &publirattypesv1.Series{
		PublicId: row.PublicID,
		Title:    row.Title,
	}
	if row.Synopsis.Valid {
		series.Synopsis = row.Synopsis.String
	}
	if row.ReadingPeriodHours.Valid {
		series.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	return series
}

func EpisodeFromGetEpisodeByPublicIDForTenantRow(row dbmodels.GetEpisodeByPublicIDForTenantRow) *publirattypesv1.Episode {
	episode := &publirattypesv1.Episode{
		PublicId:   row.PublicID,
		Title:      row.Title,
		OrderIndex: row.OrderIndex,
		Price:      row.Price,
		Status:     row.Status,
	}
	if row.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.ScheduledAt.Valid {
		episode.ScheduledAt = row.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		episode.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return episode
}

func EpisodeFromGetPublishedEpisodeByPublicIDForTenantRow(row dbmodels.GetPublishedEpisodeByPublicIDForTenantRow) *publirattypesv1.Episode {
	episode := &publirattypesv1.Episode{
		PublicId:   row.PublicID,
		Title:      row.Title,
		OrderIndex: row.OrderIndex,
		Price:      row.Price,
		Status:     row.Status,
	}
	if row.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.ScheduledAt.Valid {
		episode.ScheduledAt = row.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		episode.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return episode
}

func EpisodeFromListEpisodesBySeriesForTenantRow(row dbmodels.ListEpisodesBySeriesForTenantRow) *publirattypesv1.Episode {
	episode := &publirattypesv1.Episode{
		PublicId:   row.PublicID,
		Title:      row.Title,
		OrderIndex: row.OrderIndex,
		Price:      row.Price,
		Status:     row.Status,
	}
	if row.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.ScheduledAt.Valid {
		episode.ScheduledAt = row.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		episode.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	return episode
}

func EpisodeImageFromEpisodeImage(row dbmodels.EpisodeImage) *publirattypesv1.EpisodeImage {
	return &publirattypesv1.EpisodeImage{
		Id:            row.ID.String(),
		ImageUrl:      row.ImageUrl,
		ContentType:   row.ContentType,
		FileSizeBytes: row.FileSizeBytes,
		DisplayOrder:  row.DisplayOrder,
		Width:         row.Width,
		Height:        row.Height,
	}
}

func SeriesFromGetPublishedEpisodeByPublicIDForTenantRow(row dbmodels.GetPublishedEpisodeByPublicIDForTenantRow) *publirattypesv1.Series {
	return &publirattypesv1.Series{
		PublicId: row.SeriesPublicID,
		Title:    row.SeriesTitle,
	}
}

func Creator(publicID, name, profileText string) *publirattypesv1.Creator {
	return &publirattypesv1.Creator{
		PublicId:    publicID,
		Name:        name,
		ProfileText: profileText,
	}
}

func Label(publicID, name string) *publirattypesv1.Label {
	return &publirattypesv1.Label{
		PublicId: publicID,
		Name:     name,
	}
}
