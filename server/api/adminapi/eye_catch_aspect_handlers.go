package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

// An eye-catch holds one image per aspect ratio, and the ratios are
// independent: nothing records where a ratio's image came from, and no ratio
// stands in for another. Uploading an image for one ratio replaces that
// ratio's rows and leaves the rest untouched; uploading a whole eye-catch
// crops all four out of the one image at that moment and stores each as its
// own ratio, keeping no reference back to what it was cropped from.

// resolveEyeCatchAspect reads the requested ratio, naming the ratios that do
// exist when it is not one of them: the caller is a console picking from a
// fixed set, so a miss is a bug worth reading in the error.
func resolveEyeCatchAspect(variantType string) (imageproc.EyeCatchAspect, error) {
	aspects := imageproc.EyeCatchAspects()
	if aspect, ok := imageproc.LookupEyeCatchAspect(strings.TrimSpace(variantType)); ok {
		return aspect, nil
	}
	known := make([]string, 0, len(aspects))
	for _, candidate := range aspects {
		known = append(known, candidate.VariantType)
	}
	return imageproc.EyeCatchAspect{}, rpcerrors.NewFieldViolationError(
		connect.CodeInvalidArgument,
		fmt.Errorf("variant_type must be one of %s", strings.Join(known, ", ")),
		"variant_type",
	)
}

// aspectImageObjectKey names the object of one delivered size of a ratio.
// `uploadID` is new on every upload, so replacing a ratio writes new objects
// instead of overwriting the ones the previous rows still name — those rows
// are what `batch purge-orphan-images` reads to decide an object is garbage.
func aspectImageObjectKey(tenantPublicID, entityPath, entityPublicID string, imageID, uploadID uuid.UUID, variant imageproc.Variant) string {
	return fmt.Sprintf(
		"tenants/%s/%s/%s/%s-%s-%s%s",
		tenantPublicID,
		entityPath,
		entityPublicID,
		imageID.String(),
		uploadID.String(),
		variant.Label,
		variant.Extension,
	)
}

func (s *adminServer) UploadSeriesEyeCatchAspectImage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadSeriesEyeCatchAspectImageRequest],
) (*connect.Response[publiraadminv1.UploadSeriesEyeCatchAspectImageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.Msg.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.Msg.ImageData, req.Msg.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	current, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.PublicId)
	}
	// A ratio image replaces one slot of an existing eye-catch. Creating the
	// eye-catch from a single ratio would leave the other three with no image
	// at all, so the eye-catch has to be there first.
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("series has no eye catch image yet"))
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin series eye catch aspect upload transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Two uploads racing on the same ratio would both clear it and then both
	// insert the same (image, ratio, width), and the loser fails its unique
	// index after it has already written its objects. The lock serializes
	// them; the eye-catch is re-read behind it as a separate statement,
	// because READ COMMITTED froze the read above before the wait and a whole
	// eye-catch replacement may have repointed it since.
	if _, err := s.queriesFor(txCtx).LockSeriesByPublicIDForTenant(txCtx, dbmodels.LockSeriesByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: current.PublicID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	locked, err := s.queriesFor(txCtx).GetSeriesByPublicIDForTenant(txCtx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: current.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to re-read series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	if !locked.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("series has no eye catch image yet"))
	}

	imageID := locked.EyeCatchImageID.UUID
	if _, err := s.queriesFor(txCtx).DeleteSeriesImageVariantsByType(txCtx, dbmodels.DeleteSeriesImageVariantsByTypeParams{
		SeriesImageID: imageID,
		VariantType:   aspect.VariantType,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to clear series image variants for aspect", err, "tenant_id", tenant.ID.String(), "series_image_id", imageID.String())
	}

	uploadID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := s.storage.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, "series", current.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, variantIDErr)
		}
		if _, createErr := s.queriesFor(txCtx).CreateSeriesImageVariant(txCtx, dbmodels.CreateSeriesImageVariantParams{
			ID:              variantID,
			TenantID:        tenant.ID,
			SeriesImageID:   imageID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		}); createErr != nil {
			return nil, s.internalDBError(ctx, "failed to create series image variant for aspect", createErr, "tenant_id", tenant.ID.String(), "series_image_id", imageID.String())
		}
	}
	if err := s.queriesFor(txCtx).TouchSeriesImage(txCtx, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to touch series image", err, "tenant_id", tenant.ID.String(), "series_image_id", imageID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit series eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}

	s.recordEyeCatchAspectAudit(ctx, req.Header(), tenant.ID, "series", current.PublicID, "series_eye_catch_aspect_image_uploaded", aspect.VariantType)
	if s.reval != nil && current.IsPublished {
		if revalErr := s.reval.RevalidateTags(ctx, seriesRevalidateTags(tenant.ID.String(), current.PublicID)); revalErr != nil {
			s.logger.Warn("failed to request next revalidate after series eye catch aspect upload", "tenant_public_id", tenant.PublicID, "series_public_id", current.PublicID, "error", revalErr)
		}
	}

	series, err := s.seriesWithEyeCatchVariants(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.UploadSeriesEyeCatchAspectImageResponse{Series: series}), nil
}

// seriesWithEyeCatchVariants re-reads the series so the response carries the
// variant list delivery would now serve.
func (s *adminServer) seriesWithEyeCatchVariants(ctx context.Context, tenantID uuid.UUID, publicID string) (*publirattypesv1.Series, error) {
	row, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenantID, PublicID: publicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series after eye catch aspect upload", err, "tenant_id", tenantID.String(), "series_public_id", publicID)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	series := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(row)
	series.Creators = creatorsBySeriesID[row.ID]
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	return series, nil
}

func (s *adminServer) UploadLabelEyeCatchAspectImage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UploadLabelEyeCatchAspectImageRequest],
) (*connect.Response[publiraadminv1.UploadLabelEyeCatchAspectImageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.Msg.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.Msg.ImageData, req.Msg.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	current, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get label for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_public_id", req.Msg.PublicId)
	}
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("label has no eye catch image yet"))
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin label eye catch aspect upload transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Serialized and re-read behind the lock, like the series upload above.
	if _, err := s.queriesFor(txCtx).LockLabelByPublicIDForTenant(txCtx, dbmodels.LockLabelByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: current.PublicID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock label for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	locked, err := s.queriesFor(txCtx).GetLabelByPublicIDForTenant(txCtx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: current.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to re-read label for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	if !locked.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("label has no eye catch image yet"))
	}

	imageID := locked.EyeCatchImageID.UUID
	if _, err := s.queriesFor(txCtx).DeleteLabelImageVariantsByType(txCtx, dbmodels.DeleteLabelImageVariantsByTypeParams{
		LabelImageID: imageID,
		VariantType:  aspect.VariantType,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to clear label image variants for aspect", err, "tenant_id", tenant.ID.String(), "label_image_id", imageID.String())
	}

	uploadID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := s.storage.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, "labels", current.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, variantIDErr)
		}
		if _, createErr := s.queriesFor(txCtx).CreateLabelImageVariant(txCtx, dbmodels.CreateLabelImageVariantParams{
			ID:              variantID,
			TenantID:        tenant.ID,
			LabelImageID:    imageID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		}); createErr != nil {
			return nil, s.internalDBError(ctx, "failed to create label image variant for aspect", createErr, "tenant_id", tenant.ID.String(), "label_image_id", imageID.String())
		}
	}
	if err := s.queriesFor(txCtx).TouchLabelImage(txCtx, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to touch label image", err, "tenant_id", tenant.ID.String(), "label_image_id", imageID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit label eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}

	s.recordEyeCatchAspectAudit(ctx, req.Header(), tenant.ID, "label", current.PublicID, "label_eye_catch_aspect_image_uploaded", aspect.VariantType)
	if s.reval != nil {
		if revalErr := s.reval.RevalidateTags(ctx, labelRevalidateTags(tenant.ID.String())); revalErr != nil {
			s.logger.Warn("failed to request next revalidate after label eye catch aspect upload", "tenant_public_id", tenant.PublicID, "label_public_id", current.PublicID, "error", revalErr)
		}
	}

	label, err := s.labelWithEyeCatchVariants(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.UploadLabelEyeCatchAspectImageResponse{Label: label}), nil
}

func (s *adminServer) labelWithEyeCatchVariants(ctx context.Context, tenantID uuid.UUID, publicID string) (*publirattypesv1.Label, error) {
	row, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenantID, PublicID: publicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get label after eye catch aspect upload", err, "tenant_id", tenantID.String(), "label_public_id", publicID)
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	return protomapper.LabelWithImage(row.PublicID, row.Name, row.EyeCatchImageUpdatedAt, variants), nil
}

// recordEyeCatchAspectAudit files the change under the entity it belongs to,
// with the ratio in the target so a reader can tell which slot moved.
func (s *adminServer) recordEyeCatchAspectAudit(ctx context.Context, header http.Header, tenantID uuid.UUID, targetType, entityPublicID, action, variantType string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  targetType,
		TargetID:    fmt.Sprintf("%s/%s", entityPublicID, variantType),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(header),
	})
}
