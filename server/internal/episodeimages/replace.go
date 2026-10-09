package episodeimages

import (
	"context"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/cenkalti/backoff/v7"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// PageWriter is what Staged.Insert runs, on the querier of the write that puts
// the page in place.
type PageWriter interface {
	CreateEpisodeImage(ctx context.Context, arg dbmodels.CreateEpisodeImageParams) (dbmodels.EpisodeImage, error)
	CreateEpisodeImageVariant(ctx context.Context, arg dbmodels.CreateEpisodeImageVariantParams) (dbmodels.EpisodeImageVariant, error)
}

// Staged is one page's renditions, stored in the bucket and named by no row
// yet.
//
// Upload writes each page's row as it goes, so a failure leaves the pages
// before it on the episode. A page that takes another's place cannot be
// written that way: the swap has to commit whole or not at all. Its objects
// are stored first, outside any transaction, and Insert writes the rows inside
// the caller's. A transaction that never commits leaves objects no row names,
// which the orphan image sweep deletes.
type Staged struct {
	variants []stagedVariant
}

type stagedVariant struct {
	variant  imageproc.Variant
	uploaded storage.UploadResult
}

// Stage builds the renditions of one image and stores them as a page of the
// episode.
func (s Service) Stage(ctx context.Context, tenant dbmodels.Tenant, episodePublicID, filename, contentType string, data []byte) (Staged, error) {
	variants, err := imageproc.BuildVariants(data, contentType)
	if err != nil {
		err = fmt.Errorf("data: %w", err)
		return Staged{}, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	// Every rendition goes to the one store resolved here.
	provider, err := storage.Pin(ctx, s.Storage)
	if err != nil {
		return Staged{}, storageUploadError(err)
	}
	s.Storage = provider

	keys := newObjectKeys(tenant.PublicID, episodePublicID, filename)
	staged := Staged{variants: make([]stagedVariant, 0, len(variants))}
	for _, variant := range variants {
		objectKey := keys.of(variant)
		variantCtx, cancel := context.WithTimeout(ctx, imageProcessingTimeout)
		uploaded, uploadErr := backoff.Retry(
			variantCtx,
			func() (storage.UploadResult, error) {
				return s.uploadVariant(variantCtx, objectKey, variant)
			},
			backoff.WithBackOff(newVariantPersistenceBackOff()),
			backoff.WithMaxTries(imagePersistenceRetryMax),
		)
		cancel()
		if uploadErr != nil {
			return Staged{}, storageUploadError(fmt.Errorf("variant upload failed: %w", uploadErr))
		}
		// The bytes are in the bucket now, and nothing below reads them.
		variant.Data = nil
		staged.variants = append(staged.variants, stagedVariant{variant: variant, uploaded: uploaded})
	}
	return staged, nil
}

// Insert writes the page at displayOrder of the episode, naming the staged
// renditions.
func (st Staged) Insert(ctx context.Context, q PageWriter, tenantID, episodeID uuid.UUID, displayOrder int32) error {
	imageID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate episode image id: %w", err)
	}
	image, err := q.CreateEpisodeImage(ctx, dbmodels.CreateEpisodeImageParams{
		ID:           imageID,
		TenantID:     tenantID,
		EpisodeID:    episodeID,
		DisplayOrder: displayOrder,
	})
	if err != nil {
		return fmt.Errorf("create episode image: %w", err)
	}
	for _, staged := range st.variants {
		variantID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generate episode image variant id: %w", err)
		}
		if _, err := q.CreateEpisodeImageVariant(ctx, dbmodels.CreateEpisodeImageVariantParams{
			ID:              variantID,
			TenantID:        tenantID,
			EpisodeImageID:  image.ID,
			Label:           staged.variant.Label,
			StorageProvider: staged.uploaded.Provider,
			ObjectKey:       staged.uploaded.ObjectKey,
			ContentType:     staged.variant.ContentType,
			FileSizeBytes:   staged.uploaded.SizeBytes,
			Width:           int32(staged.variant.Width),
			Height:          int32(staged.variant.Height),
		}); err != nil {
			return fmt.Errorf("create episode image variant %s: %w", staged.variant.Label, err)
		}
	}
	return nil
}
