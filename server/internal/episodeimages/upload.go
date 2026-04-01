package episodeimages

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/archiveimages"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/epubimages"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	imageProcessingTimeout       = 15 * time.Second
	imagePersistenceRetryMax     = 3
	imagePersistenceRetryBackoff = 100 * time.Millisecond
	maxArchiveEntries            = 1000
)

type Querier interface {
	CreateEpisodeImage(ctx context.Context, arg dbmodels.CreateEpisodeImageParams) (dbmodels.EpisodeImage, error)
	GetEpisodeByPublicIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeByPublicIDForTenantParams) (dbmodels.GetEpisodeByPublicIDForTenantRow, error)
	GetEpisodeByPublicIDForTenantAndSeries(ctx context.Context, arg dbmodels.GetEpisodeByPublicIDForTenantAndSeriesParams) (dbmodels.GetEpisodeByPublicIDForTenantAndSeriesRow, error)
	GetMaxEpisodeImageDisplayOrderByEpisodeID(ctx context.Context, episodeID uuid.UUID) (int32, error)
}

type Service struct {
	Queries  Querier
	Storage  storage.Provider
	Recorder *auditlog.Recorder
}

type UploadRequest struct {
	Tenant          dbmodels.Tenant
	SeriesPublicID  string
	EpisodePublicID string
	Images          []*publiraadminv1.EpisodeImageUpload
	ArchiveData     []byte
	ArchiveFilename string
	ArchiveType     string
	Headers         http.Header
}

func (s Service) Upload(ctx context.Context, req UploadRequest) ([]*publirattypesv1.EpisodeImage, error) {
	imageInputs, err := collectInputs(req.Images, req.ArchiveData, req.ArchiveFilename, req.ArchiveType, req.SeriesPublicID)
	if err != nil {
		return nil, err
	}

	episodeID, episodePublicID, err := s.resolveEpisode(ctx, req.Tenant.ID, req.SeriesPublicID, req.EpisodePublicID)
	if err != nil {
		return nil, err
	}

	return s.storeImages(ctx, req.Tenant, episodeID, episodePublicID, imageInputs, req.Headers)
}

func collectInputs(images []*publiraadminv1.EpisodeImageUpload, archiveData []byte, archiveFilename string, archiveType string, seriesPublicID string) ([]archiveimages.Input, error) {
	hasArchive := len(archiveData) > 0
	if hasArchive && len(images) > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("images and archive_data cannot be used together"))
	}
	if hasArchive && strings.TrimSpace(seriesPublicID) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series_public_id is required when archive_data is provided"))
	}
	if !hasArchive && len(images) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("images are required"))
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
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
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

func shouldExtractFromEPUB(archiveFilename string, archiveContentType string) bool {
	filename := strings.ToLower(strings.TrimSpace(archiveFilename))
	if strings.HasSuffix(filename, ".epub") {
		return true
	}
	contentType := strings.ToLower(strings.TrimSpace(archiveContentType))
	return strings.Contains(contentType, "application/epub+zip")
}

func (s Service) resolveEpisode(ctx context.Context, tenantID uuid.UUID, seriesPublicID string, episodePublicID string) (uuid.UUID, string, error) {
	episodePublicID = strings.TrimSpace(episodePublicID)
	if episodePublicID == "" {
		return uuid.Nil, "", connect.NewError(connect.CodeInvalidArgument, errors.New("episode_public_id is required"))
	}
	seriesPublicID = strings.TrimSpace(seriesPublicID)
	if seriesPublicID != "" {
		episode, err := s.Queries.GetEpisodeByPublicIDForTenantAndSeries(ctx, dbmodels.GetEpisodeByPublicIDForTenantAndSeriesParams{
			TenantID:   tenantID,
			PublicID:   seriesPublicID,
			PublicID_2: episodePublicID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return uuid.Nil, "", connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
			}
			return uuid.Nil, "", connect.NewError(connect.CodeInternal, err)
		}
		return episode.ID, episode.PublicID, nil
	}

	episode, err := s.Queries.GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{TenantID: tenantID, PublicID: episodePublicID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, "", connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return uuid.Nil, "", connect.NewError(connect.CodeInternal, err)
	}
	return episode.ID, episode.PublicID, nil
}

func (s Service) storeImages(
	ctx context.Context,
	tenant dbmodels.Tenant,
	episodeID uuid.UUID,
	episodePublicID string,
	imageInputs []archiveimages.Input,
	headers http.Header,
) ([]*publirattypesv1.EpisodeImage, error) {
	maxDisplayOrder, err := s.Queries.GetMaxEpisodeImageDisplayOrderByEpisodeID(ctx, episodeID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*publirattypesv1.EpisodeImage, 0, len(imageInputs))
	displayOrder := maxDisplayOrder
	sessionCtx, hasSession := rpcmiddleware.SessionContextFromContext(ctx)
	clientIP := auditlog.ClientIPFromHeader(headers)

	for index, imageInput := range imageInputs {
		if len(imageInput.Data) == 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d].data is required", index))
		}

		variants, buildErr := imageproc.BuildVariants(imageInput.Data, imageInput.ContentType)
		if buildErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("images[%d]: %w", index, buildErr))
		}

		objectPrefix := objectPrefix(imageInput.Filename)
		baseObjectID := uuid.NewString()
		for _, variant := range variants {
			displayOrder++
			objectKey := fmt.Sprintf("tenants/%s/episodes/%s/%s-%s-%s%s", tenant.PublicID, episodePublicID, objectPrefix, baseObjectID, variant.Label, variant.Extension)

			variantCtx, cancel := context.WithTimeout(ctx, imageProcessingTimeout)
			created, persistErr := func() (dbmodels.EpisodeImage, error) {
				var lastErr error
				for attempt := 1; attempt <= imagePersistenceRetryMax; attempt++ {
					uploaded, uploadErr := s.Storage.Upload(variantCtx, storage.UploadRequest{
						ObjectKey:   objectKey,
						ContentType: variant.ContentType,
						Data:        variant.Data,
					})
					if uploadErr != nil {
						lastErr = uploadErr
					} else {
						episodeImageID, idErr := uuid.NewV7()
						if idErr != nil {
							return dbmodels.EpisodeImage{}, idErr
						}
						createdRow, createErr := s.Queries.CreateEpisodeImage(variantCtx, dbmodels.CreateEpisodeImageParams{
							ID:              episodeImageID,
							TenantID:        tenant.ID,
							EpisodeID:       episodeID,
							StorageProvider: uploaded.Provider,
							ObjectKey:       uploaded.ObjectKey,
							ImageUrl:        uploaded.URL,
							ContentType:     variant.ContentType,
							FileSizeBytes:   uploaded.SizeBytes,
							DisplayOrder:    displayOrder,
							Width:           int32(variant.Width),
							Height:          int32(variant.Height),
						})
						if createErr == nil {
							return createdRow, nil
						}
						lastErr = createErr
					}
					if attempt < imagePersistenceRetryMax {
						if err := sleepWithContext(variantCtx, time.Duration(attempt)*imagePersistenceRetryBackoff); err != nil {
							return dbmodels.EpisodeImage{}, err
						}
					}
				}
				return dbmodels.EpisodeImage{}, fmt.Errorf("variant persistence failed after %d attempts: %w", imagePersistenceRetryMax, lastErr)
			}()
			cancel()
			if persistErr != nil {
				return nil, connect.NewError(connect.CodeInternal, persistErr)
			}

			items = append(items, protomapper.EpisodeImageFromEpisodeImage(created))
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
	}

	return items, nil
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

func sleepWithContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
