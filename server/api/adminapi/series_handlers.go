package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

func parsePublishedAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("published_at must be RFC3339"))
	}
	return sql.NullTime{Time: t.UTC(), Valid: true}, nil
}

type normalizedEyeCatchImage struct {
	ContentType string
	Data        []byte
}

func normalizeSeriesEyeCatchImage(data []byte, contentType string) (*normalizedEyeCatchImage, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) > imageproc.EyeCatchMaxBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("eye_catch_image_data exceeds 10MB"))
	}

	normalizedContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalizedContentType == "" {
		normalizedContentType = strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	}
	if normalizedContentType != "image/jpeg" && normalizedContentType != "image/png" && normalizedContentType != "image/webp" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("eye_catch_image_content_type must be image/jpeg, image/png, or image/webp"))
	}

	return &normalizedEyeCatchImage{
		ContentType: normalizedContentType,
		Data:        data,
	}, nil
}

func (s *adminServer) createSeriesEyeCatchImage(ctx context.Context, tenant dbmodels.Tenant, seriesID uuid.UUID, seriesPublicID string, img *normalizedEyeCatchImage) (uuid.NullUUID, error) {
	if img == nil {
		return uuid.NullUUID{}, nil
	}
	if s.storage == nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	seriesImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	createdImage, err := s.queriesFor(ctx).CreateSeriesImage(ctx, dbmodels.CreateSeriesImageParams{
		ID:       seriesImageID,
		TenantID: tenant.ID,
		SeriesID: seriesID,
	})
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	variants, err := imageproc.BuildEyeCatchVariants(img.Data, img.ContentType)
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInvalidArgument, err)
	}

	for _, variant := range variants {
		objectKey := fmt.Sprintf(
			"tenants/%s/series/%s/%s-%s%s",
			tenant.PublicID,
			seriesPublicID,
			createdImage.ID.String(),
			variant.Label,
			variant.Extension,
		)
		uploaded, uploadErr := s.storage.Upload(ctx, storage.UploadRequest{
			ObjectKey:   objectKey,
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, uploadErr)
		}

		seriesImageVariantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, variantIDErr)
		}

		_, createVariantErr := s.queriesFor(ctx).CreateSeriesImageVariant(ctx, dbmodels.CreateSeriesImageVariantParams{
			ID:              seriesImageVariantID,
			TenantID:        tenant.ID,
			SeriesImageID:   createdImage.ID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		})
		if createVariantErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, createVariantErr)
		}
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
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

func (s *adminServer) seriesEyeCatchVariantsByImageIDs(
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

func normalizePublicIDs(publicIDs []string) ([]string, error) {
	normalized := make([]string, 0, len(publicIDs))
	seen := make(map[string]struct{}, len(publicIDs))
	for _, value := range publicIDs {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator_public_ids contains empty value"))
		}
		if _, ok := seen[trimmed]; ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator_public_ids contains duplicate value"))
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized, nil
}

func (s *adminServer) resolveCreatorsByPublicIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	creatorPublicIDs []string,
) ([]dbmodels.ListCreatorsByPublicIDsForTenantRow, error) {
	normalized, err := normalizePublicIDs(creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	if len(normalized) == 0 {
		return []dbmodels.ListCreatorsByPublicIDsForTenantRow{}, nil
	}
	rows, err := s.queriesFor(ctx).ListCreatorsByPublicIDsForTenant(ctx, dbmodels.ListCreatorsByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: normalized,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) != len(normalized) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
	}
	byPublicID := make(map[string]dbmodels.ListCreatorsByPublicIDsForTenantRow, len(rows))
	for _, row := range rows {
		byPublicID[row.PublicID] = row
	}
	ordered := make([]dbmodels.ListCreatorsByPublicIDsForTenantRow, 0, len(normalized))
	for _, publicID := range normalized {
		creator, ok := byPublicID[publicID]
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator not found"))
		}
		ordered = append(ordered, creator)
	}
	return ordered, nil
}

func (s *adminServer) syncSeriesCreators(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	creatorPublicIDs []string,
	replace bool,
) ([]*publirattypesv1.Creator, error) {
	if replace {
		if err := s.queriesFor(ctx).DeleteSeriesCreatorsBySeriesID(ctx, seriesID); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	creators, err := s.resolveCreatorsByPublicIDs(ctx, tenantID, creatorPublicIDs)
	if err != nil {
		return nil, err
	}
	items := make([]*publirattypesv1.Creator, 0, len(creators))
	for index, creator := range creators {
		err := s.queriesFor(ctx).CreateSeriesCreator(ctx, dbmodels.CreateSeriesCreatorParams{
			TenantID:     tenantID,
			SeriesID:     seriesID,
			CreatorID:    creator.ID,
			Role:         "creator",
			DisplayOrder: int32(index),
		})
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		items = append(items, protomapper.Creator(creator.PublicID, creator.Name, creator.ProfileText.String))
	}
	return items, nil
}

func (s *adminServer) seriesCreatorsBySeriesIDs(
	ctx context.Context,
	seriesIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Creator, error) {
	if len(seriesIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Creator{}, nil
	}
	rows, err := s.queriesFor(ctx).ListSeriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make(map[uuid.UUID][]*publirattypesv1.Creator, len(seriesIDs))
	for _, row := range rows {
		items[row.SeriesID] = append(items[row.SeriesID], &publirattypesv1.Creator{
			PublicId: row.PublicID,
			Name:     row.Name,
			Role:     row.Role,
		})
	}
	return items, nil
}

func generatePublicID() string {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")
	return strings.ToUpper(raw[:12])
}

func seriesRevalidateTags(tenantPublicID, seriesPublicID string) []string {
	normalizedTenantPublicID := strings.TrimSpace(tenantPublicID)
	normalizedSeriesPublicID := strings.TrimSpace(seriesPublicID)
	return []string{
		fmt.Sprintf("tenant:%s:public:site", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:list", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:detail", normalizedTenantPublicID),
		fmt.Sprintf("tenant:%s:catalog:series:%s", normalizedTenantPublicID, normalizedSeriesPublicID),
		fmt.Sprintf("tenant:%s:catalog:authors", normalizedTenantPublicID),
	}
}

func (s *adminServer) CreateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateSeriesRequest],
) (*connect.Response[publiraadminv1.CreateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	eyeCatchImage, err := normalizeSeriesEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	publishedAt, err := parsePublishedAtOrZero(req.Msg.PublishedAt)
	if err != nil {
		return nil, err
	}
	if !publishedAt.Valid && req.Msg.IsPublished {
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	}
	labelID := uuid.NullUUID{}
	if strings.TrimSpace(req.Msg.LabelPublicId) != "" {
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.LabelPublicId})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	seriesID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	base, err := s.queriesFor(ctx).CreateSeriesBase(ctx, dbmodels.CreateSeriesBaseParams{
		ID: seriesID, TenantID: tenant.ID, LabelID: labelID, PublicID: generatePublicID(), Title: req.Msg.Title,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queriesFor(ctx).UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID:          base.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	eyeCatchImageID, err := s.createSeriesEyeCatchImage(ctx, tenant, base.ID, base.PublicID, eyeCatchImage)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(ctx).UpdateSeriesEyeCatchImageID(ctx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              base.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	creators, err := s.syncSeriesCreators(ctx, tenant.ID, base.ID, req.Msg.CreatorPublicIds, false)
	if err != nil {
		return nil, err
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_created",
			TargetType:  "series",
			TargetID:    base.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if publishedAt.Valid && !publishedAt.Time.After(time.Now().UTC()) && s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenant.PublicID, tenant.Domain, seriesRevalidateTags(tenant.PublicID, base.PublicID)); err != nil {
			s.logger.Warn("failed to request next revalidate after series create", "tenant_public_id", tenant.PublicID, "series_public_id", base.PublicID, "error", err)
		}
	}
	created, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: base.PublicID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(created)
	if created.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{created.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[created.EyeCatchImageID.UUID]
	}
	series.Creators = creators
	return connect.NewResponse(&publiraadminv1.CreateSeriesResponse{Series: series}), nil
}

func (s *adminServer) UpdateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateSeriesRequest],
) (*connect.Response[publiraadminv1.UpdateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	if req.Msg.ClearEyeCatchImage && len(req.Msg.EyeCatchImageData) > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"))
	}
	eyeCatchImage, err := normalizeSeriesEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	publishedAt, err := parsePublishedAtOrZero(req.Msg.PublishedAt)
	if err != nil {
		return nil, err
	}
	if !publishedAt.Valid && req.Msg.IsPublished {
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	}
	current, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	labelPublicID := strings.TrimSpace(req.Msg.LabelPublicId)
	if labelPublicID == "" && current.LabelPublicID.Valid {
		labelPublicID = current.LabelPublicID.String
	}
	labelID := uuid.NullUUID{}
	if labelPublicID != "" {
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: labelPublicID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	err = s.queriesFor(ctx).UpdateSeriesBase(ctx, dbmodels.UpdateSeriesBaseParams{ID: current.ID, Title: req.Msg.Title, LabelID: labelID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	_, err = s.queriesFor(ctx).UpsertSeriesListing(ctx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queriesFor(ctx).UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID:          current.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	eyeCatchImageID := current.EyeCatchImageID
	if req.Msg.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if eyeCatchImage != nil {
		newEyeCatchImageID, uploadErr := s.createSeriesEyeCatchImage(ctx, tenant, current.ID, current.PublicID, eyeCatchImage)
		if uploadErr != nil {
			return nil, uploadErr
		}
		eyeCatchImageID = newEyeCatchImageID
	}
	if eyeCatchImageID != current.EyeCatchImageID {
		if err := s.queriesFor(ctx).UpdateSeriesEyeCatchImageID(ctx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              current.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	creators, err := s.syncSeriesCreators(ctx, tenant.ID, current.ID, req.Msg.CreatorPublicIds, true)
	if err != nil {
		return nil, err
	}
	updated, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_updated",
			TargetType:  "series",
			TargetID:    current.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if current.IsPublished || (publishedAt.Valid && !publishedAt.Time.After(time.Now().UTC())) {
			if err := s.reval.RevalidateTags(ctx, tenant.PublicID, tenant.Domain, seriesRevalidateTags(tenant.PublicID, current.PublicID)); err != nil {
				s.logger.Warn("failed to request next revalidate after series update", "tenant_public_id", tenant.PublicID, "series_public_id", current.PublicID, "error", err)
			}
		}
	}
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(updated)
	if updated.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{updated.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[updated.EyeCatchImageID.UUID]
	}
	series.Creators = creators
	return connect.NewResponse(&publiraadminv1.UpdateSeriesResponse{Series: series}), nil
}

func (s *adminServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListSeriesRequest],
) (*connect.Response[publiraadminv1.ListSeriesResponse], error) {
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
	rows, err := s.queriesFor(ctx).ListSeriesByTenant(ctx, dbmodels.ListSeriesByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Series, 0, len(rows))
	seriesIDs := make([]uuid.UUID, 0, len(rows))
	seriesImageIDs := make([]uuid.UUID, 0, len(rows))
	itemByID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	itemByImageID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title, IsPublished: row.IsPublished}
		if row.LabelPublicID.Valid {
			item.Label = protomapper.Label(row.LabelPublicID.String, row.LabelName.String)
		}
		if row.Synopsis.Valid {
			item.Synopsis = row.Synopsis.String
		}
		if row.ReadingPeriodHours.Valid {
			item.ReadingPeriodHours = row.ReadingPeriodHours.Int32
		}
		if row.EyeCatchImageID.Valid {
			seriesImageIDs = append(seriesImageIDs, row.EyeCatchImageID.UUID)
			itemByImageID[row.EyeCatchImageID.UUID] = item
		}
		if row.EyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		if row.PublishedAt.Valid {
			item.PublishedAt = row.PublishedAt.Time.UTC().Format(time.RFC3339)
		}
		seriesIDs = append(seriesIDs, row.ID)
		itemByID[row.ID] = item
		items = append(items, item)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, err
	}
	for seriesID, creators := range creatorsBySeriesID {
		if item, ok := itemByID[seriesID]; ok {
			item.Creators = creators
		}
	}
	eyeCatchVariantsByImageID, err := s.seriesEyeCatchVariantsByImageIDs(ctx, seriesImageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range eyeCatchVariantsByImageID {
		if item, ok := itemByImageID[imageID]; ok {
			item.EyeCatchImageVariants = variants
		}
	}
	defaultReadingPeriodHours := int32(0)
	if tenant.DefaultReadingPeriodHours.Valid {
		defaultReadingPeriodHours = tenant.DefaultReadingPeriodHours.Int32
	}
	return connect.NewResponse(&publiraadminv1.ListSeriesResponse{
		Series:                    items,
		DefaultReadingPeriodHours: defaultReadingPeriodHours,
	}), nil
}

func (s *adminServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetSeriesRequest],
) (*connect.Response[publiraadminv1.GetSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(row)
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	series.Creators = creatorsBySeriesID[row.ID]
	return connect.NewResponse(&publiraadminv1.GetSeriesResponse{Series: series}), nil
}
