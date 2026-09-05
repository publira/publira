package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	creatorIconMaxUploadBytes = 10 << 20
	creatorIconMinDimension   = 256
	defaultCreatorPageSize    = int32(20)
	maxCreatorPageSize        = int32(100)
	defaultLabelPageSize      = int32(20)
	maxLabelPageSize          = int32(100)
)

type creatorPageRow struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	profileText            sql.NullString
	createdAt              time.Time
	iconImageID            uuid.NullUUID
	iconImageFileSizeBytes int64
	iconImageUpdatedAt     sql.NullTime
}

func mapCreatorDescRows(rows []dbmodels.ListCreatorsByTenantDescRow) []creatorPageRow {
	mapped := make([]creatorPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			profileText:            row.ProfileText,
			createdAt:              row.CreatedAt,
			iconImageID:            row.IconImageID,
			iconImageFileSizeBytes: row.IconImageFileSizeBytes,
			iconImageUpdatedAt:     row.IconImageUpdatedAt,
		})
	}
	return mapped
}

func mapCreatorAscRows(rows []dbmodels.ListCreatorsByTenantAscRow) []creatorPageRow {
	mapped := make([]creatorPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			profileText:            row.ProfileText,
			createdAt:              row.CreatedAt,
			iconImageID:            row.IconImageID,
			iconImageFileSizeBytes: row.IconImageFileSizeBytes,
			iconImageUpdatedAt:     row.IconImageUpdatedAt,
		})
	}
	return mapped
}

type labelPageRow struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	createdAt              time.Time
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func mapLabelDescRows(rows []dbmodels.ListLabelsByTenantDescRow) []labelPageRow {
	mapped := make([]labelPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, labelPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

func mapLabelAscRows(rows []dbmodels.ListLabelsByTenantAscRow) []labelPageRow {
	mapped := make([]labelPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, labelPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

type normalizedCreatorIconImage struct {
	ContentType string
	Data        []byte
	Height      int32
	Width       int32
}

func normalizeCreatorIconImage(data []byte, contentType string) (*normalizedCreatorIconImage, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) > creatorIconMaxUploadBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("icon_image_data exceeds 10MB"))
	}

	normalizedContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalizedContentType == "" {
		normalizedContentType = strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	}
	if normalizedContentType != "image/jpeg" && normalizedContentType != "image/png" && normalizedContentType != "image/webp" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("icon_image_content_type must be image/jpeg, image/png, or image/webp"))
	}

	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("icon_image_data is not decodable"))
	}
	bounds := decoded.Bounds()
	cropSize := bounds.Dx()
	if bounds.Dy() < cropSize {
		cropSize = bounds.Dy()
	}
	if cropSize < creatorIconMinDimension {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("icon image must be at least 256x256"))
	}

	origin := image.Point{
		X: bounds.Min.X + (bounds.Dx()-cropSize)/2,
		Y: bounds.Min.Y + (bounds.Dy()-cropSize)/2,
	}
	cropped := image.NewRGBA(image.Rect(0, 0, cropSize, cropSize))
	draw.Draw(cropped, cropped.Bounds(), decoded, origin, draw.Src)

	encodedContentType := normalizedContentType
	var encoded bytes.Buffer
	switch normalizedContentType {
	case "image/jpeg":
		if err := jpeg.Encode(&encoded, cropped, &jpeg.Options{Quality: 90}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, errors.New("failed to encode icon image"))
		}
	case "image/png":
		if err := png.Encode(&encoded, cropped); err != nil {
			return nil, connect.NewError(connect.CodeInternal, errors.New("failed to encode icon image"))
		}
	default:
		encodedContentType = "image/png"
		if err := png.Encode(&encoded, cropped); err != nil {
			return nil, connect.NewError(connect.CodeInternal, errors.New("failed to encode icon image"))
		}
	}

	return &normalizedCreatorIconImage{
		ContentType: encodedContentType,
		Data:        encoded.Bytes(),
		Height:      int32(cropSize),
		Width:       int32(cropSize),
	}, nil
}

func extensionFromContentType(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func (s *adminServer) createCreatorIconImage(ctx context.Context, tenant dbmodels.Tenant, creatorID uuid.UUID, creatorPublicID string, image *normalizedCreatorIconImage) (uuid.NullUUID, error) {
	if image == nil {
		return uuid.NullUUID{}, nil
	}
	if s.storage == nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	creatorImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	createdImage, err := s.queriesFor(ctx).CreateCreatorImage(ctx, dbmodels.CreateCreatorImageParams{
		ID:        creatorImageID,
		TenantID:  tenant.ID,
		CreatorID: creatorID,
	})
	if err != nil {
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create creator image", err, "tenant_id", tenant.ID.String(), "creator_id", creatorID.String())
	}

	objectKey := fmt.Sprintf("tenants/%s/creators/%s/%s-original%s", tenant.PublicID, creatorPublicID, createdImage.ID.String(), extensionFromContentType(image.ContentType))
	uploaded, err := s.storage.Upload(ctx, storage.UploadRequest{
		ObjectKey:   objectKey,
		ContentType: image.ContentType,
		Data:        image.Data,
	})
	if err != nil {
		return uuid.NullUUID{}, storageUploadError(err)
	}

	creatorImageVariantID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	_, err = s.queriesFor(ctx).CreateCreatorImageVariant(ctx, dbmodels.CreateCreatorImageVariantParams{
		ID:              creatorImageVariantID,
		TenantID:        tenant.ID,
		CreatorImageID:  createdImage.ID,
		Label:           "original",
		StorageProvider: uploaded.Provider,
		ObjectKey:       uploaded.ObjectKey,
		ContentType:     image.ContentType,
		FileSizeBytes:   uploaded.SizeBytes,
		Width:           image.Width,
		Height:          image.Height,
	})
	if err != nil {
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create creator image variant", err, "tenant_id", tenant.ID.String(), "creator_image_id", createdImage.ID.String())
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
}

func normalizeLabelEyeCatchImage(data []byte, contentType string) (*normalizedEyeCatchImage, error) {
	return normalizeSeriesEyeCatchImage(data, contentType)
}

func (s *adminServer) createLabelEyeCatchImage(ctx context.Context, tenant dbmodels.Tenant, labelID uuid.UUID, labelPublicID string, image *normalizedEyeCatchImage) (uuid.NullUUID, error) {
	if image == nil {
		return uuid.NullUUID{}, nil
	}
	if s.storage == nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	labelImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	createdImage, err := s.queriesFor(ctx).CreateLabelImage(ctx, dbmodels.CreateLabelImageParams{
		ID:       labelImageID,
		TenantID: tenant.ID,
		LabelID:  labelID,
	})
	if err != nil {
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create label image", err, "tenant_id", tenant.ID.String(), "label_id", labelID.String())
	}

	variants, err := imageproc.BuildEyeCatchVariants(image.Data, image.ContentType)
	if err != nil {
		return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "eye_catch_image_data")
	}

	for _, variant := range variants {
		objectKey := fmt.Sprintf(
			"tenants/%s/labels/%s/%s-%s%s",
			tenant.PublicID,
			labelPublicID,
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
			return uuid.NullUUID{}, storageUploadError(uploadErr)
		}

		labelImageVariantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, variantIDErr)
		}

		_, createVariantErr := s.queriesFor(ctx).CreateLabelImageVariant(ctx, dbmodels.CreateLabelImageVariantParams{
			ID:              labelImageVariantID,
			TenantID:        tenant.ID,
			LabelImageID:    createdImage.ID,
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
			return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create label image variant", createVariantErr, "tenant_id", tenant.ID.String(), "label_image_id", createdImage.ID.String())
		}
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
}

func mapLabelEyeCatchVariants(labelImageID uuid.UUID, rows []dbmodels.ListLabelImageVariantsByImageIDsRow) []*publirattypesv1.SeriesEyeCatchVariant {
	items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(rows))
	for _, row := range rows {
		items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/labels/%s/%s/%d", labelImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return items
}

func (s *adminServer) labelEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListLabelImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list label image variants", err)
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListLabelImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.LabelImageID] = append(byImageID[row.LabelImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		mapped[imageID] = mapLabelEyeCatchVariants(imageID, variants)
	}

	return mapped, nil
}

func (s *adminServer) labelPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]labelPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListLabelsByTenantAsc(ctx, dbmodels.ListLabelsByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapLabelAscRows(rows), nil
	}

	rows, err := queries.ListLabelsByTenantDesc(ctx, dbmodels.ListLabelsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapLabelDescRows(rows), nil
}

func (s *adminServer) creatorPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]creatorPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListCreatorsByTenantAsc(ctx, dbmodels.ListCreatorsByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapCreatorAscRows(rows), nil
	}

	rows, err := queries.ListCreatorsByTenantDesc(ctx, dbmodels.ListCreatorsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapCreatorDescRows(rows), nil
}

func (s *adminServer) ListCreators(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCreatorsRequest],
) (*connect.Response[publiraadminv1.ListCreatorsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCreatorPageSize, maxCreatorPageSize)
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

	rows, err := s.creatorPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creators", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Creator, 0, len(rows))
	for _, row := range rows {
		items = append(items, protomapper.CreatorFromRow(
			row.publicID,
			row.name,
			row.profileText.String,
			row.iconImageID,
			row.iconImageFileSizeBytes,
			row.iconImageUpdatedAt,
		))
	}

	res := &publiraadminv1.ListCreatorsResponse{Creators: items}
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
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *adminServer) GetCreator(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetCreatorRequest],
) (*connect.Response[publiraadminv1.GetCreatorResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	// Another tenant's creator is filtered out by the query's tenant_id, so it
	// lands on the same not_found as a missing one and never leaks that the
	// record exists.
	row, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get creator", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetCreatorResponse{Creator: protomapper.CreatorFromRow(
		row.PublicID,
		row.Name,
		row.ProfileText.String,
		row.IconImageID,
		row.IconImageFileSizeBytes,
		row.IconImageUpdatedAt,
	)}), nil
}

func (s *adminServer) ListLabels(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListLabelsRequest],
) (*connect.Response[publiraadminv1.ListLabelsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultLabelPageSize, maxLabelPageSize)
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

	rows, err := s.labelPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list labels", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Label, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0, len(rows))
	itemByImageID := make(map[uuid.UUID]*publirattypesv1.Label, len(rows))
	for _, row := range rows {
		item := protomapper.LabelWithImage(row.publicID, row.name, row.eyeCatchImageUpdatedAt, nil)
		items = append(items, item)
		if row.eyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.eyeCatchImageID.UUID)
			itemByImageID[row.eyeCatchImageID.UUID] = item
		}
	}
	variantsByImageID, err := s.labelEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range variantsByImageID {
		if item, ok := itemByImageID[imageID]; ok {
			item.EyeCatchImageVariants = variants
		}
	}

	res := &publiraadminv1.ListLabelsResponse{Labels: items}
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

func (s *adminServer) GetLabel(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetLabelRequest],
) (*connect.Response[publiraadminv1.GetLabelResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	// Another tenant's label is filtered out by the query's tenant_id, so it
	// lands on the same not_found as a missing one and never leaks that the
	// record exists.
	row, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get label", err, "tenant_id", tenant.ID.String())
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	return connect.NewResponse(&publiraadminv1.GetLabelResponse{Label: protomapper.LabelWithImage(row.PublicID, row.Name, row.EyeCatchImageUpdatedAt, variants)}), nil
}

// creatorRevalidateTags names what web-host caches a creator under. The author
// list and the author detail page read it under `:authors`, and so do the
// series lists that print creator names on their cards; the series detail page
// prints them too and is only reachable under `:series:detail`, so a rename
// that stopped at `:authors` would leave the previous name on that page until
// the entry expired on its own.
func creatorRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:authors", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

func (s *adminServer) CreateCreator(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateCreatorRequest],
) (*connect.Response[publiraadminv1.CreateCreatorResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}

	iconImage, err := normalizeCreatorIconImage(req.Msg.IconImageData, req.Msg.IconImageContentType)
	if err != nil {
		return nil, err
	}

	creatorID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	createdBase, err := publicid.Insert(func(publicID string) (dbmodels.Creator, error) {
		return s.queriesFor(ctx).CreateCreator(ctx, dbmodels.CreateCreatorParams{
			ID:          creatorID,
			TenantID:    tenant.ID,
			PublicID:    publicID,
			Name:        req.Msg.Name,
			ProfileText: sql.NullString{String: req.Msg.ProfileText, Valid: strings.TrimSpace(req.Msg.ProfileText) != ""},
			IconImageID: uuid.NullUUID{},
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create creator", err, "tenant_id", tenant.ID.String())
	}

	iconImageID, err := s.createCreatorIconImage(ctx, tenant, createdBase.ID, createdBase.PublicID, iconImage)
	if err != nil {
		return nil, err
	}
	if iconImageID.Valid {
		if err := s.queriesFor(ctx).UpdateCreator(ctx, dbmodels.UpdateCreatorParams{
			ID:          createdBase.ID,
			Name:        createdBase.Name,
			ProfileText: createdBase.ProfileText,
			IconImageID: iconImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update creator icon", err, "tenant_id", tenant.ID.String(), "creator_id", createdBase.ID.String())
		}
	}
	created, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: createdBase.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created creator", err, "tenant_id", tenant.ID.String(), "creator_public_id", createdBase.PublicID)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_created",
			TargetType:  "creator",
			TargetID:    createdBase.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, creatorRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after creator create", "tenant_public_id", tenant.PublicID, "creator_public_id", created.PublicID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.CreateCreatorResponse{Creator: protomapper.CreatorFromRow(
		created.PublicID,
		created.Name,
		created.ProfileText.String,
		created.IconImageID,
		created.IconImageFileSizeBytes,
		created.IconImageUpdatedAt,
	)}), nil
}

func (s *adminServer) UpdateCreator(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateCreatorRequest],
) (*connect.Response[publiraadminv1.UpdateCreatorResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	if req.Msg.ClearIconImage && len(req.Msg.IconImageData) > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("clear_icon_image and icon_image_data cannot be used together"))
	}
	iconImage, err := normalizeCreatorIconImage(req.Msg.IconImageData, req.Msg.IconImageContentType)
	if err != nil {
		return nil, err
	}

	current, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get creator for update", err, "tenant_id", tenant.ID.String(), "creator_public_id", req.Msg.PublicId)
	}
	iconImageID := current.IconImageID
	if req.Msg.ClearIconImage {
		iconImageID = uuid.NullUUID{}
	} else if iconImage != nil {
		newIconImageID, uploadErr := s.createCreatorIconImage(ctx, tenant, current.ID, current.PublicID, iconImage)
		if uploadErr != nil {
			return nil, uploadErr
		}
		iconImageID = newIconImageID
	}

	err = s.queriesFor(ctx).UpdateCreator(ctx, dbmodels.UpdateCreatorParams{
		ID:          current.ID,
		Name:        req.Msg.Name,
		ProfileText: sql.NullString{String: req.Msg.ProfileText, Valid: strings.TrimSpace(req.Msg.ProfileText) != ""},
		IconImageID: iconImageID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update creator", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}
	updated, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get updated creator", err, "tenant_id", tenant.ID.String(), "creator_public_id", req.Msg.PublicId)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_updated",
			TargetType:  "creator",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, creatorRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after creator update", "tenant_public_id", tenant.PublicID, "creator_public_id", updated.PublicID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.UpdateCreatorResponse{Creator: protomapper.CreatorFromRow(
		updated.PublicID,
		updated.Name,
		updated.ProfileText.String,
		updated.IconImageID,
		updated.IconImageFileSizeBytes,
		updated.IconImageUpdatedAt,
	)}), nil
}

// labelRevalidateTags names what web-host caches a label under. The label list
// and the label detail page read it under `:labels`, and every series card and
// series detail page renders the name of the series' label, so a rename that
// stopped at `:labels` would leave the previous name on the storefront until
// those entries expired on their own.
func labelRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:labels", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

func (s *adminServer) CreateLabel(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateLabelRequest],
) (*connect.Response[publiraadminv1.CreateLabelResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	eyeCatchImage, err := normalizeLabelEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	labelID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	createdBase, err := publicid.Insert(func(publicID string) (dbmodels.Label, error) {
		return s.queriesFor(ctx).CreateLabel(ctx, dbmodels.CreateLabelParams{
			ID:              labelID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			Name:            req.Msg.Name,
			EyeCatchImageID: uuid.NullUUID{},
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create label", err, "tenant_id", tenant.ID.String())
	}
	eyeCatchImageID, err := s.createLabelEyeCatchImage(ctx, tenant, createdBase.ID, createdBase.PublicID, eyeCatchImage)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(ctx).UpdateLabel(ctx, dbmodels.UpdateLabelParams{
			ID:              createdBase.ID,
			Name:            createdBase.Name,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update label eye catch image", err, "tenant_id", tenant.ID.String(), "label_id", createdBase.ID.String())
		}
	}
	created, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: createdBase.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created label", err, "tenant_id", tenant.ID.String(), "label_public_id", createdBase.PublicID)
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if created.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{created.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[created.EyeCatchImageID.UUID]
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_created",
			TargetType:  "label",
			TargetID:    created.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, labelRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after label create", "tenant_public_id", tenant.PublicID, "label_public_id", created.PublicID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.CreateLabelResponse{Label: protomapper.LabelWithImage(created.PublicID, created.Name, created.EyeCatchImageUpdatedAt, variants)}), nil
}

func (s *adminServer) UpdateLabel(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateLabelRequest],
) (*connect.Response[publiraadminv1.UpdateLabelResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	if req.Msg.ClearEyeCatchImage && len(req.Msg.EyeCatchImageData) > 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"), "eye_catch_image_data")
	}
	eyeCatchImage, err := normalizeLabelEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	current, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get label for update", err, "tenant_id", tenant.ID.String(), "label_public_id", req.Msg.PublicId)
	}
	eyeCatchImageID := current.EyeCatchImageID
	if req.Msg.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if eyeCatchImage != nil {
		newEyeCatchImageID, uploadErr := s.createLabelEyeCatchImage(ctx, tenant, current.ID, current.PublicID, eyeCatchImage)
		if uploadErr != nil {
			return nil, uploadErr
		}
		eyeCatchImageID = newEyeCatchImageID
	}
	err = s.queriesFor(ctx).UpdateLabel(ctx, dbmodels.UpdateLabelParams{ID: current.ID, Name: req.Msg.Name, EyeCatchImageID: eyeCatchImageID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update label", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	updated, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get updated label", err, "tenant_id", tenant.ID.String(), "label_public_id", req.Msg.PublicId)
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if updated.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{updated.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[updated.EyeCatchImageID.UUID]
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_updated",
			TargetType:  "label",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, labelRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after label update", "tenant_public_id", tenant.PublicID, "label_public_id", updated.PublicID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.UpdateLabelResponse{Label: protomapper.LabelWithImage(updated.PublicID, updated.Name, updated.EyeCatchImageUpdatedAt, variants)}), nil
}
