package protomapper

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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

// TenantTheme carries its branding images the way Series carries its eye-catch:
// the image's updated_at plus its variants, with the served URL built here. A
// tenant that has not uploaded one has no variants, which is how a caller tells
// "unset" from "set".
func TenantThemeFromGetRow(
	row dbmodels.GetTenantThemeByTenantIDRow,
	iconVariants []*publirattypesv1.TenantImageVariant,
	logoVariants []*publirattypesv1.TenantImageVariant,
) *publirattypesv1.TenantTheme {
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
	if row.IconImageUpdatedAt.Valid {
		theme.IconImageUpdatedAt = row.IconImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if len(iconVariants) > 0 {
		theme.IconImageVariants = iconVariants
	}
	if row.LogoImageUpdatedAt.Valid {
		theme.LogoImageUpdatedAt = row.LogoImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	if len(logoVariants) > 0 {
		theme.LogoImageVariants = logoVariants
	}
	return theme
}

// TenantImageVariantsByImageID groups the variants of both branding images by
// the image they belong to, so one read of tenant_image_variants serves the
// icon and the logo.
func TenantImageVariantsByImageID(
	rows []dbmodels.ListTenantImageVariantsByImageIDsRow,
) map[uuid.UUID][]*publirattypesv1.TenantImageVariant {
	byImageID := make(map[uuid.UUID][]*publirattypesv1.TenantImageVariant, len(rows))
	for _, row := range rows {
		byImageID[row.TenantImageID] = append(byImageID[row.TenantImageID], &publirattypesv1.TenantImageVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           TenantImageURL(row.TenantImageID, row.VariantType),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return byImageID
}

// TenantImageURL is the image server route a stored tenant image is served
// from, keyed by what the image is for the same way the series route is keyed
// by aspect ratio. A replace stores a new image, so this URL changes on its own
// and needs no cache-busting query. Callers that want a smaller rendition add
// the image server's own `w` parameter; nothing is pre-generated per size.
func TenantImageURL(tenantImageID uuid.UUID, variantType string) string {
	return fmt.Sprintf("/images/tenants/%s/%s", tenantImageID.String(), variantType)
}
