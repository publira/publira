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
	GetTenantImageVariantByTypeForTenant(ctx context.Context, arg dbmodels.GetTenantImageVariantByTypeForTenantParams) (dbmodels.GetTenantImageVariantByTypeForTenantRow, error)
	GetLabelImageVariantByTypeAndWidthForTenant(ctx context.Context, arg dbmodels.GetLabelImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow, error)
	GetSeriesImageVariantByTypeAndWidthForTenant(ctx context.Context, arg dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow, error)
	GetEpisodeImageAccessByIDForUser(ctx context.Context, arg dbmodels.GetEpisodeImageAccessByIDForUserParams) (dbmodels.GetEpisodeImageAccessByIDForUserRow, error)
	GetEpisodeImageByIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeImageByIDForTenantParams) (dbmodels.GetEpisodeImageByIDForTenantRow, error)
	GetEpisodeImagePublicAccessByIDForTenant(ctx context.Context, arg dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams) (dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow, error)
	GetUserByPublicIDForTenant(ctx context.Context, arg dbmodels.GetUserByPublicIDForTenantParams) (dbmodels.GetUserByPublicIDForTenantRow, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (dbmodels.User, error)
	ListTenantUserRoles(ctx context.Context, userID uuid.UUID) ([]string, error)
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
	// previewForTenantStaff is set on admin-image-server. It accepts
	// AudienceAdminMedia query tokens and serves an episode image when the
	// named user holds a tenant staff role, ignoring publish state and price.
	// Public image-server leaves it false, so those tokens never unlock a body
	// there.
	previewForTenantStaff bool
}

func NewHandler(resolver ResolverQuerier, tenantFactory TenantScopedQuerierFactory, objects ObjectStore, logger *slog.Logger, db *sql.DB, tokens *auth.TokenManager) (*Server, error) {
	return newHandler(resolver, tenantFactory, objects, logger, db, tokens, false)
}

// NewAdminHandler is the admin-image-server constructor. Episode bodies are
// still gated, but a tenant-staff admin-media token unlocks them regardless of
// publish state or price.
func NewAdminHandler(resolver ResolverQuerier, tenantFactory TenantScopedQuerierFactory, objects ObjectStore, logger *slog.Logger, db *sql.DB, tokens *auth.TokenManager) (*Server, error) {
	return newHandler(resolver, tenantFactory, objects, logger, db, tokens, true)
}

func newHandler(resolver ResolverQuerier, tenantFactory TenantScopedQuerierFactory, objects ObjectStore, logger *slog.Logger, db *sql.DB, tokens *auth.TokenManager, previewForTenantStaff bool) (*Server, error) {
	if logger == nil {
		logger = slog.Default()
	}
	h := &Handler{
		resolverQuerier:       resolver,
		tenantFactory:         tenantFactory,
		objects:               objects,
		logger:                logger,
		tokens:                tokens,
		cache:                 newImageCacheFromEnv(logger),
		maxConverted:          defaultMaxConvertedBytes,
		previewForTenantStaff: previewForTenantStaff,
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
	mux.HandleFunc("GET /images/tenants/{media_id}/{variant_type}", h.handleGetTenantImage)
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

	if objectKey == "" && h.previewForTenantStaff {
		if claims, ok := h.adminEpisodeImageClaims(r, tenant.ID); ok {
			access, err := h.grantedAdminEpisodeImage(ctx, tenantQueries, tenant.ID, mediaID, claims)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					http.Error(w, "image not found", http.StatusNotFound)
					return
				}
				h.logger.ErrorContext(ctx, "failed to evaluate admin image access", "error", err, "media_id", mediaID.String())
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if access != nil {
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
	user, err := h.activeUserForClaims(ctx, tenantQueries, tenantID, claims)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, nil
	}

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

// adminEpisodeImageClaims is the admin-image-server counterpart of
// episodeImageClaims. Only AudienceAdminMedia on the query is accepted: an
// admin access token in the URL would be a session, and a reader media token
// is evaluated on the public path instead.
func (h *Handler) adminEpisodeImageClaims(r *http.Request, tenantID uuid.UUID) (*auth.AccessTokenClaims, bool) {
	if h.tokens == nil {
		return nil, false
	}
	rawToken := strings.TrimSpace(r.URL.Query().Get(auth.MediaTokenQueryParam))
	if rawToken == "" {
		return nil, false
	}
	claims, err := h.tokens.Verify(rawToken, auth.AudienceAdminMedia)
	if err != nil {
		return nil, false
	}
	if claims.TenantID != tenantID.String() {
		return nil, false
	}
	if strings.TrimSpace(claims.EpisodeID) == "" {
		return nil, false
	}
	return claims, true
}

// grantedAdminEpisodeImage evaluates a verified admin-media token against one
// image. Tenant staff see the body regardless of publish state or price; a
// nil row with a nil error means the credential is not staff (or is scoped
// to a different episode) and the caller falls back to the public rule.
func (h *Handler) grantedAdminEpisodeImage(
	ctx context.Context,
	tenantQueries TenantScopedQuerier,
	tenantID uuid.UUID,
	mediaID uuid.UUID,
	claims *auth.AccessTokenClaims,
) (*dbmodels.GetEpisodeImageByIDForTenantRow, error) {
	user, err := h.activeUserForClaims(ctx, tenantQueries, tenantID, claims)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, nil
	}
	roles, err := tenantQueries.ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if !auth.IsTenantStaff(roles) {
		return nil, nil
	}

	access, err := tenantQueries.GetEpisodeImageByIDForTenant(ctx, dbmodels.GetEpisodeImageByIDForTenantParams{
		ID:       mediaID,
		TenantID: tenantID,
	})
	if err != nil {
		return nil, err
	}
	if claims.EpisodeID != access.EpisodeID.String() {
		return nil, nil
	}
	return &access, nil
}

func (h *Handler) activeUserForClaims(
	ctx context.Context,
	tenantQueries TenantScopedQuerier,
	tenantID uuid.UUID,
	claims *auth.AccessTokenClaims,
) (*dbmodels.User, error) {
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
	return &user, nil
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

// handleGetTenantImage serves a tenant branding image — the logo or the
// icon, named by variant_type the way the series route names its aspect
// ratio. The tenant is resolved from the host, so a media id only ever resolves
// against the tenant whose domain the request arrived on. Renditions are not
// stored per size: Manael resizes the stored master when the request carries
// its `w` parameter.
func (h *Handler) handleGetTenantImage(w http.ResponseWriter, r *http.Request) {
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
	variantType := strings.TrimSpace(r.PathValue("variant_type"))
	if variantType == "" {
		http.Error(w, "variant_type is required", http.StatusBadRequest)
		return
	}

	tenantQueries, cleanup, err := h.tenantFactory.ForTenant(ctx, tenant.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to initialize tenant scoped queries", "error", err, "tenant_id", tenant.ID.String())
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	imageRow, err := tenantQueries.GetTenantImageVariantByTypeForTenant(ctx, dbmodels.GetTenantImageVariantByTypeForTenantParams{
		TenantImageID: mediaID,
		TenantID:      tenant.ID,
		VariantType:   variantType,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}
		h.logger.ErrorContext(ctx, "failed to load tenant image metadata", "error", err, "media_id", mediaID.String())
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
