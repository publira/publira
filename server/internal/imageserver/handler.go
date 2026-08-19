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

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/requestmeta"
	"github.com/publira/publira/server/internal/tracing"
)

type ResolverQuerier interface {
	GetTenantByDomains(ctx context.Context, domains []string) (dbmodels.Tenant, error)
	GetAdminTenantByDomains(ctx context.Context, domains []string) (dbmodels.Tenant, error)
}

type TenantScopedQuerier interface {
	GetCreatorImageByIDForTenant(ctx context.Context, arg dbmodels.GetCreatorImageByIDForTenantParams) (dbmodels.GetCreatorImageByIDForTenantRow, error)
	GetLabelImageVariantByTypeAndWidthForTenant(ctx context.Context, arg dbmodels.GetLabelImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow, error)
	GetSeriesImageVariantByTypeAndWidthForTenant(ctx context.Context, arg dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow, error)
	GetEpisodeImageAccessByIDForUser(ctx context.Context, arg dbmodels.GetEpisodeImageAccessByIDForUserParams) (dbmodels.GetEpisodeImageAccessByIDForUserRow, error)
	GetEpisodeImagePublicAccessByIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams) (dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow, error)
	GetUserByPublicIDForTenant(ctx context.Context, arg dbmodels.GetUserByPublicIDForTenantParams) (dbmodels.GetUserByPublicIDForTenantRow, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (dbmodels.User, error)
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
	tokens          *auth.TokenManager
	cache           ImageCache
	proxy           http.Handler
	maxConverted    int
}

func NewHandler(resolver ResolverQuerier, tenantFactory TenantScopedQuerierFactory, objects ObjectStore, logger *slog.Logger, db *sql.DB, tokens *auth.TokenManager) (*Server, error) {
	if logger == nil {
		logger = slog.Default()
	}
	h := &Handler{
		resolverQuerier: resolver,
		tenantFactory:   tenantFactory,
		objects:         objects,
		logger:          logger,
		tokens:          tokens,
		cache:           newImageCacheFromEnv(logger),
		maxConverted:    defaultMaxConvertedBytes,
	}
	origin, proxy, err := startOriginAndProxy(h)
	if err != nil {
		return nil, err
	}
	h.proxy = proxy
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))
	mux.HandleFunc("GET /images/creators/{media_id}", h.handleGetCreatorImage)
	mux.HandleFunc("GET /images/episodes/{media_id}", h.handleGetEpisodeImage)
	mux.HandleFunc("GET /images/labels/{media_id}/{variant_type}/{width}", h.handleGetLabelImage)
	mux.HandleFunc("GET /images/series/{media_id}/{variant_type}/{width}", h.handleGetSeriesImage)
	return &Server{mux: mux, origin: origin}, nil
}

func (h *Handler) handleGetEpisodeImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to resolve tenant from host", "error", err, "host", r.Host)
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
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	objectKey := ""
	contentTypeFromDB := ""
	cacheControl := "public, max-age=3600"

	if claims, ok := h.episodeImageClaims(r, tenant.ID); ok {
		access, err := h.grantedEpisodeImage(ctx, tenantQueries, tenant.ID, mediaID, claims)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "image not found", http.StatusNotFound)
				return
			}
			h.logger.ErrorContext(ctx, "failed to evaluate token image access", "error", err, "media_id", mediaID.String())
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if access != nil {
			objectKey = access.ObjectKey
			contentTypeFromDB = access.ContentType
			cacheControl = "private, max-age=60"
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
			h.logger.ErrorContext(ctx, "failed to evaluate public image access", "error", err, "media_id", mediaID.String())
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		isPublished := publicAccess.IsPublished.Valid && publicAccess.IsPublished.Bool
		if !isPublished || !publicAccess.HasPublicAccess {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		objectKey = publicAccess.ObjectKey
		contentTypeFromDB = publicAccess.ContentType
	}

	h.serveConverted(w, r, objectKey, contentTypeFromDB, cacheControl)
}

// episodeImageClaims resolves whatever credential the request carries into the
// user it speaks for. API clients send Authorization: Bearer, but a browser
// <img> cannot set a header, so an entitled reader's URL carries an
// AudienceMedia token in the query instead. Both only name a user: the grant
// itself is still read from the database by grantedEpisodeImage.
func (h *Handler) episodeImageClaims(r *http.Request, tenantID uuid.UUID) (*auth.AccessTokenClaims, bool) {
	if h.tokens == nil {
		return nil, false
	}

	rawToken, audience := "", ""
	if token, ok := requestmeta.AccessTokenFromRequest(r); ok {
		rawToken, audience = token, auth.AudiencePublic
	} else if token := strings.TrimSpace(r.URL.Query().Get(auth.MediaTokenQueryParam)); token != "" {
		rawToken, audience = token, auth.AudienceMedia
	}
	if rawToken == "" {
		return nil, false
	}

	claims, err := h.tokens.Verify(rawToken, audience)
	if err != nil {
		return nil, false
	}
	if claims.TenantID != "" && claims.TenantID != tenantID.String() {
		return nil, false
	}
	// An absent tenant means "not tenant-scoped", which a media token must
	// never be: skipping the check above would make one URL work against every
	// tenant's image-server. Both scopes are demanded here rather than trusted
	// from the issuer.
	if audience == auth.AudienceMedia {
		if strings.TrimSpace(claims.TenantID) == "" || strings.TrimSpace(claims.EpisodeID) == "" {
			return nil, false
		}
	}
	return claims, true
}

// grantedEpisodeImage evaluates a verified credential against one image. A nil
// row with a nil error means the credential unlocks nothing here — an unknown,
// disabled, or password-rotated user, an unpublished episode, no purchase or
// ticket, or a media token issued for a different episode — and the caller
// falls back to the public rule, which is the same one the API applies.
func (h *Handler) grantedEpisodeImage(
	ctx context.Context,
	tenantQueries TenantScopedQuerier,
	tenantID uuid.UUID,
	mediaID uuid.UUID,
	claims *auth.AccessTokenClaims,
) (*dbmodels.GetEpisodeImageAccessByIDForUserRow, error) {
	userRef, err := tenantQueries.GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: claims.Subject,
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	user, err := tenantQueries.GetUserByID(ctx, userRef.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
		return nil, nil
	}
	tracing.SetEndUser(ctx, user.PublicID)

	access, err := tenantQueries.GetEpisodeImageAccessByIDForUser(ctx, dbmodels.GetEpisodeImageAccessByIDForUserParams{
		ID:       mediaID,
		TenantID: tenantID,
		UserID:   user.ID,
	})
	if err != nil {
		return nil, err
	}
	// A media token unlocks the episode it was issued for and no other. The
	// URL is readable by anyone it reaches, so this is what keeps a shared
	// link from covering the reader's whole library until it expires.
	if claims.EpisodeID != "" && claims.EpisodeID != access.EpisodeID.String() {
		return nil, nil
	}
	isPublished := access.IsPublished.Valid && access.IsPublished.Bool
	hasAccess := access.HasAccess.Valid && access.HasAccess.Bool
	if !isPublished || !hasAccess {
		return nil, nil
	}
	return &access, nil
}

func (h *Handler) handleGetCreatorImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to resolve tenant from host", "error", err, "host", r.Host)
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
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
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
		h.logger.ErrorContext(ctx, "failed to load creator image metadata", "error", err, "media_id", mediaID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if strings.TrimSpace(imageRow.ObjectKey) == "" {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}

	h.serveConverted(w, r, imageRow.ObjectKey, imageRow.ContentType, "public, max-age=3600")
}

func (h *Handler) handleGetSeriesImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to resolve tenant from host", "error", err, "host", r.Host)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	mediaID, err := uuid.Parse(r.PathValue("media_id"))
	variantType := strings.TrimSpace(r.PathValue("variant_type"))
	if variantType == "" {
		http.Error(w, "variant_type is required", http.StatusBadRequest)
		return
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(r.PathValue("width")))
	if widthErr != nil || width <= 0 {
		http.Error(w, "invalid width", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "invalid media_id", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantFactory.ForTenant(ctx, tenant.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	imageRow, err := tenantQueries.GetSeriesImageVariantByTypeAndWidthForTenant(ctx, dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams{
		SeriesImageID: mediaID,
		TenantID:      tenant.ID,
		VariantType:   variantType,
		Width:         int32(width),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to load series image metadata", "error", err, "media_id", mediaID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if strings.TrimSpace(imageRow.ObjectKey) == "" {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}

	h.serveConverted(w, r, imageRow.ObjectKey, imageRow.ContentType, "public, max-age=3600")
}

func (h *Handler) handleGetLabelImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	tenant, err := h.resolveTenantFromHost(ctx, r)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "tenant not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to resolve tenant from host", "error", err, "host", r.Host)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	mediaID, err := uuid.Parse(r.PathValue("media_id"))
	variantType := strings.TrimSpace(r.PathValue("variant_type"))
	if variantType == "" {
		http.Error(w, "variant_type is required", http.StatusBadRequest)
		return
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(r.PathValue("width")))
	if widthErr != nil || width <= 0 {
		http.Error(w, "invalid width", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "invalid media_id", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantFactory.ForTenant(ctx, tenant.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	imageRow, err := tenantQueries.GetLabelImageVariantByTypeAndWidthForTenant(ctx, dbmodels.GetLabelImageVariantByTypeAndWidthForTenantParams{
		LabelImageID: mediaID,
		TenantID:     tenant.ID,
		VariantType:  variantType,
		Width:        int32(width),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to load label image metadata", "error", err, "media_id", mediaID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if strings.TrimSpace(imageRow.ObjectKey) == "" {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}

	h.serveConverted(w, r, imageRow.ObjectKey, imageRow.ContentType, "public, max-age=3600")
}

func (h *Handler) resolveTenantFromHost(ctx context.Context, r *http.Request) (dbmodels.Tenant, error) {
	candidates := requestmeta.HostCandidatesFromRequest(r)
	tenant, err := h.resolverQuerier.GetTenantByDomains(ctx, candidates)
	if err == nil {
		tracing.SetTenant(ctx, tenant.PublicID)
		return tenant, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return dbmodels.Tenant{}, err
	}
	tenant, err = h.resolverQuerier.GetAdminTenantByDomains(ctx, candidates)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tracing.SetTenant(ctx, tenant.PublicID)
	return tenant, nil
}
