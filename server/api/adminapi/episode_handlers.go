package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

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

func (s *adminServer) ListEpisodes(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListEpisodesRequest],
) (*connect.Response[publiraadminv1.ListEpisodesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}

	rows, err := s.queries.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	episodes := make([]*publirattypesv1.Episode, 0, len(rows))
	for _, row := range rows {
		episodes = append(episodes, protomapper.EpisodeFromListEpisodesBySeriesForTenantRow(row))
	}

	return connect.NewResponse(&publiraadminv1.ListEpisodesResponse{Episodes: episodes}), nil
}

func (s *adminServer) ReorderEpisodes(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderEpisodesRequest],
) (*connect.Response[publiraadminv1.ReorderEpisodesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.SeriesPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required"))
	}
	if len(req.Msg.EpisodePublicIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids are required"))
	}

	rows, err := s.queries.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(req.Msg.EpisodePublicIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids must include all episodes in the series"))
	}

	validEpisodeIDs := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		validEpisodeIDs[row.PublicID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(req.Msg.EpisodePublicIds))
	for _, episodePublicID := range req.Msg.EpisodePublicIds {
		if strings.TrimSpace(episodePublicID) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids contains empty value"))
		}
		if _, ok := validEpisodeIDs[episodePublicID]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids contains unknown episode"))
		}
		if _, ok := seen[episodePublicID]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_ids contains duplicate episode"))
		}
		seen[episodePublicID] = struct{}{}
	}

	for index, episodePublicID := range req.Msg.EpisodePublicIds {
		if err := s.queries.UpdateEpisodeOrderIndexByPublicIDForTenantAndSeries(ctx, dbmodels.UpdateEpisodeOrderIndexByPublicIDForTenantAndSeriesParams{
			TenantID:   tenant.ID,
			PublicID:   req.Msg.SeriesPublicId,
			PublicID_2: episodePublicID,
			OrderIndex: int32(index + 1),
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	updatedRows, err := s.queries.ListEpisodesBySeriesForTenant(ctx, dbmodels.ListEpisodesBySeriesForTenantParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.SeriesPublicId,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	episodes := make([]*publirattypesv1.Episode, 0, len(updatedRows))
	for _, row := range updatedRows {
		episodes = append(episodes, protomapper.EpisodeFromListEpisodesBySeriesForTenantRow(row))
	}

	return connect.NewResponse(&publiraadminv1.ReorderEpisodesResponse{Episodes: episodes}), nil
}

func (s *adminServer) CreateEpisode(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateEpisodeRequest],
) (*connect.Response[publiraadminv1.CreateEpisodeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.OrderIndex <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("order_index must be greater than 0"))
	}
	if req.Msg.Price < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("price must be greater than or equal to 0"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
	if err != nil {
		return nil, err
	}
	series, err := s.queries.GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.SeriesPublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	episodeID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queries.CreateEpisodeBase(ctx, dbmodels.CreateEpisodeBaseParams{ID: episodeID, SeriesID: series.ID, PublicID: generatePublicID(), Title: req.Msg.Title, OrderIndex: req.Msg.OrderIndex})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	status := "draft"
	if scheduledAt.Valid {
		status = "scheduled"
	}
	listing, err := s.queries.UpsertEpisodeListing(ctx, dbmodels.UpsertEpisodeListingParams{
		EpisodeID:          base.ID,
		Price:              req.Msg.Price,
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status:             status,
		ScheduledAt:        scheduledAt,
		PublishedAt:        sql.NullTime{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	episode := &publirattypesv1.Episode{PublicId: base.PublicID, Title: base.Title, OrderIndex: base.OrderIndex, Price: listing.Price, Status: listing.Status}
	if listing.ReadingPeriodHours.Valid {
		episode.ReadingPeriodHours = listing.ReadingPeriodHours.Int32
	}
	if listing.ScheduledAt.Valid {
		episode.ScheduledAt = listing.ScheduledAt.Time.UTC().Format(time.RFC3339)
	}
	if listing.PublishedAt.Valid {
		episode.PublishedAt = listing.PublishedAt.Time.UTC().Format(time.RFC3339)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_created",
			TargetType:  "episode",
			TargetID:    base.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.CreateEpisodeResponse{Episode: episode}), nil
}

func (s *adminServer) UploadEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.UploadEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if len(req.Msg.Images) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("images are required"))
	}
	episode, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	maxDisplayOrder, err := s.queries.GetMaxEpisodeImageDisplayOrderByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.EpisodeImage, 0, len(req.Msg.Images))
	for index, imageUpload := range req.Msg.Images {
		if len(imageUpload.Data) == 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].data is required", index))
		}
		contentType := strings.TrimSpace(imageUpload.ContentType)
		if contentType == "" {
			contentType = http.DetectContentType(imageUpload.Data)
		}
		if !strings.HasPrefix(contentType, "image/") {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].content_type must be image/*", index))
		}
		imageConfig, _, err := image.DecodeConfig(bytes.NewReader(imageUpload.Data))
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d] is not a decodable image", index))
		}
		if imageConfig.Width <= 0 || imageConfig.Height <= 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d] has invalid dimensions", index))
		}
		displayOrder := maxDisplayOrder + int32(index) + 1
		ext := strings.ToLower(filepath.Ext(strings.TrimSpace(imageUpload.Filename)))
		if ext == "" {
			ext = ".bin"
		}
		objectKey := fmt.Sprintf("tenants/%s/episodes/%s/%s%s", tenant.PublicID, req.Msg.EpisodePublicId, uuid.NewString(), ext)
		uploaded, err := s.storage.Upload(ctx, storage.UploadRequest{ObjectKey: objectKey, ContentType: contentType, Data: imageUpload.Data})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		episodeImageID, err := uuid.NewV7()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		created, err := s.queries.CreateEpisodeImage(ctx, dbmodels.CreateEpisodeImageParams{
			ID:              episodeImageID,
			TenantID:        tenant.ID,
			EpisodeID:       episode.ID,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ImageUrl:        uploaded.URL,
			ContentType:     contentType,
			FileSizeBytes:   uploaded.SizeBytes,
			DisplayOrder:    displayOrder,
			Width:           int32(imageConfig.Width),
			Height:          int32(imageConfig.Height),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		items = append(items, protomapper.EpisodeImageFromEpisodeImage(created))
		if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
			s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
				TenantID:    tenant.ID,
				ActorUserID: sessionCtx.User.ID,
				ActorRole:   sessionCtx.Role,
				Action:      "episode_image_uploaded",
				TargetType:  "episode",
				TargetID:    req.Msg.EpisodePublicId,
				Outcome:     auditlog.OutcomeSuccess,
				ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
			})
		}
	}
	return connect.NewResponse(&publiraadminv1.UploadEpisodeImagesResponse{Images: items}), nil
}

func (s *adminServer) ListEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.ListEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	episode, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: episodePublicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, err := s.queries.ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	images := make([]*publirattypesv1.EpisodeImage, 0, len(rows))
	for _, row := range rows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}

	return connect.NewResponse(&publiraadminv1.ListEpisodeImagesResponse{Images: images}), nil
}

func (s *adminServer) ReorderEpisodeImages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderEpisodeImagesRequest],
) (*connect.Response[publiraadminv1.ReorderEpisodeImagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	episodePublicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if episodePublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	if len(req.Msg.ImageIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids are required"))
	}
	episode, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: episodePublicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, err := s.queries.ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(req.Msg.ImageIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids must include all images in the episode"))
	}

	validImageIDs := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		validImageIDs[row.ID.String()] = struct{}{}
	}
	seen := make(map[string]struct{}, len(req.Msg.ImageIds))
	for _, imageID := range req.Msg.ImageIds {
		if strings.TrimSpace(imageID) == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains empty value"))
		}
		if _, ok := validImageIDs[imageID]; !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains unknown image"))
		}
		if _, ok := seen[imageID]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains duplicate image"))
		}
		seen[imageID] = struct{}{}
	}

	for index, imageID := range req.Msg.ImageIds {
		parsedImageID, err := uuid.Parse(imageID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("image_ids contains invalid uuid"))
		}
		if err := s.queries.UpdateEpisodeImageDisplayOrderByIDForEpisode(ctx, dbmodels.UpdateEpisodeImageDisplayOrderByIDForEpisodeParams{
			ID:           parsedImageID,
			EpisodeID:    episode.ID,
			DisplayOrder: int32(index + 1),
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	updatedRows, err := s.queries.ListEpisodeImagesByEpisodeID(ctx, episode.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	images := make([]*publirattypesv1.EpisodeImage, 0, len(updatedRows))
	for _, row := range updatedRows {
		images = append(images, protomapper.EpisodeImageFromEpisodeImage(row))
	}

	return connect.NewResponse(&publiraadminv1.ReorderEpisodeImagesResponse{Images: images}), nil
}

func (s *adminServer) UpdateEpisodePublishSchedule(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateEpisodePublishScheduleRequest],
) (*connect.Response[publiraadminv1.UpdateEpisodePublishScheduleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	scheduledAt, err := parseScheduledAtOrZero(req.Msg.ScheduledAt)
	if err != nil {
		return nil, err
	}
	scheduledAt, err = normalizeAndValidateScheduledAt(scheduledAt, time.Now())
	if err != nil {
		return nil, err
	}
	err = s.queries.UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId, ScheduledAt: scheduledAt})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	ep, err := s.queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.EpisodePublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "episode_updated",
			TargetType:  "episode",
			TargetID:    ep.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	return connect.NewResponse(&publiraadminv1.UpdateEpisodePublishScheduleResponse{Episode: protomapper.EpisodeFromGetEpisodeByPublicIDForTenantRow(ep)}), nil
}
