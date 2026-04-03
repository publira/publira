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

	"connectrpc.com/connect"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	creatorIconMaxUploadBytes = 10 << 20
	creatorIconMinDimension   = 256
)

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
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	objectKey := fmt.Sprintf("tenants/%s/creators/%s/%s-original%s", tenant.PublicID, creatorPublicID, createdImage.ID.String(), extensionFromContentType(image.ContentType))
	uploaded, err := s.storage.Upload(ctx, storage.UploadRequest{
		ObjectKey:   objectKey,
		ContentType: image.ContentType,
		Data:        image.Data,
	})
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
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
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
}

func (s *adminServer) ListCreators(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCreatorsRequest],
) (*connect.Response[publiraadminv1.ListCreatorsResponse], error) {
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
	rows, err := s.queriesFor(ctx).ListCreatorsByTenant(ctx, dbmodels.ListCreatorsByTenantParams{TenantID: tenant.ID, Limit: limit, Offset: offset})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*publirattypesv1.Creator, 0, len(rows))
	for _, row := range rows {
		items = append(items, protomapper.CreatorFromRow(
			row.PublicID,
			row.Name,
			row.ProfileText.String,
			row.IconImageID,
			row.IconImageFileSizeBytes,
			row.IconImageUpdatedAt,
		))
	}
	return connect.NewResponse(&publiraadminv1.ListCreatorsResponse{Creators: items}), nil
}

func (s *adminServer) ListLabels(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListLabelsRequest],
) (*connect.Response[publiraadminv1.ListLabelsResponse], error) {
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
	for _, row := range rows {
		items = append(items, protomapper.Label(row.PublicID, row.Name))
	}
	return connect.NewResponse(&publiraadminv1.ListLabelsResponse{Labels: items}), nil
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
	publicID := generatePublicID()

	createdBase, err := s.queriesFor(ctx).CreateCreator(ctx, dbmodels.CreateCreatorParams{
		ID:          creatorID,
		TenantID:    tenant.ID,
		PublicID:    publicID,
		Name:        req.Msg.Name,
		ProfileText: sql.NullString{String: req.Msg.ProfileText, Valid: strings.TrimSpace(req.Msg.ProfileText) != ""},
		IconImageID: uuid.NullUUID{},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	created, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: createdBase.PublicID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
	return connect.NewResponse(&publiraadminv1.UpdateCreatorResponse{Creator: protomapper.CreatorFromRow(
		updated.PublicID,
		updated.Name,
		updated.ProfileText.String,
		updated.IconImageID,
		updated.IconImageFileSizeBytes,
		updated.IconImageUpdatedAt,
	)}), nil
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
	labelID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.queriesFor(ctx).CreateLabel(ctx, dbmodels.CreateLabelParams{
		ID:       labelID,
		TenantID: tenant.ID,
		PublicID: generatePublicID(),
		Name:     req.Msg.Name,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
	return connect.NewResponse(&publiraadminv1.CreateLabelResponse{Label: protomapper.Label(created.PublicID, created.Name)}), nil
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
	current, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	err = s.queriesFor(ctx).UpdateLabel(ctx, dbmodels.UpdateLabelParams{ID: current.ID, Name: req.Msg.Name})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	updated, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
	return connect.NewResponse(&publiraadminv1.UpdateLabelResponse{Label: protomapper.Label(updated.PublicID, updated.Name)}), nil
}
