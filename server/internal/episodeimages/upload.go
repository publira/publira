package episodeimages

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/cenkalti/backoff/v7"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/archiveimages"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/epubimages"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	imageProcessingTimeout          = 15 * time.Second
	imagePersistenceRetryMax        = 3
	imagePersistenceRetryBackoff    = 100 * time.Millisecond
	imagePersistenceRetryMultiplier = 2
	maxArchiveEntries               = 1000
	// MaxUploadBytes is the most one upload carries: its archive, or its
	// images taken together. A whole episode's pages fit in one ZIP or ePub of
	// that size, around a hundred pages of a megabyte each, and an episode of
	// larger pages goes up in several uploads.
	MaxUploadBytes = 128 << 20
)

type Querier interface {
	CreateEpisodeImage(ctx context.Context, arg dbmodels.CreateEpisodeImageParams) (dbmodels.EpisodeImage, error)
	CreateEpisodeImageVariant(ctx context.Context, arg dbmodels.CreateEpisodeImageVariantParams) (dbmodels.EpisodeImageVariant, error)
	GetEpisodeSeriesByIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeSeriesByIDForTenantParams) (dbmodels.GetEpisodeSeriesByIDForTenantRow, error)
	GetMaxEpisodeImageDisplayOrderByEpisodeID(ctx context.Context, episodeID uuid.UUID) (int32, error)
}

type Service struct {
	Queries  Querier
	Storage  storage.Provider
	Recorder auditlog.Recorder
}

type UploadRequest struct {
	Tenant dbmodels.Tenant
	// SeriesID is uuid.Nil where the upload names no series. An archive needs
	// one, and a series named must be the episode's own.
	SeriesID        uuid.UUID
	EpisodeID       uuid.UUID
	Images          []*publiraadminv1.EpisodeImageUpload
	ArchiveData     []byte
	ArchiveFilename string
	ArchiveType     string
}

func storageUploadError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, storage.ErrNotConfigured) {
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	}
	return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
}

// Upload stores the pages after the episode's last one and answers with them
// and the episode they were added to.
//
// The pages are written one at a time, each with its own statements and
// objects, so a failure part way leaves the pages before it stored. The episode
// is therefore answered beside the error too whenever a page row was written,
// and is uuid.Nil only when the upload failed before writing anything: a caller
// that owes something for every stored page — a cache answering with the
// episode's pages — owes it on that error as well.
func (s Service) Upload(ctx context.Context, req UploadRequest) ([]*publirattypesv1.EpisodeImage, uuid.UUID, error) {
	imageInputs, err := collectInputs(req.Images, req.ArchiveData, req.ArchiveFilename, req.ArchiveType, req.SeriesID != uuid.Nil)
	if err != nil {
		return nil, uuid.Nil, err
	}

	episodeID, episodePublicID, err := s.resolveEpisode(ctx, req.Tenant.ID, req.SeriesID, req.EpisodeID)
	if err != nil {
		return nil, uuid.Nil, err
	}

	// Every variant of every image goes to the one store resolved here.
	if s.Storage, err = storage.Pin(ctx, s.Storage); err != nil {
		return nil, uuid.Nil, storageUploadError(err)
	}
	items, wrote, err := s.storeImages(ctx, req.Tenant, episodeID, episodePublicID, imageInputs)
	if err != nil {
		if wrote {
			return nil, episodeID, err
		}
		return nil, uuid.Nil, err
	}
	return items, episodeID, nil
}

func collectInputs(images []*publiraadminv1.EpisodeImageUpload, archiveData []byte, archiveFilename string, archiveType string, hasSeries bool) ([]archiveimages.Input, error) {
	hasArchive := len(archiveData) > 0
	if hasArchive && len(images) > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "images and archive_data cannot be used together")
	}
	if hasArchive && !hasSeries {
		return nil, connect.NewError(connect.CodeInvalidArgument, "series_id is required when archive_data is provided")
	}
	if !hasArchive && len(images) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "images are required")
	}
	size := len(archiveData)
	for _, imageUpload := range images {
		size += len(imageUpload.GetData())
	}
	if size > MaxUploadBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Sprintf("an upload may carry at most %d bytes", MaxUploadBytes))
	}

	if hasArchive {
		var (
			archiveInputs []archiveimages.Input
			err           error
		)
		if shouldExtractFromEPUB(archiveFilename, archiveType) {
			archiveInputs, err = epubimages.ExtractImageInputs(archiveData, maxArchiveEntries)
		} else {
			archiveInputs, err = archiveimages.ExtractImageInputs(archiveData, maxArchiveEntries)
		}
		if err != nil {
			return nil, archiveRejectionError(err)
		}
		return archiveInputs, nil
	}

	inputs := make([]archiveimages.Input, 0, len(images))
	for _, imageUpload := range images {
		inputs = append(inputs, archiveimages.Input{
			Filename:    imageUpload.Filename,
			ContentType: imageUpload.ContentType,
			Data:        imageUpload.Data,
		})
	}
	return inputs, nil
}

func archiveRejectionError(err error) error {
	if rejection, ok := epubimages.RejectionOf(err); ok {
		switch rejection {
		case epubimages.RejectionInvalidEPUB:
			return rpcerrors.NewErrorInfoError(connect.CodeInvalidArgument, err, rpcerrors.ReasonArchiveInvalidEPUB)
		case epubimages.RejectionInvalidEPUBSpine:
			return rpcerrors.NewErrorInfoError(connect.CodeInvalidArgument, err, rpcerrors.ReasonArchiveInvalidEPUBSpine)
		case epubimages.RejectionInvalidPath:
			return rpcerrors.NewErrorInfoError(connect.CodeInvalidArgument, err, rpcerrors.ReasonArchiveInvalidPath)
		}
	}
	if rejection, ok := archiveimages.RejectionOf(err); ok && rejection == archiveimages.RejectionInvalidPath {
		return rpcerrors.NewErrorInfoError(connect.CodeInvalidArgument, err, rpcerrors.ReasonArchiveInvalidPath)
	}
	return connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
}

func shouldExtractFromEPUB(archiveFilename string, archiveContentType string) bool {
	filename := strings.ToLower(strings.TrimSpace(archiveFilename))
	if strings.HasSuffix(filename, ".epub") {
		return true
	}
	contentType := strings.ToLower(strings.TrimSpace(archiveContentType))
	return strings.Contains(contentType, "application/epub+zip")
}

func (s Service) resolveEpisode(ctx context.Context, tenantID, seriesID, episodeID uuid.UUID) (uuid.UUID, string, error) {
	episode, err := s.Queries.GetEpisodeSeriesByIDForTenant(ctx, dbmodels.GetEpisodeSeriesByIDForTenantParams{TenantID: tenantID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, "", connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return uuid.Nil, "", connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if seriesID != uuid.Nil && episode.SeriesID != seriesID {
		return uuid.Nil, "", connect.NewError(connect.CodeNotFound, "episode not found")
	}
	return episode.ID, episode.PublicID, nil
}

func (s Service) storeImages(
	ctx context.Context,
	tenant dbmodels.Tenant,
	episodeID uuid.UUID,
	episodePublicID string,
	imageInputs []archiveimages.Input,
) (items []*publirattypesv1.EpisodeImage, wrote bool, err error) {
	maxDisplayOrder, err := s.Queries.GetMaxEpisodeImageDisplayOrderByEpisodeID(ctx, episodeID)
	if err != nil {
		return nil, false, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	items = make([]*publirattypesv1.EpisodeImage, 0, len(imageInputs))
	displayOrder := maxDisplayOrder
	sessionCtx, hasSession := rpcmiddleware.SessionContextFromContext(ctx)
	clientIP := clientip.FromContext(ctx)

	for index, imageInput := range imageInputs {
		if len(imageInput.Data) == 0 {
			return nil, wrote, connect.Errorf(connect.CodeInvalidArgument, "images[%d].data is required", index)
		}

		variants, buildErr := imageproc.BuildVariants(imageInput.Data, imageInput.ContentType)
		if buildErr != nil {
			err := fmt.Errorf("images[%d]: %w", index, buildErr)
			return nil, wrote, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}

		displayOrder++
		episodeImageID, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, wrote, connect.NewError(connect.CodeInternal, idErr.Error()).WithCause(idErr)
		}
		createdImage, createErr := s.Queries.CreateEpisodeImage(ctx, dbmodels.CreateEpisodeImageParams{
			ID:           episodeImageID,
			TenantID:     tenant.ID,
			EpisodeID:    episodeID,
			DisplayOrder: displayOrder,
		})
		if createErr != nil {
			return nil, wrote, connect.NewError(connect.CodeInternal, createErr.Error()).WithCause(createErr)
		}
		wrote = true

		objectPrefix := objectPrefix(imageInput.Filename)
		baseObjectID := uuid.NewString()
		var lastVariant dbmodels.EpisodeImageVariant
		for _, variant := range variants {
			objectKey := fmt.Sprintf("tenants/%s/episodes/%s/%s-%s-%s%s", tenant.PublicID, episodePublicID, objectPrefix, baseObjectID, variant.Label, variant.Extension)

			variantCtx, cancel := context.WithTimeout(ctx, imageProcessingTimeout)
			createdVariant, persistErr := backoff.Retry(
				variantCtx,
				func() (dbmodels.EpisodeImageVariant, error) {
					uploaded, uploadErr := s.Storage.Upload(variantCtx, storage.UploadRequest{
						ObjectKey:   objectKey,
						ContentType: variant.ContentType,
						Data:        variant.Data,
					})
					if errors.Is(uploadErr, storage.ErrNotConfigured) {
						return dbmodels.EpisodeImageVariant{}, backoff.Permanent(uploadErr)
					}
					if uploadErr != nil {
						return dbmodels.EpisodeImageVariant{}, uploadErr
					}
					variantID, variantIDErr := uuid.NewV7()
					if variantIDErr != nil {
						return dbmodels.EpisodeImageVariant{}, backoff.Permanent(variantIDErr)
					}
					return s.Queries.CreateEpisodeImageVariant(variantCtx, dbmodels.CreateEpisodeImageVariantParams{
						ID:              variantID,
						TenantID:        tenant.ID,
						EpisodeImageID:  createdImage.ID,
						Label:           variant.Label,
						StorageProvider: uploaded.Provider,
						ObjectKey:       uploaded.ObjectKey,
						ContentType:     variant.ContentType,
						FileSizeBytes:   uploaded.SizeBytes,
						Width:           int32(variant.Width),
						Height:          int32(variant.Height),
					})
				},
				backoff.WithBackOff(newVariantPersistenceBackOff()),
				backoff.WithMaxTries(imagePersistenceRetryMax),
			)
			cancel()
			if persistErr != nil {
				return nil, wrote, storageUploadError(fmt.Errorf("variant persistence failed: %w", persistErr))
			}
			lastVariant = createdVariant
		}

		items = append(items, protomapper.EpisodeImageFromImageAndVariant(createdImage, lastVariant))
		if hasSession && s.Recorder != nil {
			s.Recorder.RecordTenant(ctx, auditlog.TenantEntry{
				TenantID:    tenant.ID,
				ActorUserID: sessionCtx.User.ID,
				ActorRole:   sessionCtx.Role,
				Action:      "episode_image_uploaded",
				TargetType:  "episode",
				TargetID:    episodePublicID,
				Outcome:     auditlog.OutcomeSuccess,
				ClientIP:    clientIP,
			})
		}
	}

	return items, wrote, nil
}

func objectPrefix(filename string) string {
	objectPrefix := strings.ToLower(strings.TrimSpace(strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))))
	if objectPrefix == "" {
		objectPrefix = strings.ToLower(strings.ReplaceAll(filename, " ", "-"))
	}
	if objectPrefix == "" {
		objectPrefix = "image"
	}
	return objectPrefix
}

// newVariantPersistenceBackOff builds the retry schedule: imagePersistenceRetryBackoff
// doubling on every further attempt. The library's randomization, interval ceiling,
// and total elapsed limit are left at their defaults; variantCtx owns the deadline
// that matters here.
func newVariantPersistenceBackOff() *backoff.ExponentialBackOff {
	bo := backoff.NewExponentialBackOff()
	bo.InitialInterval = imagePersistenceRetryBackoff
	bo.Multiplier = imagePersistenceRetryMultiplier
	return bo
}
