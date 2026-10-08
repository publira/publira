package imageserver

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// episodePreviewRendition names the preview in its cache key, apart from every
// rendition Manael produces of the same object. Changing what
// imageproc.BuildEpisodePreview renders changes this name too, so a cache
// still holding the old rendition is not answered from.
const episodePreviewRendition = "episode-preview/v1"

// handleGetEpisodePreviewImage serves the preview of one of an episode's
// opening pages: the blurred, downscaled rendition GetEpisodeDetail offers in
// place of a body the reader may not open.
//
// It reads no credential and applies neither the price nor the tenant's age
// rule, since the rendition is unreadable by construction: anyone who may see
// the episode at all may hold it, so it leaves in plaintext under a shared
// cache entry. What it does keep to is the opening pages — a later page is
// not found — so the route is not a way through a whole body, however blurred.
//
// Query parameters are ignored. The rendition is one size, so `w` and `h` have
// nothing to choose between, and passing them on to Manael would be a way to
// ask for a larger one.
func (h *Handler) handleGetEpisodePreviewImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, adminHost, ok := h.tenantFromHost(w, r)
	if !ok {
		return
	}

	mediaID, err := uuid.Parse(r.PathValue("media_id"))
	if err != nil {
		http.Error(w, "invalid media_id", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantQueries(ctx, adminHost, tenant.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	page, err := tenantQueries.GetEpisodePreviewImageByIDForTenant(ctx, dbmodels.GetEpisodePreviewImageByIDForTenantParams{
		ID:        mediaID,
		TenantID:  tenant.ID,
		PageCount: imageproc.EpisodePreviewPageCount,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to load episode preview source", "error", err, "media_id", mediaID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if !page.IsPublished.Valid || !page.IsPublished.Bool {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if strings.TrimSpace(page.ObjectKey) == "" {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}

	h.servePreview(w, r, page.ObjectKey)
}

// servePreview answers with the preview rendered from objectKey, rendering it
// on a cache miss and keeping the result in the cache the converted renditions
// share.
func (h *Handler) servePreview(w http.ResponseWriter, r *http.Request, objectKey string) {
	ctx := r.Context()

	storeVersion, ok := h.resolveStoreVersion(w, r, objectKey)
	if !ok {
		return
	}
	key := previewCacheKey(storeVersion, objectKey)
	if entry, ok := h.cache.Get(ctx, key); ok {
		writeImage(w, entry.ContentType, publicImageCacheControl, "hit", http.StatusOK, entry.Data)
		return
	}

	obj, err := h.objects.GetObject(ctx, objectKey)
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusNotFound, []byte("image not found\n"))
			return
		}
		if errors.Is(err, storage.ErrNotConfigured) {
			h.logger.Warn("no object store to render a preview from", "error", err, "object_key", objectKey)
			writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusServiceUnavailable, []byte("object storage is not configured\n"))
			return
		}
		h.logger.ErrorContext(ctx, "failed to load the preview source", "error", err, "object_key", objectKey)
		writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusInternalServerError, []byte("internal server error\n"))
		return
	}
	defer obj.Body.Close() //nolint:errcheck

	// One byte past the cap is read so an object over it reaches
	// BuildEpisodePreview whole enough to be refused rather than truncated
	// into a different image.
	raw, err := io.ReadAll(io.LimitReader(obj.Body, imageproc.MaxUploadBytes+1))
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to read the preview source", "error", err, "object_key", objectKey)
		writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusInternalServerError, []byte("internal server error\n"))
		return
	}
	preview, err := imageproc.BuildEpisodePreview(raw)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to render an episode preview", "error", err, "object_key", objectKey)
		writeImage(w, "text/plain; charset=utf-8", "", "miss", http.StatusInternalServerError, []byte("internal server error\n"))
		return
	}

	h.cache.Set(ctx, key, CacheEntry{ContentType: preview.ContentType, Data: preview.Data})
	writeImage(w, preview.ContentType, publicImageCacheControl, "miss", http.StatusOK, preview.Data)
}

// previewCacheKey keys a preview by the store it was read from and the object
// it was rendered from. Unlike cacheKey it reads nothing off the request: the
// preview is one rendition whatever was asked for.
func previewCacheKey(storeVersion, objectKey string) string {
	var b strings.Builder
	b.Grow(len(storeVersion) + len(objectKey) + len(episodePreviewRendition) + 2)
	b.WriteString(storeVersion)
	b.WriteByte(cacheKeySep)
	b.WriteString(objectKey)
	b.WriteByte(cacheKeySep)
	b.WriteString(episodePreviewRendition)
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}
