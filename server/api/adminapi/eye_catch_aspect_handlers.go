package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/revalidate"
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

// imageCropRect carries the requested rectangle into imageproc. A nil message
// keeps the centre crop, which is what every upload did before the rectangle
// existed. Every upload an editor can frame goes through it, whatever shape
// the image is cut to afterwards.
func imageCropRect(crop *publirattypesv1.ImageCropRect) *imageproc.CropRect {
	if crop == nil {
		return nil
	}
	return &imageproc.CropRect{
		X:      int(crop.GetX()),
		Y:      int(crop.GetY()),
		Width:  int(crop.GetWidth()),
		Height: int(crop.GetHeight()),
	}
}

// eyeCatchAspectBuildError reports a rejected upload against the field that
// caused it: the rectangle when the rectangle is at fault, and the image
// otherwise. Blaming image_data for a bad selection would ask an editor to
// replace a file that is fine.
func eyeCatchAspectBuildError(err error) error {
	field := "image_data"
	if errors.Is(err, imageproc.ErrInvalidCrop) {
		field = "crop"
	}
	return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, field)
}

// aspectImageObjectKey names the object of one delivered size of a ratio.
// `uploadID` is new on every upload, so replacing a ratio writes new objects
// instead of overwriting the ones the previous rows still name — those rows
// are what `publiractl job purge-orphan-images` reads to decide an object is garbage.
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
	req *publiraadminv1.UploadSeriesEyeCatchAspectImageRequest,
) (*publiraadminv1.UploadSeriesEyeCatchAspectImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.ImageData, req.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}

	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}
	current, err := s.queriesFor(ctx).GetSeriesByIDForTenant(ctx, dbmodels.GetSeriesByIDForTenantParams{TenantID: tenant.ID, ID: seriesID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "series not found")
		}
		return nil, s.internalDBError(ctx, "failed to get series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	// A ratio image replaces one slot of an existing eye-catch. Creating the
	// eye-catch from a single ratio would leave the other three with no image
	// at all, so the eye-catch has to be there first.
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "series has no eye catch image yet")
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType, imageCropRect(req.Crop))
	if err != nil {
		return nil, eyeCatchAspectBuildError(err)
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
	if _, err := s.queriesFor(txCtx).LockSeriesByIDForTenant(txCtx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       current.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	locked, err := s.queriesFor(txCtx).GetSeriesByIDForTenant(txCtx, dbmodels.GetSeriesByIDForTenantParams{TenantID: tenant.ID, ID: current.ID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to re-read series for eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	if !locked.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "series has no eye catch image yet")
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
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	store, err := storage.Pin(txCtx, s.storage)
	if err != nil {
		return nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, "series", current.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, variantIDErr.Error()).WithCause(variantIDErr)
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
	var owed revalidate.Owed
	if current.IsPublished {
		owed, err = s.recordRevalidation(txCtx, tenant.ID, seriesRevalidateTags(tenant.ID.String(), current.PublicID))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the series eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit series eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordEyeCatchAspectAudit(ctx, tenant.ID, "series", current.PublicID, "series_eye_catch_aspect_image_uploaded", aspect.VariantType)

	series, err := s.seriesWithEyeCatchVariants(ctx, tenant.ID, current.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadSeriesEyeCatchAspectImageResponse{Series: series}, nil
}

// seriesWithEyeCatchVariants re-reads the series so the response carries the
// variant list delivery would now serve.
func (s *adminServer) seriesWithEyeCatchVariants(ctx context.Context, tenantID, seriesID uuid.UUID) (*publirattypesv1.Series, error) {
	row, err := s.queriesFor(ctx).GetSeriesByIDForTenant(ctx, dbmodels.GetSeriesByIDForTenantParams{TenantID: tenantID, ID: seriesID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series after eye catch aspect upload", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	series, err := protomapper.SeriesFromGetSeriesByIDForTenantRow(row)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
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
	req *publiraadminv1.UploadLabelEyeCatchAspectImageRequest,
) (*publiraadminv1.UploadLabelEyeCatchAspectImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.ImageData, req.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}

	id, err := parseRecordID(req.LabelId, "label_id")
	if err != nil {
		return nil, err
	}
	current, err := s.labelByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "label has no eye catch image yet")
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType, imageCropRect(req.Crop))
	if err != nil {
		return nil, eyeCatchAspectBuildError(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin label eye catch aspect upload transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Serialized and re-read behind the lock, like the series upload above.
	if err := s.lockLabelByID(txCtx, tenant.ID, id); err != nil {
		return nil, err
	}
	locked, err := s.labelByID(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if !locked.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "label has no eye catch image yet")
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
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	store, err := storage.Pin(txCtx, s.storage)
	if err != nil {
		return nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, "labels", current.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, variantIDErr.Error()).WithCause(variantIDErr)
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
	owed, err := s.recordRevalidation(txCtx, tenant.ID, labelRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the label eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit label eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordEyeCatchAspectAudit(ctx, tenant.ID, "label", current.PublicID, "label_eye_catch_aspect_image_uploaded", aspect.VariantType)

	label, err := s.labelWithEyeCatchVariants(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadLabelEyeCatchAspectImageResponse{Label: label}, nil
}

func (s *adminServer) labelWithEyeCatchVariants(ctx context.Context, tenantID, id uuid.UUID) (*publirattypesv1.Label, error) {
	row, err := s.labelByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	return adminLabel(row.ID, protomapper.LabelWithImage(row.PublicID, row.Name, row.EyeCatchImageUpdatedAt, variants)), nil
}

// recordEyeCatchAspectAudit files the change under the entity it belongs to,
// with the ratio in the target so a reader can tell which slot moved.
func (s *adminServer) recordEyeCatchAspectAudit(ctx context.Context, tenantID uuid.UUID, targetType, entityPublicID, action, variantType string) {
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
		ClientIP:    clientip.FromContext(ctx),
	})
}

func (s *adminServer) UploadGenreEyeCatchAspectImage(
	ctx context.Context,
	req *publiraadminv1.UploadGenreEyeCatchAspectImageRequest,
) (*publiraadminv1.UploadGenreEyeCatchAspectImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.ImageData, req.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}

	id, err := parseRecordID(req.GenreId, "genre_id")
	if err != nil {
		return nil, err
	}
	current, err := s.genreByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "genre has no eye catch image yet")
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType, imageCropRect(req.Crop))
	if err != nil {
		return nil, eyeCatchAspectBuildError(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin genre eye catch aspect upload transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Serialized and re-read behind the lock, like the series upload above.
	if err := s.lockGenreByID(txCtx, tenant.ID, id); err != nil {
		return nil, err
	}
	locked, err := s.genreByID(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if !locked.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "genre has no eye catch image yet")
	}

	imageID := locked.EyeCatchImageID.UUID
	if _, err := s.queriesFor(txCtx).DeleteGenreImageVariantsByType(txCtx, dbmodels.DeleteGenreImageVariantsByTypeParams{
		GenreImageID: imageID,
		VariantType:  aspect.VariantType,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to clear genre image variants for aspect", err, "tenant_id", tenant.ID.String(), "genre_image_id", imageID.String())
	}

	uploadID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	store, err := storage.Pin(txCtx, s.storage)
	if err != nil {
		return nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, "genres", current.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return nil, connect.NewError(connect.CodeInternal, variantIDErr.Error()).WithCause(variantIDErr)
		}
		if _, createErr := s.queriesFor(txCtx).CreateGenreImageVariant(txCtx, dbmodels.CreateGenreImageVariantParams{
			ID:              variantID,
			TenantID:        tenant.ID,
			GenreImageID:    imageID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		}); createErr != nil {
			return nil, s.internalDBError(ctx, "failed to create genre image variant for aspect", createErr, "tenant_id", tenant.ID.String(), "genre_image_id", imageID.String())
		}
	}
	if err := s.queriesFor(txCtx).TouchGenreImage(txCtx, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to touch genre image", err, "tenant_id", tenant.ID.String(), "genre_image_id", imageID.String())
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, genreRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the genre eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit genre eye catch aspect upload", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordEyeCatchAspectAudit(ctx, tenant.ID, "genre", current.PublicID, "genre_eye_catch_aspect_image_uploaded", aspect.VariantType)

	genre, err := s.genreWithEyeCatch(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadGenreEyeCatchAspectImageResponse{Genre: genre}, nil
}
