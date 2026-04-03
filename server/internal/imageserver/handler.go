package imageserver

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/requestmeta"
)

type ResolverQuerier interface {
	GetTenantByDomains(ctx context.Context, domains []string) (dbmodels.Tenant, error)
	GetAdminTenantByDomains(ctx context.Context, domains []string) (dbmodels.Tenant, error)
}

type TenantScopedQuerier interface {
	GetCreatorImageByIDForTenant(ctx context.Context, arg dbmodels.GetCreatorImageByIDForTenantParams) (dbmodels.GetCreatorImageByIDForTenantRow, error)
	GetEpisodeImageAccessByIDForSession(ctx context.Context, arg dbmodels.GetEpisodeImageAccessByIDForSessionParams) (dbmodels.GetEpisodeImageAccessByIDForSessionRow, error)
	GetEpisodeImagePublicAccessByIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams) (dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow, error)
	GetSessionByTokenHashForTenant(ctx context.Context, arg dbmodels.GetSessionByTokenHashForTenantParams) (dbmodels.Session, error)
}

type TenantScopedQuerierFactory interface {
	ForTenant(ctx context.Context, tenantID uuid.UUID) (TenantScopedQuerier, func(), error)
}

type ObjectResult struct {
	Body          io.ReadCloser
	ContentType   string
	ContentLength int64
}

var ErrObjectNotFound = errors.New("object not found")

type ObjectStore interface {
	GetObject(ctx context.Context, key string) (ObjectResult, error)
}

type Handler struct {
	resolverQuerier ResolverQuerier
	tenantFactory   TenantScopedQuerierFactory
	objects         ObjectStore
	logger          *slog.Logger
}

func NewHandler(resolver ResolverQuerier, tenantFactory TenantScopedQuerierFactory, objects ObjectStore, logger *slog.Logger) http.Handler {
	h := &Handler{resolverQuerier: resolver, tenantFactory: tenantFactory, objects: objects, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.handleHealthz)
	mux.HandleFunc("GET /images/creators/{media_id}", h.handleGetCreatorImage)
	mux.HandleFunc("GET /images/episodes/{media_id}", h.handleGetEpisodeImage)
	return mux
}

func (h *Handler) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (h *Handler) handleGetEpisodeImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.Error("failed to resolve tenant from host", "error", err, "host", r.Host)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	mediaID, err := uuid.Parse(r.PathValue("media_id"))
	if err != nil {
		http.Error(w, "invalid media_id", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantFactory.ForTenant(ctx, tenant.ID)
	if err != nil {
		h.logger.Error("failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	objectKey := ""
	contentTypeFromDB := ""
	cacheControl := "public, max-age=3600"

	sessionToken, hasSession := requestmeta.SessionTokenFromRequest(r)
	if hasSession {
		lookup, err := auth.LookupSessionByTokenHashForTenant(
			ctx,
			tenantQueries,
			tenant.ID,
			auth.HashToken(sessionToken),
			time.Now(),
		)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				h.logger.Error("failed to lookup session", "error", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
		} else if lookup.State == auth.SessionStateActive {
			access, err := tenantQueries.GetEpisodeImageAccessByIDForSession(ctx, dbmodels.GetEpisodeImageAccessByIDForSessionParams{
				ID:       mediaID,
				TenantID: lookup.Session.TenantID,
				UserID:   lookup.Session.UserID,
			})
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					http.Error(w, "image not found", http.StatusNotFound)
					return
				}
				h.logger.Error("failed to evaluate session image access", "error", err, "media_id", mediaID.String())
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if access.IsPublished.Valid && access.IsPublished.Bool && access.HasAccess.Valid && access.HasAccess.Bool {
				objectKey = access.ObjectKey
				contentTypeFromDB = access.ContentType
				cacheControl = "private, max-age=60"
			}
		}
	}

	if objectKey == "" {
		publicAccess, err := tenantQueries.GetEpisodeImagePublicAccessByIDForTenant(ctx, dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams{
			ID:       mediaID,
			TenantID: tenant.ID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "image not found", http.StatusNotFound)
				return
			}
			h.logger.Error("failed to evaluate public image access", "error", err, "media_id", mediaID.String())
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if !(publicAccess.IsPublished.Valid && publicAccess.IsPublished.Bool) || !publicAccess.HasPublicAccess {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		objectKey = publicAccess.ObjectKey
		contentTypeFromDB = publicAccess.ContentType
	}

	object, err := h.objects.GetObject(ctx, objectKey)
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.Error("failed to load image object", "error", err, "object_key", objectKey)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer object.Body.Close()

	contentType := strings.TrimSpace(contentTypeFromDB)
	if contentType == "" {
		contentType = strings.TrimSpace(object.ContentType)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", cacheControl)
	if strings.HasPrefix(cacheControl, "private") {
		w.Header().Set("Vary", "Cookie")
	}
	if object.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(object.ContentLength, 10))
	}

	if _, err := io.Copy(w, object.Body); err != nil {
		h.logger.Error("failed to stream image", "error", err, "media_id", mediaID.String())
	}
}

func (h *Handler) handleGetCreatorImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.Error("failed to resolve tenant from host", "error", err, "host", r.Host)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	mediaID, err := uuid.Parse(r.PathValue("media_id"))
	if err != nil {
		http.Error(w, "invalid media_id", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantFactory.ForTenant(ctx, tenant.ID)
	if err != nil {
		h.logger.Error("failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	imageRow, err := tenantQueries.GetCreatorImageByIDForTenant(ctx, dbmodels.GetCreatorImageByIDForTenantParams{
		ID:       mediaID,
		TenantID: tenant.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.Error("failed to load creator image metadata", "error", err, "media_id", mediaID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if strings.TrimSpace(imageRow.ObjectKey) == "" {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}

	object, err := h.objects.GetObject(ctx, imageRow.ObjectKey)
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.Error("failed to load creator image object", "error", err, "object_key", imageRow.ObjectKey)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer object.Body.Close()

	contentType := "application/octet-stream"
	if strings.TrimSpace(imageRow.ContentType) != "" {
		contentType = imageRow.ContentType
	} else if strings.TrimSpace(object.ContentType) != "" {
		contentType = object.ContentType
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if object.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(object.ContentLength, 10))
	}

	if _, err := io.Copy(w, object.Body); err != nil {
		h.logger.Error("failed to stream creator image", "error", err, "media_id", mediaID.String())
	}
}

func (h *Handler) resolveTenantFromHost(ctx context.Context, r *http.Request) (dbmodels.Tenant, error) {
	candidates := requestmeta.HostCandidatesFromRequest(r)
	tenant, err := h.resolverQuerier.GetTenantByDomains(ctx, candidates)
	if err == nil {
		return tenant, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return dbmodels.Tenant{}, err
	}
	return h.resolverQuerier.GetAdminTenantByDomains(ctx, candidates)
}
