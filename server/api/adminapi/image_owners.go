package adminapi

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/ownerimages"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// Each aggregate an admin RPC stores an image for is an ownerimages.Owner over
// its own generated queries. What tells two of them apart is here; what they
// do with those queries is in ownerimages.

var genreImages = ownerimages.Owner[Querier]{
	Collection: "genres",
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateGenreImage(ctx, dbmodels.CreateGenreImageParams{ID: image.ID, TenantID: image.TenantID, GenreID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateGenreImageVariant(ctx, dbmodels.CreateGenreImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, GenreImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	ListVariants: func(ctx context.Context, q Querier, _ uuid.UUID, imageIDs []uuid.UUID) ([]ownerimages.Variant, error) {
		rows, err := q.ListGenreImageVariantsByImageIDs(ctx, imageIDs)
		return mapRows(rows, func(row dbmodels.ListGenreImageVariantsByImageIDsRow) ownerimages.Variant {
			return ownerimages.Variant{ID: row.ID, ImageID: row.GenreImageID, VariantType: row.VariantType, Label: row.Label, ContentType: row.ContentType, FileSizeBytes: row.FileSizeBytes, Width: row.Width, Height: row.Height}
		}), err
	},
	DeleteVariantsOfType: func(ctx context.Context, q Querier, imageID uuid.UUID, variantType string) error {
		_, err := q.DeleteGenreImageVariantsByType(ctx, dbmodels.DeleteGenreImageVariantsByTypeParams{GenreImageID: imageID, VariantType: variantType})
		return err
	},
	TouchImage: func(ctx context.Context, q Querier, imageID uuid.UUID) error {
		return q.TouchGenreImage(ctx, imageID)
	},
}

var seriesImages = ownerimages.Owner[Querier]{
	Collection: "series",
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateSeriesImage(ctx, dbmodels.CreateSeriesImageParams{ID: image.ID, TenantID: image.TenantID, SeriesID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateSeriesImageVariant(ctx, dbmodels.CreateSeriesImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, SeriesImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	ListVariants: func(ctx context.Context, q Querier, _ uuid.UUID, imageIDs []uuid.UUID) ([]ownerimages.Variant, error) {
		rows, err := q.ListSeriesImageVariantsByImageIDs(ctx, imageIDs)
		return mapRows(rows, func(row dbmodels.ListSeriesImageVariantsByImageIDsRow) ownerimages.Variant {
			return ownerimages.Variant{ID: row.ID, ImageID: row.SeriesImageID, VariantType: row.VariantType, Label: row.Label, ContentType: row.ContentType, FileSizeBytes: row.FileSizeBytes, Width: row.Width, Height: row.Height}
		}), err
	},
	DeleteVariantsOfType: func(ctx context.Context, q Querier, imageID uuid.UUID, variantType string) error {
		_, err := q.DeleteSeriesImageVariantsByType(ctx, dbmodels.DeleteSeriesImageVariantsByTypeParams{SeriesImageID: imageID, VariantType: variantType})
		return err
	},
	TouchImage: func(ctx context.Context, q Querier, imageID uuid.UUID) error {
		return q.TouchSeriesImage(ctx, imageID)
	},
}

var labelImages = ownerimages.Owner[Querier]{
	Collection: "labels",
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateLabelImage(ctx, dbmodels.CreateLabelImageParams{ID: image.ID, TenantID: image.TenantID, LabelID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateLabelImageVariant(ctx, dbmodels.CreateLabelImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, LabelImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	ListVariants: func(ctx context.Context, q Querier, _ uuid.UUID, imageIDs []uuid.UUID) ([]ownerimages.Variant, error) {
		rows, err := q.ListLabelImageVariantsByImageIDs(ctx, imageIDs)
		return mapRows(rows, func(row dbmodels.ListLabelImageVariantsByImageIDsRow) ownerimages.Variant {
			return ownerimages.Variant{ID: row.ID, ImageID: row.LabelImageID, VariantType: row.VariantType, Label: row.Label, ContentType: row.ContentType, FileSizeBytes: row.FileSizeBytes, Width: row.Width, Height: row.Height}
		}), err
	},
	DeleteVariantsOfType: func(ctx context.Context, q Querier, imageID uuid.UUID, variantType string) error {
		_, err := q.DeleteLabelImageVariantsByType(ctx, dbmodels.DeleteLabelImageVariantsByTypeParams{LabelImageID: imageID, VariantType: variantType})
		return err
	},
	TouchImage: func(ctx context.Context, q Querier, imageID uuid.UUID) error {
		return q.TouchLabelImage(ctx, imageID)
	},
}

// creatorImages holds a creator's icon: one square, stored as its original
// cut, which nothing replaces one ratio at a time.
var creatorImages = ownerimages.Owner[Querier]{
	Collection: "creators",
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateCreatorImage(ctx, dbmodels.CreateCreatorImageParams{ID: image.ID, TenantID: image.TenantID, CreatorID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateCreatorImageVariant(ctx, dbmodels.CreateCreatorImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, CreatorImageID: v.ImageID, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
}

// episodeEyeCatchImages is read by episode rather than by image, through
// fillEpisodeEyeCatches, so it lists nothing here.
var episodeEyeCatchImages = ownerimages.Owner[Querier]{
	Collection: protomapper.EpisodeEyeCatchCollection,
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateEpisodeEyeCatchImage(ctx, dbmodels.CreateEpisodeEyeCatchImageParams{ID: image.ID, TenantID: image.TenantID, EpisodeID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateEpisodeEyeCatchImageVariant(ctx, dbmodels.CreateEpisodeEyeCatchImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, EpisodeEyeCatchImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	DeleteVariantsOfType: func(ctx context.Context, q Querier, imageID uuid.UUID, variantType string) error {
		_, err := q.DeleteEpisodeEyeCatchImageVariantsByType(ctx, dbmodels.DeleteEpisodeEyeCatchImageVariantsByTypeParams{EpisodeEyeCatchImageID: imageID, VariantType: variantType})
		return err
	},
	TouchImage: func(ctx context.Context, q Querier, imageID uuid.UUID) error {
		return q.TouchEpisodeEyeCatchImage(ctx, imageID)
	},
}

var volumeCoverImages = ownerimages.Owner[Querier]{
	Collection: protomapper.VolumeCoverCollection,
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateVolumeCoverImage(ctx, dbmodels.CreateVolumeCoverImageParams{ID: image.ID, TenantID: image.TenantID, VolumeID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateVolumeCoverImageVariant(ctx, dbmodels.CreateVolumeCoverImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, VolumeCoverImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	ListVariants: func(ctx context.Context, q Querier, tenantID uuid.UUID, imageIDs []uuid.UUID) ([]ownerimages.Variant, error) {
		rows, err := q.ListVolumeCoverImageVariantsByImageIDs(ctx, dbmodels.ListVolumeCoverImageVariantsByImageIDsParams{TenantID: tenantID, ImageIds: imageIDs})
		return mapRows(rows, func(row dbmodels.ListVolumeCoverImageVariantsByImageIDsRow) ownerimages.Variant {
			return ownerimages.Variant{ID: row.ID, ImageID: row.VolumeCoverImageID, VariantType: row.VariantType, Label: row.Label, ContentType: row.ContentType, FileSizeBytes: row.FileSizeBytes, Width: row.Width, Height: row.Height}
		}), err
	},
}

var campaignBannerImages = ownerimages.Owner[Querier]{
	Collection: campaignBannerImagePath,
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateCampaignBannerImage(ctx, dbmodels.CreateCampaignBannerImageParams{ID: image.ID, TenantID: image.TenantID, CampaignBannerID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateCampaignBannerImageVariant(ctx, dbmodels.CreateCampaignBannerImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, CampaignBannerImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
	ListVariants: func(ctx context.Context, q Querier, _ uuid.UUID, imageIDs []uuid.UUID) ([]ownerimages.Variant, error) {
		rows, err := q.ListCampaignBannerImageVariantsByImageIDs(ctx, imageIDs)
		return mapRows(rows, func(row dbmodels.ListCampaignBannerImageVariantsByImageIDsRow) ownerimages.Variant {
			return ownerimages.Variant{ID: row.ID, ImageID: row.CampaignBannerImageID, VariantType: row.VariantType, Label: row.Label, ContentType: row.ContentType, FileSizeBytes: row.FileSizeBytes, Width: row.Width, Height: row.Height}
		}), err
	},
	DeleteVariantsOfType: func(ctx context.Context, q Querier, imageID uuid.UUID, variantType string) error {
		_, err := q.DeleteCampaignBannerImageVariantsByType(ctx, dbmodels.DeleteCampaignBannerImageVariantsByTypeParams{CampaignBannerImageID: imageID, VariantType: variantType})
		return err
	},
	TouchImage: func(ctx context.Context, q Querier, imageID uuid.UUID) error {
		return q.TouchCampaignBannerImage(ctx, imageID)
	},
}

// tenantBrandingImagesIn holds the tenant's own icon, logo, or sign-in image,
// which belong to no row but the tenant and differ only in the directory they
// are filed in.
func tenantBrandingImagesIn(collection string) ownerimages.Owner[Querier] {
	owner := tenantBrandingImages
	owner.Collection = collection
	return owner
}

var tenantBrandingImages = ownerimages.Owner[Querier]{
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateTenantImage(ctx, dbmodels.CreateTenantImageParams{ID: image.ID, TenantID: image.TenantID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateTenantImageVariant(ctx, dbmodels.CreateTenantImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, TenantImageID: v.ImageID, VariantType: v.VariantType, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
}

func mapRows[Row any](rows []Row, variant func(Row) ownerimages.Variant) []ownerimages.Variant {
	variants := make([]ownerimages.Variant, 0, len(rows))
	for _, row := range rows {
		variants = append(variants, variant(row))
	}
	return variants
}

// ownerImageRef names the owner row an image is stored for, under the tenant
// the request acts on.
func ownerImageRef(tenant dbmodels.Tenant, ownerID uuid.UUID, ownerPublicID string) ownerimages.Ref {
	return ownerimages.Ref{TenantID: tenant.ID, TenantPublicID: tenant.PublicID, OwnerID: ownerID, OwnerPublicID: ownerPublicID}
}

// storeOwnerImage stores variants as a new image of the owner ref names, on
// the queries of the transaction ctx carries, and answers its id.
func (s *adminServer) storeOwnerImage(ctx context.Context, owner ownerimages.Owner[Querier], ref ownerimages.Ref, variants []imageproc.Variant) (uuid.UUID, error) {
	imageID, err := ownerimages.Store(ctx, s.queriesFor(ctx), s.storage, owner, ref, variants)
	if err != nil {
		return uuid.Nil, s.ownerImageError(ctx, "failed to store "+owner.Collection+" image", err, ref)
	}
	return imageID, nil
}

// storeOptionalOwnerImage is storeOwnerImage for a request whose image is
// optional: no variants means no upload, and answers no image.
func (s *adminServer) storeOptionalOwnerImage(ctx context.Context, owner ownerimages.Owner[Querier], ref ownerimages.Ref, variants []imageproc.Variant) (uuid.NullUUID, error) {
	if len(variants) == 0 {
		return uuid.NullUUID{}, nil
	}
	imageID, err := s.storeOwnerImage(ctx, owner, ref, variants)
	if err != nil {
		return uuid.NullUUID{}, err
	}
	return uuid.NullUUID{UUID: imageID, Valid: true}, nil
}

// replaceOwnerImageType replaces one ratio of the owner's image with variants,
// on the queries of the transaction ctx carries, which holds the owner's row
// lock.
func (s *adminServer) replaceOwnerImageType(ctx context.Context, owner ownerimages.Owner[Querier], ref ownerimages.Ref, imageID uuid.UUID, variantType string, variants []imageproc.Variant) error {
	if err := ownerimages.ReplaceType(ctx, s.queriesFor(ctx), s.storage, owner, ref, imageID, variantType, variants); err != nil {
		return s.ownerImageError(ctx, "failed to replace "+owner.Collection+" image variants of type "+variantType, err, ref, "image_id", imageID.String())
	}
	return nil
}

// ownerImageVariants reads the variants of every image in imageIDs, grouped by
// image, as the messages a response carries.
func (s *adminServer) ownerImageVariants(ctx context.Context, owner ownerimages.Owner[Querier], tenantID uuid.UUID, imageIDs []uuid.UUID) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	variants, err := ownerimages.Load(ctx, s.queriesFor(ctx), owner, tenantID, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list "+owner.Collection+" image variants", err, "tenant_id", tenantID.String())
	}
	return protomapper.EyeCatchVariants(owner.Collection, variants), nil
}

// ownerImageError answers a failure to write an object the way every upload
// answers its storage, and a failure to write a row as an internal error.
func (s *adminServer) ownerImageError(ctx context.Context, msg string, err error, ref ownerimages.Ref, keyvals ...any) error {
	if uploadErr, ok := errors.AsType[*ownerimages.UploadError](err); ok {
		return storageUploadError(uploadErr.Unwrap())
	}
	return s.internalDBError(ctx, msg, err, append([]any{"tenant_id", ref.TenantID.String(), "owner_id", ref.OwnerID.String()}, keyvals...)...)
}
