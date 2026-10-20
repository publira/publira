// Package ownerimages stores and reads the images an aggregate carries. Every
// such aggregate — a series, a genre, a creator, a tenant's branding, a
// reader's icon — keeps them in the same three-table shape: the owner, its
// <owner>_images, and its <owner>_image_variants. The sequence that fills
// those tables is the same for all of them and lives here; an owner
// contributes its generated queries and the directory its objects are filed
// in, as an Owner.
//
// The sqlc queries stay one set per owner, because sqlc generates a row type
// per query; an Owner adapts them to the Image and Variant shapes this package
// works in.
package ownerimages

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// Owner is one image-carrying aggregate, over the queries type Q its caller
// holds: the caller passes the queries of its own transaction, so the owner
// row and the image rows commit together.
//
// CreateImage and CreateVariant are what Store needs. ListVariants is what
// Load needs, and DeleteVariantsOfType and TouchImage are what ReplaceType
// needs; an owner that is never read or never replaced one ratio at a time
// leaves them nil.
type Owner[Q any] struct {
	// Collection is the directory under the tenant prefix that the owner's
	// objects are filed in. For an owner image-server delivers by ratio, it
	// is the route segment of the image URLs as well.
	Collection    string
	CreateImage   func(ctx context.Context, q Q, image Image) error
	CreateVariant func(ctx context.Context, q Q, variant Variant) error
	// ListVariants reads the variants of every image in imageIDs, of
	// whichever images the tenant holds.
	ListVariants         func(ctx context.Context, q Q, tenantID uuid.UUID, imageIDs []uuid.UUID) ([]Variant, error)
	DeleteVariantsOfType func(ctx context.Context, q Q, imageID uuid.UUID, variantType string) error
	TouchImage           func(ctx context.Context, q Q, imageID uuid.UUID) error
}

// Ref names whose image is being stored.
type Ref struct {
	TenantID       uuid.UUID
	TenantPublicID string
	// OwnerID is the row the image belongs to, which CreateImage records. It
	// is zero for an image the tenant itself holds.
	OwnerID uuid.UUID
	// OwnerPublicID names the owner's directory under Collection. Empty files
	// the objects directly under Collection.
	OwnerPublicID string
}

// Image is the <owner>_images row Store creates.
type Image struct {
	ID       uuid.UUID
	TenantID uuid.UUID
	OwnerID  uuid.UUID
}

// Variant is one <owner>_image_variants row: written by Store and
// ReplaceType, and read back by Load. An owner whose table has no
// variant_type column ignores VariantType.
type Variant struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	ImageID         uuid.UUID
	VariantType     string
	Label           string
	StorageProvider string
	ObjectKey       string
	ContentType     string
	FileSizeBytes   int64
	Width           int32
	Height          int32
}

// UploadError is a failure to write an object, as opposed to a row, so the
// caller can answer it the way it answers its storage. Its message is the
// storage's own.
type UploadError struct {
	err error
}

func (e *UploadError) Error() string { return e.err.Error() }

func (e *UploadError) Unwrap() error { return e.err }

// Store stores variants as a new image of the owner ref names, returning the
// image's id: the image row first, then each variant's object and the row
// that names it. The caller points the owner at the image.
//
// A replacement is a new image rather than new objects under the old keys, so
// a URL a page holds changes with it and no cache keeps answering the
// previous image. The image it replaces stays until the orphan image sweep
// reclaims it, and so does an object uploaded by a call whose transaction
// rolls back.
func Store[Q any](ctx context.Context, q Q, store storage.Provider, owner Owner[Q], ref Ref, variants []imageproc.Variant) (uuid.UUID, error) {
	imageID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, err
	}
	if err := owner.CreateImage(ctx, q, Image{ID: imageID, TenantID: ref.TenantID, OwnerID: ref.OwnerID}); err != nil {
		return uuid.Nil, fmt.Errorf("create %s image: %w", owner.Collection, err)
	}
	if err := storeVariants(ctx, q, store, owner, ref.TenantID, imageID, variants, func(variant imageproc.Variant) string {
		return fmt.Sprintf("%s/%s-%s%s", directory(owner, ref), imageID, variant.Label, variant.Extension)
	}); err != nil {
		return uuid.Nil, err
	}
	return imageID, nil
}

// ReplaceType replaces every variant of one ratio of an existing image with
// variants, leaving the image's other ratios as they are, and touches the
// image so its updated time moves.
//
// The objects are written under keys new to this call, never over the ones
// the replaced rows name: those rows are what the orphan image sweep reads to
// decide an object is garbage, so overwriting would hand a cache the new
// bytes under a URL that still promised the old ones.
//
// The caller holds the owner's row lock: two replacements of one ratio racing
// would both clear it and then both insert the same (image, ratio, width).
func ReplaceType[Q any](ctx context.Context, q Q, store storage.Provider, owner Owner[Q], ref Ref, imageID uuid.UUID, variantType string, variants []imageproc.Variant) error {
	if err := owner.DeleteVariantsOfType(ctx, q, imageID, variantType); err != nil {
		return fmt.Errorf("clear %s image variants of type %s: %w", owner.Collection, variantType, err)
	}
	uploadID, err := uuid.NewV7()
	if err != nil {
		return err
	}
	if err := storeVariants(ctx, q, store, owner, ref.TenantID, imageID, variants, func(variant imageproc.Variant) string {
		return fmt.Sprintf("%s/%s-%s-%s%s", directory(owner, ref), imageID, uploadID, variant.Label, variant.Extension)
	}); err != nil {
		return err
	}
	if err := owner.TouchImage(ctx, q, imageID); err != nil {
		return fmt.Errorf("touch %s image: %w", owner.Collection, err)
	}
	return nil
}

// Load reads the variants of every image in imageIDs, grouped by image. It
// reads nothing when there are none.
func Load[Q any](ctx context.Context, q Q, owner Owner[Q], tenantID uuid.UUID, imageIDs []uuid.UUID) (map[uuid.UUID][]Variant, error) {
	grouped := make(map[uuid.UUID][]Variant, len(imageIDs))
	if len(imageIDs) == 0 {
		return grouped, nil
	}
	variants, err := owner.ListVariants(ctx, q, tenantID, imageIDs)
	if err != nil {
		return nil, fmt.Errorf("list %s image variants: %w", owner.Collection, err)
	}
	for _, variant := range variants {
		grouped[variant.ImageID] = append(grouped[variant.ImageID], variant)
	}
	return grouped, nil
}

// storeVariants uploads each variant under the key objectKey gives it and
// records it in a row. Every object of the call goes to the one store Pin
// answers, so an image's variants cannot be split across a change of the
// storage settings.
func storeVariants[Q any](ctx context.Context, q Q, store storage.Provider, owner Owner[Q], tenantID, imageID uuid.UUID, variants []imageproc.Variant, objectKey func(imageproc.Variant) string) error {
	if store == nil {
		return &UploadError{err: storage.ErrNotConfigured}
	}
	pinned, err := storage.Pin(ctx, store)
	if err != nil {
		return &UploadError{err: err}
	}
	for _, variant := range variants {
		uploaded, err := pinned.Upload(ctx, storage.UploadRequest{
			ObjectKey:   objectKey(variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if err != nil {
			return &UploadError{err: err}
		}
		variantID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if err := owner.CreateVariant(ctx, q, Variant{
			ID:              variantID,
			TenantID:        tenantID,
			ImageID:         imageID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		}); err != nil {
			return fmt.Errorf("create %s image variant: %w", owner.Collection, err)
		}
	}
	return nil
}

// directory is where an image's objects are filed: under the tenant prefix
// the orphan image sweep walks, which is what lets the sweep reclaim them once
// no row names them.
func directory[Q any](owner Owner[Q], ref Ref) string {
	if ref.OwnerPublicID == "" {
		return fmt.Sprintf("tenants/%s/%s", ref.TenantPublicID, owner.Collection)
	}
	return fmt.Sprintf("tenants/%s/%s/%s", ref.TenantPublicID, owner.Collection, ref.OwnerPublicID)
}
