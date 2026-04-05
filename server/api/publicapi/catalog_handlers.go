package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type creatorJSON struct {
	PublicID               string `json:"public_id"`
	Name                   string `json:"name"`
	Role                   string `json:"role"`
	ProfileText            string `json:"profile_text"`
	IconImageURL           string `json:"icon_image_url"`
	IconImageFileSizeBytes int64  `json:"icon_image_file_size_bytes"`
	IconImageUpdatedAt     string `json:"icon_image_updated_at"`
}

type episodeJSON struct {
	PublicID           string  `json:"public_id"`
	Title              string  `json:"title"`
	OrderIndex         int32   `json:"order_index"`
	Price              int32   `json:"price"`
	ReadingPeriodHours *int32  `json:"reading_period_hours"`
	Status             string  `json:"status"`
	ScheduledAt        *string `json:"scheduled_at"`
	PublishedAt        *string `json:"published_at"`
}

func mapSeriesEyeCatchVariants(seriesImageID uuid.UUID, rows []dbmodels.ListSeriesImageVariantsByImageIDsRow) []*publirattypesv1.SeriesEyeCatchVariant {
	items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(rows))
	for _, row := range rows {
		items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/series/%s/%s/%d", seriesImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return items
}

func (s *apiServer) seriesEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListSeriesImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListSeriesImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.SeriesImageID] = append(byImageID[row.SeriesImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		mapped[imageID] = mapSeriesEyeCatchVariants(imageID, variants)
	}

	return mapped, nil
}

func (s *apiServer) ListPublishedLabels(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedLabelsRequest],
) (*connect.Response[publirav1.ListPublishedLabelsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := req.Msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.queriesFor(ctx).ListLabelsByTenant(ctx, dbmodels.ListLabelsByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*publirattypesv1.Label, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		item := &publirattypesv1.Label{PublicId: row.PublicID, Name: row.Name}
		if row.EyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		if row.EyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.EyeCatchImageID.UUID)
		}
		items = append(items, item)
	}

	// ラベル画像バリアント情報を取得
	if len(imageIDs) > 0 {
		variantsByImageID, err := s.labelEyeCatchVariantsByImageIDs(ctx, imageIDs)
		if err == nil {
			for i, row := range rows {
				if row.EyeCatchImageID.Valid {
					if variants, ok := variantsByImageID[row.EyeCatchImageID.UUID]; ok {
						items[i].EyeCatchImageVariants = variants
					}
				}
			}
		}
	}

	return connect.NewResponse(&publirav1.ListPublishedLabelsResponse{Labels: items}), nil
}

func (s *apiServer) ListPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedSeriesRequest],
) (*connect.Response[publirav1.ListPublishedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := req.Msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.queriesFor(ctx).ListActiveSeries(ctx, dbmodels.ListActiveSeriesParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Series, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		if row.EyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		if row.EyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.EyeCatchImageID.UUID)
		}
		creators := make([]creatorJSON, 0)
		if len(row.Creators) > 0 {
			if err := json.Unmarshal(row.Creators, &creators); err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
		}
		item.Creators = make([]*publirattypesv1.Creator, 0, len(creators))
		for _, creator := range creators {
			item.Creators = append(item.Creators, &publirattypesv1.Creator{
				PublicId:               creator.PublicID,
				Name:                   creator.Name,
				Role:                   creator.Role,
				ProfileText:            creator.ProfileText,
				IconImageUrl:           creator.IconImageURL,
				IconImageFileSizeBytes: creator.IconImageFileSizeBytes,
				IconImageUpdatedAt:     creator.IconImageUpdatedAt,
			})
		}

		// ラベル情報を処理
		if len(row.LabelInfo) > 0 && string(row.LabelInfo) != "{}" {
			var labelInfo map[string]interface{}
			if err := json.Unmarshal(row.LabelInfo, &labelInfo); err == nil {
				if publicIDVal, ok := labelInfo["public_id"].(string); ok {
					label := &publirattypesv1.Label{
						PublicId: publicIDVal,
					}
					if nameVal, ok := labelInfo["name"].(string); ok {
						label.Name = nameVal
					}
					if eyeCatchImageUpdatedAtVal, ok := labelInfo["eye_catch_image_updated_at"].(string); ok {
						label.EyeCatchImageUpdatedAt = eyeCatchImageUpdatedAtVal
					}
					item.Label = label
				}
			}
		}

		items = append(items, item)
	}
	if len(imageIDs) > 0 {
		variantsByImageID, err := s.seriesEyeCatchVariantsByImageIDs(ctx, imageIDs)
		if err == nil {
			for i, row := range rows {
				if row.EyeCatchImageID.Valid {
					if variants, ok := variantsByImageID[row.EyeCatchImageID.UUID]; ok {
						items[i].EyeCatchImageVariants = variants
					}
				}
			}
		}
	}
	return connect.NewResponse(&publirav1.ListPublishedSeriesResponse{Series: items}), nil
}

func (s *apiServer) GetSeriesDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesDetailRequest],
) (*connect.Response[publirav1.GetSeriesDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesDetail(ctx, dbmodels.GetSeriesDetailParams{PublicID: req.Msg.PublicId, TenantID: tenant.ID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !row.IsPublished || !row.PublishedAt.Valid || row.PublishedAt.Time.After(time.Now()) {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("series is not published"))
	}

	creators := make([]creatorJSON, 0)
	if len(row.Creators) > 0 {
		if err := json.Unmarshal(row.Creators, &creators); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	episodes := make([]episodeJSON, 0)
	if len(row.Episodes) > 0 {
		if err := json.Unmarshal(row.Episodes, &episodes); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	res := connect.NewResponse(&publirav1.GetSeriesDetailResponse{
		Series:   &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title},
		Episodes: make([]*publirattypesv1.Episode, 0, len(episodes)),
	})
	if row.Synopsis.Valid {
		res.Msg.Series.Synopsis = row.Synopsis.String
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		res.Msg.Series.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}

	// ラベル情報を処理
	if row.LabelPublicID.Valid && row.LabelName.Valid {
		label := &publirattypesv1.Label{
			PublicId: row.LabelPublicID.String,
			Name:     row.LabelName.String,
		}

		res.Msg.Series.Label = label
	}
	if row.EyeCatchImageID.Valid {
		variants, err := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if err == nil && len(variants) > 0 {
			if imageVariants, ok := variants[row.EyeCatchImageID.UUID]; ok {
				res.Msg.Series.EyeCatchImageVariants = imageVariants
			}
		}
	}

	res.Msg.Series.Creators = make([]*publirattypesv1.Creator, 0, len(creators))
	for _, creator := range creators {
		res.Msg.Series.Creators = append(res.Msg.Series.Creators, &publirattypesv1.Creator{
			PublicId:               creator.PublicID,
			Name:                   creator.Name,
			Role:                   creator.Role,
			ProfileText:            creator.ProfileText,
			IconImageUrl:           creator.IconImageURL,
			IconImageFileSizeBytes: creator.IconImageFileSizeBytes,
			IconImageUpdatedAt:     creator.IconImageUpdatedAt,
		})
	}
	for _, episode := range episodes {
		item := &publirattypesv1.Episode{
			PublicId:   episode.PublicID,
			Title:      episode.Title,
			OrderIndex: episode.OrderIndex,
			Price:      episode.Price,
			Status:     episode.Status,
		}
		if episode.ReadingPeriodHours != nil {
			item.ReadingPeriodHours = *episode.ReadingPeriodHours
		}
		if episode.ScheduledAt != nil {
			item.ScheduledAt = *episode.ScheduledAt
		}
		if episode.PublishedAt != nil {
			item.PublishedAt = *episode.PublishedAt
		}
		res.Msg.Episodes = append(res.Msg.Episodes, item)
	}
	return res, nil
}

func (s *apiServer) GetEpisodeDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetEpisodeDetailRequest],
) (*connect.Response[publirav1.GetEpisodeDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	images, err := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, row.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	res := connect.NewResponse(&publirav1.GetEpisodeDetailResponse{
		Episode: protomapper.EpisodeFromGetPublishedEpisodeByPublicIDForTenantRow(row),
		Series:  protomapper.SeriesFromGetPublishedEpisodeByPublicIDForTenantRow(row),
		Images:  make([]*publirattypesv1.EpisodeImage, 0, len(images)),
	})
	for _, image := range images {
		res.Msg.Images = append(res.Msg.Images, protomapper.EpisodeImageFromEpisodeImage(image))
	}

	return res, nil
}

// labelEyeCatchVariantsByImageIDs ラベル画像IDのリストからバリアント情報を取得する
func (s *apiServer) labelEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListLabelImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListLabelImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.LabelImageID] = append(byImageID[row.LabelImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(variants))
		for _, row := range variants {
			items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
				Label:         row.Label,
				VariantType:   row.VariantType,
				Url:           fmt.Sprintf("/images/labels/%s/%s/%d", imageID.String(), row.VariantType, row.Width),
				ContentType:   row.ContentType,
				Width:         row.Width,
				Height:        row.Height,
				FileSizeBytes: row.FileSizeBytes,
			})
		}
		mapped[imageID] = items
	}

	return mapped, nil
}
