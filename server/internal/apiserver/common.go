package apiserver

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func toProtoSeries(row dbmodels.GetSeriesByPublicIDForTenantRow) *publirav1.Series {
	series := &publirav1.Series{
		PublicId: row.PublicID,
		Title:    row.Title,
	}
	if row.Synopsis.Valid {
		series.Synopsis = row.Synopsis.String
	}
	return series
}

func toProtoEpisode(row dbmodels.GetEpisodeByPublicIDForTenantRow) *publirav1.Episode {
	episode := &publirav1.Episode{
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

func toProtoEpisodeImage(row dbmodels.EpisodeImage) *publirav1.EpisodeImage {
	return &publirav1.EpisodeImage{
		Id:            row.ID.String(),
		ImageUrl:      row.ImageUrl,
		ContentType:   row.ContentType,
		FileSizeBytes: row.FileSizeBytes,
		DisplayOrder:  row.DisplayOrder,
		Width:         row.Width,
		Height:        row.Height,
	}
}

func generatePublicID() string {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")
	return strings.ToUpper(raw[:12])
}

func parseScheduledAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be RFC3339"))
	}
	return sql.NullTime{Time: t, Valid: true}, nil
}

func normalizeAndValidateScheduledAt(scheduledAt sql.NullTime, now time.Time) (sql.NullTime, error) {
	if !scheduledAt.Valid {
		return scheduledAt, nil
	}
	normalized := scheduledAt.Time.UTC()
	if !normalized.After(now.UTC()) {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("scheduled_at must be in the future"))
	}
	return sql.NullTime{Time: normalized, Valid: true}, nil
}
