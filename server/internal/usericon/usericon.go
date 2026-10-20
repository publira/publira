// Package usericon stores the icon a reader shows as their identity. It is the
// one place an upload becomes a stored icon, so the public API, where a reader
// sets their own, and the admin API, where staff act on a reader's account or
// add a preset for readers to pick, store it the same way and leave the same
// rows for the orphan sweep.
package usericon

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/ownerimages"
	"github.com/publira/publira/server/internal/storage"
)

// ErrInvalidImage marks an upload that cannot be stored as an icon, which the
// caller reports to whoever sent it. It wraps what imageproc found, so a crop
// the upload cannot hold is still imageproc.ErrInvalidCrop as well.
var ErrInvalidImage = errors.New("invalid icon image")

// ErrAccountNotFound reports that the tenant holds no account by that id.
var ErrAccountNotFound = errors.New("account not found")

// ErrPresetNotFound reports that the tenant holds no preset by that id.
var ErrPresetNotFound = errors.New("reader icon preset not found")

// Querier is the generated set of queries setting and clearing an icon needs.
// The caller hands in the queries of its own transaction, and of a connection
// bound to the account's tenant, which the rows are subject to.
type Querier interface {
	CreateUserImage(ctx context.Context, arg dbmodels.CreateUserImageParams) (dbmodels.UserImage, error)
	CreateUserImageVariant(ctx context.Context, arg dbmodels.CreateUserImageVariantParams) (dbmodels.UserImageVariant, error)
	SetUserIconImage(ctx context.Context, arg dbmodels.SetUserIconImageParams) (int64, error)
	SetUserIconPreset(ctx context.Context, arg dbmodels.SetUserIconPresetParams) (int64, error)
}

// PresetQuerier is the generated set of queries storing a preset needs.
type PresetQuerier interface {
	CreateReaderIconPreset(ctx context.Context, arg dbmodels.CreateReaderIconPresetParams) (dbmodels.ReaderIconPreset, error)
	CreateReaderIconPresetVariant(ctx context.Context, arg dbmodels.CreateReaderIconPresetVariantParams) (dbmodels.ReaderIconPresetVariant, error)
}

// Account names the account an icon belongs to. The public ids place its
// objects in the bucket, under the tenant prefix the orphan sweep walks.
type Account struct {
	TenantID       uuid.UUID
	TenantPublicID string
	UserID         uuid.UUID
	UserPublicID   string
}

// Upload is an icon as it was sent: the encoded image, the content type it was
// declared with, and the part of it to keep, or nil for the centre square.
type Upload struct {
	Data        []byte
	ContentType string
	Crop        *imageproc.CropRect
}

// Set stores upload as the account's icon and elects it, returning the id of
// the image it was stored as. The upload is processed before anything is
// written, so one that fails with ErrInvalidImage leaves nothing behind.
//
// A replacement is a new image rather than a new object under the old one's
// key, so the URL a page holds changes with it and no cache keeps answering
// the previous icon. The image it replaces stays in place, elected by nothing,
// until the orphan sweep reclaims it.
//
// The object is uploaded between two writes, so a failure after it leaves an
// object no committed row names: run inside a transaction, the rows roll back
// with the failure and the sweep reclaims the object, and run outside one, the
// image row is left unelected and the sweep reclaims both.
func Set(ctx context.Context, q Querier, store storage.Provider, account Account, upload Upload) (uuid.UUID, error) {
	variant, err := imageproc.BuildUserIcon(upload.Data, upload.ContentType, upload.Crop)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: %w", ErrInvalidImage, err)
	}
	if store == nil {
		return uuid.Nil, storage.ErrNotConfigured
	}

	imageID, err := ownerimages.Store(ctx, q, store, userImages, ownerimages.Ref{
		TenantID:       account.TenantID,
		TenantPublicID: account.TenantPublicID,
		OwnerID:        account.UserID,
		OwnerPublicID:  account.UserPublicID,
	}, []imageproc.Variant{variant})
	if err != nil {
		return uuid.Nil, err
	}

	if err := elect(ctx, q, account.TenantID, account.UserID, uuid.NullUUID{UUID: imageID, Valid: true}); err != nil {
		return uuid.Nil, err
	}
	return imageID, nil
}

// StorePreset stores upload as one of the tenant's presets, returning the id
// of the preset it was stored as. The upload is processed before anything is
// written, so one that fails with ErrInvalidImage leaves nothing behind, and a
// preset is cut the way a reader's own upload is, so a reader sees the same
// square whichever of the two they show.
//
// The object is uploaded between two writes, with the consequences Set
// describes: run inside a transaction, a failure after the upload leaves only
// an object the orphan sweep reclaims.
func StorePreset(ctx context.Context, q PresetQuerier, store storage.Provider, tenantID uuid.UUID, tenantPublicID string, upload Upload) (uuid.UUID, error) {
	variant, err := imageproc.BuildUserIcon(upload.Data, upload.ContentType, upload.Crop)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: %w", ErrInvalidImage, err)
	}
	if store == nil {
		return uuid.Nil, storage.ErrNotConfigured
	}

	presetID, err := ownerimages.Store(ctx, q, store, presetImages, ownerimages.Ref{TenantID: tenantID, TenantPublicID: tenantPublicID}, []imageproc.Variant{variant})
	if err != nil {
		return uuid.Nil, err
	}
	return presetID, nil
}

// SelectPreset elects one of the tenant's presets as the account's icon. An
// upload the account showed is left for the orphan sweep, as a replaced one
// is.
func SelectPreset(ctx context.Context, q Querier, tenantID, userID, presetID uuid.UUID) error {
	rows, err := q.SetUserIconPreset(ctx, dbmodels.SetUserIconPresetParams{
		IconPresetID: uuid.NullUUID{UUID: presetID, Valid: true},
		TenantID:     uuid.NullUUID{UUID: tenantID, Valid: true},
		ID:           userID,
	})
	if err != nil {
		if dberr.IsForeignKeyViolation(err) {
			return ErrPresetNotFound
		}
		return fmt.Errorf("set user icon preset: %w", err)
	}
	if rows == 0 {
		return ErrAccountNotFound
	}
	return nil
}

// Clear leaves the account with no icon. An image it showed stays in place,
// elected by nothing, until the orphan sweep reclaims it; image-server stops
// serving it at once, because it serves an account's icon only while the
// account elects it. A preset it showed stays the tenant's.
func Clear(ctx context.Context, q Querier, tenantID, userID uuid.UUID) error {
	return elect(ctx, q, tenantID, userID, uuid.NullUUID{})
}

func elect(ctx context.Context, q Querier, tenantID, userID uuid.UUID, imageID uuid.NullUUID) error {
	rows, err := q.SetUserIconImage(ctx, dbmodels.SetUserIconImageParams{
		IconImageID: imageID,
		TenantID:    uuid.NullUUID{UUID: tenantID, Valid: true},
		ID:          userID,
	})
	if err != nil {
		return fmt.Errorf("set user icon image: %w", err)
	}
	if rows == 0 {
		return ErrAccountNotFound
	}
	return nil
}

// userImages files an account's icons under the account, which is where the
// orphan sweep finds them once no account elects them.
var userImages = ownerimages.Owner[Querier]{
	Collection: "users",
	CreateImage: func(ctx context.Context, q Querier, image ownerimages.Image) error {
		_, err := q.CreateUserImage(ctx, dbmodels.CreateUserImageParams{ID: image.ID, TenantID: image.TenantID, UserID: image.OwnerID})
		return err
	},
	CreateVariant: func(ctx context.Context, q Querier, v ownerimages.Variant) error {
		_, err := q.CreateUserImageVariant(ctx, dbmodels.CreateUserImageVariantParams{
			ID: v.ID, TenantID: v.TenantID, UserImageID: v.ImageID, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
}

// presetImages stores a preset as its own image row: a preset is an image the
// tenant holds, so the preset row is the image and has no owner above it.
var presetImages = ownerimages.Owner[PresetQuerier]{
	Collection: "reader-icon-presets",
	CreateImage: func(ctx context.Context, q PresetQuerier, image ownerimages.Image) error {
		_, err := q.CreateReaderIconPreset(ctx, dbmodels.CreateReaderIconPresetParams{ID: image.ID, TenantID: image.TenantID})
		return err
	},
	CreateVariant: func(ctx context.Context, q PresetQuerier, v ownerimages.Variant) error {
		_, err := q.CreateReaderIconPresetVariant(ctx, dbmodels.CreateReaderIconPresetVariantParams{
			ID: v.ID, TenantID: v.TenantID, ReaderIconPresetID: v.ImageID, Label: v.Label,
			StorageProvider: v.StorageProvider, ObjectKey: v.ObjectKey, ContentType: v.ContentType,
			FileSizeBytes: v.FileSizeBytes, Width: v.Width, Height: v.Height,
		})
		return err
	},
}
