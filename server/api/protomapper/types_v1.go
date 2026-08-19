package protomapper

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func SeriesFromGetSeriesByPublicIDForTenantRow(row dbmodels.GetSeriesByPublicIDForTenantRow) *publirattypesv1.Series {
	series := &publirattypesv1.Series{
		PublicId:    row.PublicID,
		Title:       row.Title,
		IsPublished: row.IsPublished,
	}
	if row.LabelPublicID.Valid {
		series.Label = Label(row.LabelPublicID.String, row.LabelName.String)
	}
	if row.Synopsis.Valid {
		series.Synopsis = row.Synopsis.String
	}
	if row.ReadingPeriodHours.Valid {
		series.ReadingPeriodHours = row.ReadingPeriodHours.Int32
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		series.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if row.PublishedAt.Valid {
		series.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
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

func EpisodeFromGetEpisodeByPublicIDForTenantAndSeriesRow(row dbmodels.GetEpisodeByPublicIDForTenantAndSeriesRow) *publirattypesv1.Episode {
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

func EpisodeImageFromEpisodeImage(row dbmodels.ListEpisodeImagesByEpisodeIDRow) *publirattypesv1.EpisodeImage {
	return &publirattypesv1.EpisodeImage{
		Id:            row.ID.String(),
		ImageUrl:      fmt.Sprintf("/images/episodes/%s", row.ID.String()),
		ContentType:   row.ContentType,
		FileSizeBytes: row.FileSizeBytes,
		DisplayOrder:  row.DisplayOrder,
		Width:         row.Width,
		Height:        row.Height,
	}
}

func EpisodeImageFromImageAndVariant(image dbmodels.EpisodeImage, variant dbmodels.EpisodeImageVariant) *publirattypesv1.EpisodeImage {
	return &publirattypesv1.EpisodeImage{
		Id:            image.ID.String(),
		ImageUrl:      fmt.Sprintf("/images/episodes/%s", image.ID.String()),
		ContentType:   variant.ContentType,
		FileSizeBytes: variant.FileSizeBytes,
		DisplayOrder:  image.DisplayOrder,
		Width:         variant.Width,
		Height:        variant.Height,
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

func CreatorFromRow(
	publicID string,
	name string,
	profileText string,
	iconImageID uuid.NullUUID,
	iconImageFileSizeBytes int64,
	iconImageUpdatedAt sql.NullTime,
) *publirattypesv1.Creator {
	creator := &publirattypesv1.Creator{
		PublicId:    publicID,
		Name:        name,
		ProfileText: profileText,
	}
	if iconImageID.Valid {
		creator.IconImageFileSizeBytes = iconImageFileSizeBytes
	}
	if iconImageUpdatedAt.Valid {
		creator.IconImageUpdatedAt = iconImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if iconImageID.Valid {
		creator.IconImageUrl = fmt.Sprintf("/images/creators/%s", iconImageID.UUID.String())
	}
	return creator
}

func Label(publicID, name string) *publirattypesv1.Label {
	return &publirattypesv1.Label{
		PublicId: publicID,
		Name:     name,
	}
}

func LabelWithImage(
	publicID string,
	name string,
	eyeCatchImageUpdatedAt sql.NullTime,
	eyeCatchImageVariants []*publirattypesv1.SeriesEyeCatchVariant,
) *publirattypesv1.Label {
	label := Label(publicID, name)
	if eyeCatchImageUpdatedAt.Valid {
		label.EyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if len(eyeCatchImageVariants) > 0 {
		label.EyeCatchImageVariants = eyeCatchImageVariants
	}
	return label
}

func TenantThemeFromGetRow(row dbmodels.GetTenantThemeByTenantIDRow) *publirattypesv1.TenantTheme {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:               row.PrimaryColor,
		SecondaryColor:             row.SecondaryColor,
		AccentColor:                row.AccentColor,
		BackgroundColor:            row.BackgroundColor,
		ForegroundColor:            row.ForegroundColor,
		SurfaceColor:               row.SurfaceColor,
		SurfaceForegroundColor:     row.SurfaceForegroundColor,
		CardColor:                  row.CardColor,
		CardForegroundColor:        row.CardForegroundColor,
		PopoverColor:               row.PopoverColor,
		PopoverForegroundColor:     row.PopoverForegroundColor,
		PrimaryForegroundColor:     row.PrimaryForegroundColor,
		SecondaryForegroundColor:   row.SecondaryForegroundColor,
		AccentForegroundColor:      row.AccentForegroundColor,
		MutedColor:                 row.MutedColor,
		MutedForegroundColor:       row.MutedForegroundColor,
		BorderColor:                row.BorderColor,
		InputColor:                 row.InputColor,
		RingColor:                  row.RingColor,
		SuccessColor:               row.SuccessColor,
		SuccessForegroundColor:     row.SuccessForegroundColor,
		WarningColor:               row.WarningColor,
		WarningForegroundColor:     row.WarningForegroundColor,
		DestructiveColor:           row.DestructiveColor,
		DestructiveForegroundColor: row.DestructiveForegroundColor,
		InfoColor:                  row.InfoColor,
		InfoForegroundColor:        row.InfoForegroundColor,
	}
	if row.LogoUrl.Valid {
		theme.LogoUrl = row.LogoUrl.String
	}
	theme.FaviconUrl = tenantFaviconURL(row.FaviconImageID)
	return theme
}

func TenantThemeFromModel(model dbmodels.TenantTheme) *publirattypesv1.TenantTheme {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:               model.PrimaryColor,
		SecondaryColor:             model.SecondaryColor,
		AccentColor:                model.AccentColor,
		BackgroundColor:            model.BackgroundColor,
		ForegroundColor:            model.ForegroundColor,
		SurfaceColor:               model.SurfaceColor,
		SurfaceForegroundColor:     model.SurfaceForegroundColor,
		CardColor:                  model.CardColor,
		CardForegroundColor:        model.CardForegroundColor,
		PopoverColor:               model.PopoverColor,
		PopoverForegroundColor:     model.PopoverForegroundColor,
		PrimaryForegroundColor:     model.PrimaryForegroundColor,
		SecondaryForegroundColor:   model.SecondaryForegroundColor,
		AccentForegroundColor:      model.AccentForegroundColor,
		MutedColor:                 model.MutedColor,
		MutedForegroundColor:       model.MutedForegroundColor,
		BorderColor:                model.BorderColor,
		InputColor:                 model.InputColor,
		RingColor:                  model.RingColor,
		SuccessColor:               model.SuccessColor,
		SuccessForegroundColor:     model.SuccessForegroundColor,
		WarningColor:               model.WarningColor,
		WarningForegroundColor:     model.WarningForegroundColor,
		DestructiveColor:           model.DestructiveColor,
		DestructiveForegroundColor: model.DestructiveForegroundColor,
		InfoColor:                  model.InfoColor,
		InfoForegroundColor:        model.InfoForegroundColor,
	}
	if model.LogoUrl.Valid {
		theme.LogoUrl = model.LogoUrl.String
	}
	theme.FaviconUrl = tenantFaviconURL(model.FaviconImageID)
	return theme
}

// The favicon is served by the image server from the tenant image it points
// at, so an upload that stores a new image also changes this URL.
func tenantFaviconURL(faviconImageID uuid.NullUUID) string {
	if !faviconImageID.Valid {
		return ""
	}
	return fmt.Sprintf("/images/tenants/%s", faviconImageID.UUID.String())
}
