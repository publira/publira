// Package usericon stores the icon a reader shows as their identity. It is the
// one place an upload becomes a stored icon, so the public API, where a reader
// sets their own, and the admin API, where staff act on a reader's account,
// store it the same way and leave the same rows for the orphan sweep.
package usericon

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// ErrInvalidImage marks an upload that cannot be stored as an icon, which the
// caller reports to whoever sent it. It wraps what imageproc found, so a crop
// the upload cannot hold is still imageproc.ErrInvalidCrop as well.
var ErrInvalidImage = errors.New("invalid icon image")

// ErrAccountNotFound reports that the tenant holds no account by that id.
var ErrAccountNotFound = errors.New("account not found")

// Querier is the generated set of queries setting and clearing an icon needs.
// The caller hands in the queries of its own transaction, and of a connection
// bound to the account's tenant, which the rows are subject to.
type Querier interface {
	CreateUserImage(ctx context.Context, arg dbmodels.CreateUserImageParams) (dbmodels.UserImage, error)
	CreateUserImageVariant(ctx context.Context, arg dbmodels.CreateUserImageVariantParams) (dbmodels.UserImageVariant, error)
	SetUserIconImage(ctx context.Context, arg dbmodels.SetUserIconImageParams) (int64, error)
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

	imageID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := q.CreateUserImage(ctx, dbmodels.CreateUserImageParams{
		ID:       imageID,
		TenantID: account.TenantID,
		UserID:   account.UserID,
	}); err != nil {
		return uuid.Nil, fmt.Errorf("create user image: %w", err)
	}

	uploaded, err := store.Upload(ctx, storage.UploadRequest{
		ObjectKey:   objectKey(account, imageID, variant),
		ContentType: variant.ContentType,
		Data:        variant.Data,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("upload user icon: %w", err)
	}

	variantID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := q.CreateUserImageVariant(ctx, dbmodels.CreateUserImageVariantParams{
		ID:              variantID,
		TenantID:        account.TenantID,
		UserImageID:     imageID,
		Label:           variant.Label,
		StorageProvider: uploaded.Provider,
		ObjectKey:       uploaded.ObjectKey,
		ContentType:     variant.ContentType,
		FileSizeBytes:   uploaded.SizeBytes,
		Width:           int32(variant.Width),
		Height:          int32(variant.Height),
	}); err != nil {
		return uuid.Nil, fmt.Errorf("create user image variant: %w", err)
	}

	if err := elect(ctx, q, account.TenantID, account.UserID, uuid.NullUUID{UUID: imageID, Valid: true}); err != nil {
		return uuid.Nil, err
	}
	return imageID, nil
}

// Clear leaves the account with no icon. The image it showed stays in place,
// elected by nothing, until the orphan sweep reclaims it; image-server stops
// serving it at once, because it serves an account's icon only while the
// account elects it.
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

// objectKey is where the variant of an account's icon image is stored. It
// sits under the tenant prefix the orphan sweep walks, which is what lets the
// sweep reclaim it once no row names it.
func objectKey(account Account, imageID uuid.UUID, variant imageproc.Variant) string {
	return fmt.Sprintf("tenants/%s/users/%s/%s-%s%s", account.TenantPublicID, account.UserPublicID, imageID, variant.Label, variant.Extension)
}
