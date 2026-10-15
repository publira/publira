package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
)

// An episode's own eye-catch is the series eye-catch's pipeline under an
// episode: the same four ratios, the same widths, and the same per-ratio
// replacement. It is optional, and a client draws the series' eye-catch for
// an episode that has none, so nothing here falls back to the series.

// episodeEyeCatchObjectPath is the directory under the tenant that an
// episode's eye-catch objects are stored in, named like the route that
// delivers them.
const episodeEyeCatchObjectPath = protomapper.EpisodeEyeCatchCollection

func (s *adminServer) UploadEpisodeEyeCatchImage(
	ctx context.Context,
	req *publiraadminv1.UploadEpisodeEyeCatchImageRequest,
) (*publiraadminv1.UploadEpisodeEyeCatchImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
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
	// Cut before the transaction, so a refused image costs no database work
	// and the cut does not run while the episode row is held.
	variants, err := imageproc.BuildEyeCatchVariants(image.Data, image.ContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockEpisodeEyeCatch(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		imageID, err := s.createEpisodeEyeCatchImage(txCtx, tenant, current.ID, current.PublicID, variants)
		if err != nil {
			return nil, err
		}
		if err := s.queriesFor(txCtx).SetEpisodeEyeCatchImageIDForTenant(txCtx, dbmodels.SetEpisodeEyeCatchImageIDForTenantParams{
			TenantID:        tenant.ID,
			ID:              current.ID,
			EyeCatchImageID: uuid.NullUUID{UUID: imageID, Valid: true},
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to point the episode at its eye catch image", err, "tenant_id", tenant.ID.String(), "episode_id", current.ID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	s.recordEpisodeUpdated(ctx, tenant.ID, publicID)

	episode, err := s.episodeAfterEyeCatchWrite(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadEpisodeEyeCatchImageResponse{Episode: episode}, nil
}

func (s *adminServer) UploadEpisodeEyeCatchAspectImage(
	ctx context.Context,
	req *publiraadminv1.UploadEpisodeEyeCatchAspectImageRequest,
) (*publiraadminv1.UploadEpisodeEyeCatchAspectImageResponse, error) {
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
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}

	current, err := s.episodeEyeCatch(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	// A ratio replaces one slot of an eye-catch the episode already has, as it
	// does for a series: the other three would otherwise hold nothing.
	if !current.EyeCatchImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "episode has no eye catch image yet")
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType, imageCropRect(req.Crop))
	if err != nil {
		return nil, eyeCatchAspectBuildError(err)
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		// Serialized and re-read behind the lock, like the series upload: a
		// whole eye-catch upload may have repointed the episode while this one
		// waited.
		locked, err := s.lockEpisodeEyeCatch(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		if !locked.EyeCatchImageID.Valid {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "episode has no eye catch image yet")
		}

		imageID := locked.EyeCatchImageID.UUID
		if _, err := s.queriesFor(txCtx).DeleteEpisodeEyeCatchImageVariantsByType(txCtx, dbmodels.DeleteEpisodeEyeCatchImageVariantsByTypeParams{
			EpisodeEyeCatchImageID: imageID,
			VariantType:            aspect.VariantType,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to clear episode eye catch variants for aspect", err, "tenant_id", tenant.ID.String(), "episode_eye_catch_image_id", imageID.String())
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
				ObjectKey:   aspectImageObjectKey(tenant.PublicID, episodeEyeCatchObjectPath, locked.PublicID, imageID, uploadID, variant),
				ContentType: variant.ContentType,
				Data:        variant.Data,
			})
			if uploadErr != nil {
				return nil, storageUploadError(uploadErr)
			}
			if err := s.createEpisodeEyeCatchVariant(txCtx, tenant.ID, imageID, variant, uploaded); err != nil {
				return nil, err
			}
		}
		if err := s.queriesFor(txCtx).TouchEpisodeEyeCatchImage(txCtx, imageID); err != nil {
			return nil, s.internalDBError(ctx, "failed to touch episode eye catch image", err, "tenant_id", tenant.ID.String(), "episode_eye_catch_image_id", imageID.String())
		}
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	s.recordEyeCatchAspectAudit(ctx, tenant.ID, "episode", current.PublicID, "episode_eye_catch_aspect_image_uploaded", aspect.VariantType)

	episode, err := s.episodeAfterEyeCatchWrite(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadEpisodeEyeCatchAspectImageResponse{Episode: episode}, nil
}

func (s *adminServer) DeleteEpisodeEyeCatchImage(
	ctx context.Context,
	req *publiraadminv1.DeleteEpisodeEyeCatchImageRequest,
) (*publiraadminv1.DeleteEpisodeEyeCatchImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}

	var publicID string
	var removed bool
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockEpisodeEyeCatch(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if !current.EyeCatchImageID.Valid {
			return nil, nil
		}
		// The image row stays behind, unreferenced, for the orphan image sweep
		// to take with its objects.
		if err := s.queriesFor(txCtx).SetEpisodeEyeCatchImageIDForTenant(txCtx, dbmodels.SetEpisodeEyeCatchImageIDForTenantParams{
			TenantID: tenant.ID,
			ID:       current.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to clear the episode eye catch image", err, "tenant_id", tenant.ID.String(), "episode_id", current.ID.String())
		}
		removed = true
		return episodeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}
	if removed {
		s.recordEpisodeUpdated(ctx, tenant.ID, publicID)
	}

	episode, err := s.episodeAfterEyeCatchWrite(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteEpisodeEyeCatchImageResponse{Episode: episode}, nil
}

// episodeEyeCatch reads the eye-catch an episode shows, answering not_found
// for an episode of another tenant or none at all.
func (s *adminServer) episodeEyeCatch(ctx context.Context, tenantID, episodeID uuid.UUID) (dbmodels.GetEpisodeEyeCatchImageIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetEpisodeEyeCatchImageIDForTenant(ctx, dbmodels.GetEpisodeEyeCatchImageIDForTenantParams{TenantID: tenantID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetEpisodeEyeCatchImageIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return dbmodels.GetEpisodeEyeCatchImageIDForTenantRow{}, s.internalDBError(ctx, "failed to get episode eye catch image", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	return row, nil
}

// lockEpisodeEyeCatch locks the episode row and then reads its eye-catch as a
// separate statement, so two writes to one episode's eye-catch serialize and
// the second sees what the first committed.
func (s *adminServer) lockEpisodeEyeCatch(ctx context.Context, tenantID, episodeID uuid.UUID) (dbmodels.GetEpisodeEyeCatchImageIDForTenantRow, error) {
	if _, err := s.queriesFor(ctx).LockEpisodeByIDForTenant(ctx, dbmodels.LockEpisodeByIDForTenantParams{TenantID: tenantID, ID: episodeID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetEpisodeEyeCatchImageIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return dbmodels.GetEpisodeEyeCatchImageIDForTenantRow{}, s.internalDBError(ctx, "failed to lock episode for its eye catch image", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	return s.episodeEyeCatch(ctx, tenantID, episodeID)
}

// createEpisodeEyeCatchImage stores a whole eye-catch, every ratio and width
// of it, as a new image the caller then points the episode at.
func (s *adminServer) createEpisodeEyeCatchImage(ctx context.Context, tenant dbmodels.Tenant, episodeID uuid.UUID, episodePublicID string, variants []imageproc.Variant) (uuid.UUID, error) {
	imageID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if _, err := s.queriesFor(ctx).CreateEpisodeEyeCatchImage(ctx, dbmodels.CreateEpisodeEyeCatchImageParams{
		ID:        imageID,
		TenantID:  tenant.ID,
		EpisodeID: episodeID,
	}); err != nil {
		return uuid.Nil, s.internalDBError(ctx, "failed to create episode eye catch image", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}

	store, err := storage.Pin(ctx, s.storage)
	if err != nil {
		return uuid.Nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(ctx, storage.UploadRequest{
			ObjectKey: fmt.Sprintf(
				"tenants/%s/%s/%s/%s-%s%s",
				tenant.PublicID,
				episodeEyeCatchObjectPath,
				episodePublicID,
				imageID.String(),
				variant.Label,
				variant.Extension,
			),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return uuid.Nil, storageUploadError(uploadErr)
		}
		if err := s.createEpisodeEyeCatchVariant(ctx, tenant.ID, imageID, variant, uploaded); err != nil {
			return uuid.Nil, err
		}
	}
	return imageID, nil
}

func (s *adminServer) createEpisodeEyeCatchVariant(ctx context.Context, tenantID, imageID uuid.UUID, variant imageproc.Variant, uploaded storage.UploadResult) error {
	variantID, err := uuid.NewV7()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if _, err := s.queriesFor(ctx).CreateEpisodeEyeCatchImageVariant(ctx, dbmodels.CreateEpisodeEyeCatchImageVariantParams{
		ID:                     variantID,
		TenantID:               tenantID,
		EpisodeEyeCatchImageID: imageID,
		VariantType:            variant.VariantType,
		Label:                  variant.Label,
		StorageProvider:        uploaded.Provider,
		ObjectKey:              uploaded.ObjectKey,
		ContentType:            variant.ContentType,
		FileSizeBytes:          uploaded.SizeBytes,
		Width:                  int32(variant.Width),
		Height:                 int32(variant.Height),
	}); err != nil {
		return s.internalDBError(ctx, "failed to create episode eye catch variant", err, "tenant_id", tenantID.String(), "episode_eye_catch_image_id", imageID.String())
	}
	return nil
}

// episodeAfterEyeCatchWrite re-reads the episode in the shape the other
// episode writes answer with, so the response carries the variants delivery
// now serves.
func (s *adminServer) episodeAfterEyeCatchWrite(ctx context.Context, tenantID, episodeID uuid.UUID) (*publirattypesv1.Episode, error) {
	row, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenantID, ID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get episode after its eye catch image changed", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	episode := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(row)
	if err := setEpisodeAvailability(episode, row.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenantID.String(), "episode_public_id", row.PublicID)
	}
	if _, err := episodePurchaseAvailability(episode, row.PurchaseAvailability, row.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenantID.String(), "episode_public_id", row.PublicID)
	}
	if err := s.fillEpisodeEyeCatches(ctx, tenantID, episode); err != nil {
		return nil, err
	}
	return episode, nil
}

// fillEpisodeEyeCatches puts each episode's own eye-catch onto it, whichever
// query read the episodes, with one statement for all of them.
func (s *adminServer) fillEpisodeEyeCatches(ctx context.Context, tenantID uuid.UUID, episodes ...*publirattypesv1.Episode) error {
	if len(episodes) == 0 {
		return nil
	}
	ids, err := protomapper.EpisodeIDs(episodes)
	if err != nil {
		return s.internalError(ctx, "episode response carries an id that is not one", err, "tenant_id", tenantID.String())
	}
	rows, err := s.queriesFor(ctx).ListEpisodeEyeCatchVariantsByEpisodeIDs(ctx, dbmodels.ListEpisodeEyeCatchVariantsByEpisodeIDsParams{
		TenantID:   tenantID,
		EpisodeIds: ids,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to list episode eye catch variants", err, "tenant_id", tenantID.String())
	}
	protomapper.SetEpisodeEyeCatches(episodes, rows)
	return nil
}
