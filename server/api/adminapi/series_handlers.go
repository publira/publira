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
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
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
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("eye_catch_image_data exceeds 10MB"), "eye_catch_image_data")
	}

	normalizedContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalizedContentType == "" {
		normalizedContentType = strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	}
	if normalizedContentType != "image/jpeg" && normalizedContentType != "image/png" && normalizedContentType != "image/webp" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("eye_catch_image_content_type must be image/jpeg, image/png, or image/webp"), "eye_catch_image_content_type")
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
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create series image", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	variants, err := imageproc.BuildEyeCatchVariants(img.Data, img.ContentType)
	if err != nil {
		return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "eye_catch_image_data")
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
			return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create series image variant", createVariantErr, "tenant_id", tenant.ID.String(), "series_image_id", createdImage.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to list series image variants", err)
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
		return nil, s.internalDBError(ctx, "failed to list creators by public ids", err, "tenant_id", tenantID.String())
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
	creators []dbmodels.ListCreatorsByPublicIDsForTenantRow,
	replace bool,
) ([]*publirattypesv1.Creator, error) {
	if replace {
		if err := s.queriesFor(ctx).DeleteSeriesCreatorsBySeriesID(ctx, seriesID); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete series creators", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
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
			return nil, s.internalDBError(ctx, "failed to create series creator", err, "tenant_id", tenantID.String(), "series_id", seriesID.String(), "creator_id", creator.ID.String())
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
		return nil, s.internalDBError(ctx, "failed to list series creators", err)
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

func seriesRevalidateTags(tenantID, seriesPublicID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	normalizedSeriesPublicID := strings.TrimSpace(seriesPublicID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:%s", normalizedTenantID, normalizedSeriesPublicID),
		fmt.Sprintf("tenant:%s:authors", normalizedTenantID),
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
			return nil, s.internalDBError(ctx, "failed to get label for create series", err, "tenant_id", tenant.ID.String(), "label_public_id", req.Msg.LabelPublicId)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	creatorsToLink, err := s.resolveCreatorsByPublicIDs(ctx, tenant.ID, req.Msg.CreatorPublicIds)
	if err != nil {
		return nil, err
	}
	seriesID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create series transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	base, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.Series, error) {
		return s.queriesFor(txCtx).CreateSeriesBase(txCtx, dbmodels.CreateSeriesBaseParams{
			ID: seriesID, TenantID: tenant.ID, LabelID: labelID, PublicID: publicID, Title: req.Msg.Title,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create series", err, "tenant_id", tenant.ID.String())
	}
	_, err = s.queriesFor(txCtx).UpsertSeriesListing(txCtx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert series listing", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	err = s.queriesFor(txCtx).UpdateSeriesPublication(txCtx, dbmodels.UpdateSeriesPublicationParams{
		ID:          base.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series publication", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	eyeCatchImageID, err := s.createSeriesEyeCatchImage(txCtx, tenant, base.ID, base.PublicID, eyeCatchImage)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(txCtx).UpdateSeriesEyeCatchImageID(txCtx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              base.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update series eye catch image", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
		}
	}
	creators, err := s.syncSeriesCreators(txCtx, tenant.ID, base.ID, creatorsToLink, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create series", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
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
		if err := s.reval.RevalidateTags(ctx, seriesRevalidateTags(tenant.ID.String(), base.PublicID)); err != nil {
			s.logger.Warn("failed to request next revalidate after series create", "tenant_public_id", tenant.PublicID, "series_public_id", base.PublicID, "error", err)
		}
	}
	created, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: base.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created series", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
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
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"), "eye_catch_image_data")
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
		return nil, s.internalDBError(ctx, "failed to get series for update", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.PublicId)
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
			return nil, s.internalDBError(ctx, "failed to get label for update series", err, "tenant_id", tenant.ID.String(), "label_public_id", labelPublicID)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	creatorsToLink, err := s.resolveCreatorsByPublicIDs(ctx, tenant.ID, req.Msg.CreatorPublicIds)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update series transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	err = s.queriesFor(txCtx).UpdateSeriesBase(txCtx, dbmodels.UpdateSeriesBaseParams{ID: current.ID, Title: req.Msg.Title, LabelID: labelID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	_, err = s.queriesFor(txCtx).UpsertSeriesListing(txCtx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert series listing", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	err = s.queriesFor(txCtx).UpdateSeriesPublication(txCtx, dbmodels.UpdateSeriesPublicationParams{
		ID:          current.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series publication", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	eyeCatchImageID := current.EyeCatchImageID
	if req.Msg.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if eyeCatchImage != nil {
		newEyeCatchImageID, uploadErr := s.createSeriesEyeCatchImage(txCtx, tenant, current.ID, current.PublicID, eyeCatchImage)
		if uploadErr != nil {
			return nil, uploadErr
		}
		eyeCatchImageID = newEyeCatchImageID
	}
	if eyeCatchImageID != current.EyeCatchImageID {
		if err := s.queriesFor(txCtx).UpdateSeriesEyeCatchImageID(txCtx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              current.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update series eye catch image", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
		}
	}
	creators, err := s.syncSeriesCreators(txCtx, tenant.ID, current.ID, creatorsToLink, true)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	updated, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get updated series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
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
			if err := s.reval.RevalidateTags(ctx, seriesRevalidateTags(tenant.ID.String(), current.PublicID)); err != nil {
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

const (
	defaultSeriesPageSize = int32(20)
	maxSeriesPageSize     = int32(100)
)

// seriesPageRow is one row of an admin series page, shared by the descending
// and ascending keyset queries so the handler reads a single shape.
type seriesPageRow struct {
	id                     uuid.UUID
	publicID               string
	title                  string
	labelPublicID          sql.NullString
	labelName              sql.NullString
	synopsis               sql.NullString
	readingPeriodHours     sql.NullInt32
	isPublished            bool
	publishedAt            sql.NullTime
	createdAt              time.Time
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func mapSeriesDescRows(rows []dbmodels.ListSeriesByTenantDescRow) []seriesPageRow {
	mapped := make([]seriesPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, seriesPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			title:                  row.Title,
			labelPublicID:          row.LabelPublicID,
			labelName:              row.LabelName,
			synopsis:               row.Synopsis,
			readingPeriodHours:     row.ReadingPeriodHours,
			isPublished:            row.IsPublished,
			publishedAt:            row.PublishedAt,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

func mapSeriesAscRows(rows []dbmodels.ListSeriesByTenantAscRow) []seriesPageRow {
	mapped := make([]seriesPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, seriesPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			title:                  row.Title,
			labelPublicID:          row.LabelPublicID,
			labelName:              row.LabelName,
			synopsis:               row.Synopsis,
			readingPeriodHours:     row.ReadingPeriodHours,
			isPublished:            row.IsPublished,
			publishedAt:            row.PublishedAt,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

// seriesPage runs the keyset query for one page. The list reads newest first, so
// a backward page is scanned by the ascending query and put back into display
// order by pagination.Page.
func (s *adminServer) seriesPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]seriesPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListSeriesByTenantAsc(ctx, dbmodels.ListSeriesByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapSeriesAscRows(rows), nil
	}

	rows, err := queries.ListSeriesByTenantDesc(ctx, dbmodels.ListSeriesByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapSeriesDescRows(rows), nil
}

func (s *adminServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListSeriesRequest],
) (*connect.Response[publiraadminv1.ListSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultSeriesPageSize, maxSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.seriesPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Series, 0, len(rows))
	seriesIDs := make([]uuid.UUID, 0, len(rows))
	seriesImageIDs := make([]uuid.UUID, 0, len(rows))
	itemByID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	itemByImageID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{PublicId: row.publicID, Title: row.title, IsPublished: row.isPublished}
		if row.labelPublicID.Valid {
			item.Label = protomapper.Label(row.labelPublicID.String, row.labelName.String)
		}
		if row.synopsis.Valid {
			item.Synopsis = row.synopsis.String
		}
		if row.readingPeriodHours.Valid {
			item.ReadingPeriodHours = row.readingPeriodHours.Int32
		}
		if row.eyeCatchImageID.Valid {
			seriesImageIDs = append(seriesImageIDs, row.eyeCatchImageID.UUID)
			itemByImageID[row.eyeCatchImageID.UUID] = item
		}
		if row.eyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.eyeCatchImageUpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		if row.publishedAt.Valid {
			item.PublishedAt = row.publishedAt.Time.UTC().Format(time.RFC3339)
		}
		seriesIDs = append(seriesIDs, row.id)
		itemByID[row.id] = item
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

	res := &publiraadminv1.ListSeriesResponse{
		Series:                    items,
		DefaultReadingPeriodHours: defaultReadingPeriodHours,
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
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
		return nil, s.internalDBError(ctx, "failed to get series", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.PublicId)
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
