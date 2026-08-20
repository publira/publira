package imageserver

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type stubResolver struct {
	tenant dbmodels.Tenant
	err    error
}

func (s stubResolver) GetTenantByDomains(context.Context, []string) (dbmodels.Tenant, error) {
	return s.tenant, s.err
}

func (s stubResolver) GetAdminTenantByDomains(context.Context, []string) (dbmodels.Tenant, error) {
	return dbmodels.Tenant{}, sql.ErrNoRows
}

type stubTenantQueries struct {
	public           dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow
	publicErr        error
	creator          dbmodels.GetCreatorImageByIDForTenantRow
	creatorErr       error
	tenant           dbmodels.GetTenantImageVariantByTypeForTenantRow
	tenantErr        error
	tenantKey        tenantVariantKey
	tenantParams     *dbmodels.GetTenantImageVariantByTypeForTenantParams
	userRef          dbmodels.GetUserByPublicIDForTenantRow
	userRefErr       error
	user             dbmodels.User
	userErr          error
	userAccess       dbmodels.GetEpisodeImageAccessByIDForUserRow
	userAccessErr    error
	adminImage       dbmodels.GetEpisodeImageByIDForTenantRow
	adminImageErr    error
	adminImageTenant uuid.UUID
	roles            []string
	rolesErr         error
}

func (s stubTenantQueries) GetCreatorImageByIDForTenant(context.Context, dbmodels.GetCreatorImageByIDForTenantParams) (dbmodels.GetCreatorImageByIDForTenantRow, error) {
	return s.creator, s.creatorErr
}

// tenantVariantKey is the tuple the real query filters on. The stub answers
// only for an exact match so that a handler which dropped the tenant or the
// variant type from the lookup fails the test instead of being served a row.
type tenantVariantKey struct {
	tenantImageID uuid.UUID
	tenantID      uuid.UUID
	variantType   string
}

func (s stubTenantQueries) GetTenantImageVariantByTypeForTenant(_ context.Context, arg dbmodels.GetTenantImageVariantByTypeForTenantParams) (dbmodels.GetTenantImageVariantByTypeForTenantRow, error) {
	if s.tenantParams != nil {
		*s.tenantParams = arg
	}
	if s.tenantErr != nil {
		return dbmodels.GetTenantImageVariantByTypeForTenantRow{}, s.tenantErr
	}
	requested := tenantVariantKey{
		tenantImageID: arg.TenantImageID,
		tenantID:      arg.TenantID,
		variantType:   arg.VariantType,
	}
	if s.tenant.ObjectKey == "" || requested != s.tenantKey {
		return dbmodels.GetTenantImageVariantByTypeForTenantRow{}, sql.ErrNoRows
	}
	return s.tenant, nil
}

func (s stubTenantQueries) GetLabelImageVariantByTypeAndWidthForTenant(context.Context, dbmodels.GetLabelImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow, error) {
	return dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetSeriesImageVariantByTypeAndWidthForTenant(context.Context, dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow, error) {
	return dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetEpisodeImageAccessByIDForUser(context.Context, dbmodels.GetEpisodeImageAccessByIDForUserParams) (dbmodels.GetEpisodeImageAccessByIDForUserRow, error) {
	return s.userAccess, s.userAccessErr
}

func (s stubTenantQueries) GetEpisodeImageByIDForTenant(_ context.Context, arg dbmodels.GetEpisodeImageByIDForTenantParams) (dbmodels.GetEpisodeImageByIDForTenantRow, error) {
	if s.adminImageErr != nil {
		return dbmodels.GetEpisodeImageByIDForTenantRow{}, s.adminImageErr
	}
	if s.adminImage.ObjectKey == "" || arg.ID != s.adminImage.ID || arg.TenantID != s.adminImageTenant {
		return dbmodels.GetEpisodeImageByIDForTenantRow{}, sql.ErrNoRows
	}
	return s.adminImage, nil
}

func (s stubTenantQueries) GetEpisodeImagePublicAccessByIDForTenant(context.Context, dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams) (dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow, error) {
	return s.public, s.publicErr
}

func (s stubTenantQueries) ListTenantUserRoles(context.Context, uuid.UUID) ([]string, error) {
	if s.rolesErr != nil {
		return nil, s.rolesErr
	}
	return s.roles, nil
}

func (s stubTenantQueries) GetUserByPublicIDForTenant(context.Context, dbmodels.GetUserByPublicIDForTenantParams) (dbmodels.GetUserByPublicIDForTenantRow, error) {
	return s.userRef, s.userRefErr
}

func (s stubTenantQueries) GetUserByID(context.Context, uuid.UUID) (dbmodels.User, error) {
	return s.user, s.userErr
}

type stubFactory struct {
	q TenantScopedQuerier
}

func (s stubFactory) ForTenant(context.Context, uuid.UUID) (TenantScopedQuerier, func(), error) {
	return s.q, func() {}, nil
}

type storedObject struct {
	data        []byte
	contentType string
}

type countingStore struct {
	mu      sync.Mutex
	gets    int
	objects map[string]storedObject
}

func (s *countingStore) GetObject(_ context.Context, key string) (ObjectResult, error) {
	s.mu.Lock()
	s.gets++
	obj, ok := s.objects[key]
	s.mu.Unlock()
	if !ok {
		return ObjectResult{}, ErrObjectNotFound
	}
	return ObjectResult{
		Body:          io.NopCloser(bytes.NewReader(obj.data)),
		ContentType:   obj.contentType,
		ContentLength: int64(len(obj.data)),
	}, nil
}

func (s *countingStore) getCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gets
}

func testJPEG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 32, 24))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func newTestServer(t *testing.T, resolver ResolverQuerier, factory TenantScopedQuerierFactory, store ObjectStore) *Server {
	t.Helper()
	return newTestServerWithTokens(t, resolver, factory, store, nil)
}

func newTestServerWithTokens(t *testing.T, resolver ResolverQuerier, factory TenantScopedQuerierFactory, store ObjectStore, tokens *auth.TokenManager) *Server {
	t.Helper()
	return newTestServerWithConstructor(t, resolver, factory, store, tokens, NewHandler)
}

func newTestServerWithConstructor(
	t *testing.T,
	resolver ResolverQuerier,
	factory TenantScopedQuerierFactory,
	store ObjectStore,
	tokens *auth.TokenManager,
	construct func(ResolverQuerier, TenantScopedQuerierFactory, ObjectStore, *slog.Logger, *sql.DB, *auth.TokenManager) (*Server, error),
) *Server {
	t.Helper()
	t.Setenv("PUBLIRA_REDIS_URL", "disabled")
	srv, err := construct(resolver, factory, store, nil, nil, tokens)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(func() {
		if err := srv.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return srv
}

func TestEpisodeImageConvertsToWebPAndCaches(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"episodes/page.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	queries := stubTenantQueries{
		public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
			ID:              mediaID,
			ObjectKey:       "episodes/page.jpg",
			ContentType:     "image/jpeg",
			IsPublished:     sql.NullBool{Bool: true, Valid: true},
			HasPublicAccess: true,
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: queries},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp,image/*,*/*;q=0.8")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("first Content-Type = %q, want image/webp", got)
	}
	if got := rec.Header().Get(imageCacheHeader); got != "miss" {
		t.Fatalf("first %s = %q, want miss", imageCacheHeader, got)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("first body is empty")
	}
	if store.getCount() != 1 {
		t.Fatalf("origin gets after miss = %d, want 1", store.getCount())
	}

	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req.Clone(context.Background()))
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d", rec2.Code)
	}
	if got := rec2.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("second Content-Type = %q, want image/webp", got)
	}
	if got := rec2.Header().Get(imageCacheHeader); got != "hit" {
		t.Fatalf("second %s = %q, want hit", imageCacheHeader, got)
	}
	if !bytes.Equal(rec.Body.Bytes(), rec2.Body.Bytes()) {
		t.Fatal("cached body differs from converted body")
	}
	if store.getCount() != 1 {
		t.Fatalf("origin gets after hit = %d, want 1", store.getCount())
	}
}

func TestEpisodeImageResizeQuery(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"episodes/page.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/page.jpg",
				ContentType:     "image/jpeg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: true,
			},
		}},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String()+"?w=16", nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q, want image/webp", got)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("resized body is empty")
	}
}

func TestEpisodeImageForbiddenWhenNotPublic(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/page.jpg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: false,
			},
		}},
		&countingStore{objects: map[string]storedObject{}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

const testMediaJWTSecret = "publira-image-server-unit-test-secret-32b"

// paidEpisodeQueries describes an episode the public rule denies, so only a
// credential naming an entitled reader can unlock the image.
func paidEpisodeQueries(mediaID, episodeID, userID uuid.UUID, credentialsVersion int32) stubTenantQueries {
	return stubTenantQueries{
		public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
			ID:              mediaID,
			ObjectKey:       "episodes/page.jpg",
			ContentType:     "image/jpeg",
			IsPublished:     sql.NullBool{Bool: true, Valid: true},
			HasPublicAccess: false,
		},
		userRef: dbmodels.GetUserByPublicIDForTenantRow{ID: userID, PublicID: "reader-public-id", Status: "active"},
		user: dbmodels.User{
			ID:                 userID,
			PublicID:           "reader-public-id",
			Status:             "active",
			CredentialsVersion: credentialsVersion,
		},
		userAccess: dbmodels.GetEpisodeImageAccessByIDForUserRow{
			ID:          mediaID,
			EpisodeID:   episodeID,
			ObjectKey:   "episodes/page.jpg",
			ContentType: "image/jpeg",
			IsPublished: sql.NullBool{Bool: true, Valid: true},
			HasAccess:   sql.NullBool{Bool: true, Valid: true},
		},
	}
}

// A browser <img> cannot send Authorization, so an entitled reader's paid body
// images arrive with the media token GetEpisodeDetail put in their URL. What
// the token buys is evaluated here against the same purchases and tickets the
// API read.
func TestEpisodeImageMediaToken(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	episodeID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	userID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	tokens := auth.NewTokenManager([]byte(testMediaJWTSecret))

	serve := func(t *testing.T, queries stubTenantQueries, token string) *httptest.ResponseRecorder {
		t.Helper()
		srv := newTestServerWithTokens(t,
			stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
			stubFactory{q: queries},
			&countingStore{objects: map[string]storedObject{
				"episodes/page.jpg": {data: testJPEG(), contentType: "image/jpeg"},
			}},
			tokens,
		)
		target := "/images/episodes/" + mediaID.String() +
			"?" + auth.MediaTokenQueryParam + "=" + url.QueryEscape(token)
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Host = "example.test"
		req.Header.Set("Accept", "image/webp")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}

	issue := func(t *testing.T, scopedEpisodeID uuid.UUID, credentialsVersion int32, issuedAt time.Time) string {
		t.Helper()
		token, _, err := tokens.IssueMediaToken("reader-public-id", tenantID.String(), scopedEpisodeID.String(), credentialsVersion, issuedAt)
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		return token
	}

	t.Run("serves the body that a purchase or ticket unlocked", func(t *testing.T) {
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), issue(t, episodeID, 4, time.Now()))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get("Cache-Control"); got != "private, max-age=60" {
			t.Errorf("Cache-Control = %q, want %q", got, "private, max-age=60")
		}
		if rec.Body.Len() == 0 {
			t.Error("body is empty")
		}
	})

	t.Run("a token issued for another episode does not unlock this one", func(t *testing.T) {
		otherEpisodeID := uuid.MustParse("88888888-8888-8888-8888-888888888888")
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), issue(t, otherEpisodeID, 4, time.Now()))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("an expired token stops working", func(t *testing.T) {
		issuedAt := time.Now().Add(-auth.MediaTokenTTL - time.Minute)
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), issue(t, episodeID, 4, issuedAt))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("a token from before a password change stops working", func(t *testing.T) {
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), issue(t, episodeID, 3, time.Now()))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	// IssueMediaToken will not mint this, so it is signed here directly: the
	// point is that image-server demands the tenant scope rather than trusting
	// the issuer to have set it.
	t.Run("a media token without a tenant does not unlock the body", func(t *testing.T) {
		claims := auth.AccessTokenClaims{
			EpisodeID:          episodeID.String(),
			CredentialsVersion: 4,
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    auth.JWTIssuer,
				Subject:   "reader-public-id",
				Audience:  jwt.ClaimStrings{auth.AudienceMedia},
				IssuedAt:  jwt.NewNumericDate(time.Now()),
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(auth.MediaTokenTTL)),
			},
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testMediaJWTSecret))
		if err != nil {
			t.Fatalf("SignedString: %v", err)
		}
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), token)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("an access token pasted into the query does not unlock the body", func(t *testing.T) {
		accessToken, _, err := tokens.Issue("reader-public-id", auth.AudiencePublic, tenantID.String(), "", 4, time.Now())
		if err != nil {
			t.Fatalf("Issue() error = %v", err)
		}
		rec := serve(t, paidEpisodeQueries(mediaID, episodeID, userID, 4), accessToken)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})
}

func unpublishedPaidEpisodeQueries(mediaID, episodeID, userID uuid.UUID, credentialsVersion int32, tenantID uuid.UUID, roles []string) stubTenantQueries {
	q := paidEpisodeQueries(mediaID, episodeID, userID, credentialsVersion)
	q.public.IsPublished = sql.NullBool{Bool: false, Valid: true}
	q.public.HasPublicAccess = false
	q.userAccess.IsPublished = sql.NullBool{Bool: false, Valid: true}
	q.userAccess.HasAccess = sql.NullBool{Bool: false, Valid: true}
	q.adminImage = dbmodels.GetEpisodeImageByIDForTenantRow{
		ID:          mediaID,
		EpisodeID:   episodeID,
		ObjectKey:   "episodes/page.jpg",
		ContentType: "image/jpeg",
	}
	q.adminImageTenant = tenantID
	q.roles = roles
	q.userRef = dbmodels.GetUserByPublicIDForTenantRow{ID: userID, PublicID: "admin-public-id", Status: "active"}
	q.user = dbmodels.User{
		ID:                 userID,
		PublicID:           "admin-public-id",
		Status:             "active",
		CredentialsVersion: credentialsVersion,
	}
	return q
}

// Admin-image-server accepts a distinct audience so a copied preview URL
// cannot be replayed against public image-server, and tenant staff can see
// draft / paid bodies the public rule would 403.
func TestEpisodeImageAdminMediaToken(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	episodeID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	userID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	tokens := auth.NewTokenManager([]byte(testMediaJWTSecret))

	serve := func(t *testing.T, queries stubTenantQueries, token string, construct func(ResolverQuerier, TenantScopedQuerierFactory, ObjectStore, *slog.Logger, *sql.DB, *auth.TokenManager) (*Server, error)) *httptest.ResponseRecorder {
		t.Helper()
		srv := newTestServerWithConstructor(t,
			stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "admin.example.test"}},
			stubFactory{q: queries},
			&countingStore{objects: map[string]storedObject{
				"episodes/page.jpg": {data: testJPEG(), contentType: "image/jpeg"},
			}},
			tokens,
			construct,
		)
		target := "/images/episodes/" + mediaID.String() +
			"?" + auth.MediaTokenQueryParam + "=" + url.QueryEscape(token)
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Host = "admin.example.test"
		req.Header.Set("Accept", "image/webp")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}

	issue := func(t *testing.T, scopedEpisodeID uuid.UUID, credentialsVersion int32, issuedAt time.Time) string {
		t.Helper()
		token, _, err := tokens.IssueAdminMediaToken("admin-public-id", tenantID.String(), scopedEpisodeID.String(), credentialsVersion, issuedAt)
		if err != nil {
			t.Fatalf("IssueAdminMediaToken() error = %v", err)
		}
		return token
	}

	staffQueries := unpublishedPaidEpisodeQueries(mediaID, episodeID, userID, 4, tenantID, []string{auth.RoleTenantEditor})

	for _, role := range []string{auth.RoleTenantAdmin, auth.RoleTenantEditor, auth.RoleTenantAuditor} {
		t.Run("serves a draft paid body to "+role, func(t *testing.T) {
			queries := unpublishedPaidEpisodeQueries(mediaID, episodeID, userID, 4, tenantID, []string{role})
			rec := serve(t, queries, issue(t, episodeID, 4, time.Now()), NewAdminHandler)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Cache-Control"); got != "private, max-age=60" {
				t.Errorf("Cache-Control = %q, want %q", got, "private, max-age=60")
			}
			if rec.Body.Len() == 0 {
				t.Error("body is empty")
			}
		})
	}

	t.Run("public image-server ignores an admin-media token", func(t *testing.T) {
		rec := serve(t, staffQueries, issue(t, episodeID, 4, time.Now()), NewHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("a reader media token does not unlock a draft on admin-image-server", func(t *testing.T) {
		token, _, err := tokens.IssueMediaToken("admin-public-id", tenantID.String(), episodeID.String(), 4, time.Now())
		if err != nil {
			t.Fatalf("IssueMediaToken() error = %v", err)
		}
		rec := serve(t, staffQueries, token, NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("a token issued for another episode does not unlock this one", func(t *testing.T) {
		otherEpisodeID := uuid.MustParse("88888888-8888-8888-8888-888888888888")
		rec := serve(t, staffQueries, issue(t, otherEpisodeID, 4, time.Now()), NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("an expired token stops working", func(t *testing.T) {
		issuedAt := time.Now().Add(-auth.MediaTokenTTL - time.Minute)
		rec := serve(t, staffQueries, issue(t, episodeID, 4, issuedAt), NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("a token from before a password change stops working", func(t *testing.T) {
		rec := serve(t, staffQueries, issue(t, episodeID, 3, time.Now()), NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("a user without a tenant staff role does not unlock the body", func(t *testing.T) {
		queries := unpublishedPaidEpisodeQueries(mediaID, episodeID, userID, 4, tenantID, nil)
		rec := serve(t, queries, issue(t, episodeID, 4, time.Now()), NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("another tenant's image is not found", func(t *testing.T) {
		otherTenantID := uuid.MustParse("99999999-9999-9999-9999-999999999999")
		queries := unpublishedPaidEpisodeQueries(mediaID, episodeID, userID, 4, otherTenantID, []string{auth.RoleTenantAdmin})
		rec := serve(t, queries, issue(t, episodeID, 4, time.Now()), NewAdminHandler)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
	})

	t.Run("an admin access token pasted into the query does not unlock the body", func(t *testing.T) {
		accessToken, _, err := tokens.Issue("admin-public-id", auth.AudienceAdmin, tenantID.String(), auth.RoleTenantEditor, 4, time.Now())
		if err != nil {
			t.Fatalf("Issue() error = %v", err)
		}
		rec := serve(t, staffQueries, accessToken, NewAdminHandler)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})
}

func TestCreatorImageConvertsToWebP(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"creators/avatar.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			creator: dbmodels.GetCreatorImageByIDForTenantRow{
				ObjectKey:   "creators/avatar.jpg",
				ContentType: "image/jpeg",
			},
		}},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/creators/"+mediaID.String(), nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q, want image/webp", got)
	}
}

func TestTenantImageServesStoredIcon(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	store := &countingStore{
		objects: map[string]storedObject{
			"tenants/acme/icons/icon.png": {data: testJPEG(), contentType: "image/png"},
		},
	}
	var params dbmodels.GetTenantImageVariantByTypeForTenantParams
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			tenant: dbmodels.GetTenantImageVariantByTypeForTenantRow{
				ObjectKey:   "tenants/acme/icons/icon.png",
				ContentType: "image/png",
			},
			tenantKey: tenantVariantKey{
				tenantImageID: mediaID,
				tenantID:      tenantID,
				variantType:   "icon",
			},
			tenantParams: &params,
		}},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/tenants/"+mediaID.String()+"/icon", nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=3600" {
		t.Fatalf("Cache-Control = %q, want public, max-age=3600", got)
	}
	if params.TenantImageID != mediaID {
		t.Fatalf("tenant_image_id = %s, want %s", params.TenantImageID, mediaID)
	}
	if params.TenantID != tenantID {
		t.Fatalf("tenant_id = %s, want %s", params.TenantID, tenantID)
	}
	if params.VariantType != "icon" {
		t.Fatalf("variant_type = %q, want icon", params.VariantType)
	}
}

// The route is keyed by variant_type, so a tenant that stored only an icon must
// not have it served as its logo.
func TestTenantImageUnknownVariantTypeReturnsNotFound(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	var params dbmodels.GetTenantImageVariantByTypeForTenantParams
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			tenant: dbmodels.GetTenantImageVariantByTypeForTenantRow{
				ObjectKey:   "tenants/acme/icons/icon.png",
				ContentType: "image/png",
			},
			tenantKey: tenantVariantKey{
				tenantImageID: mediaID,
				tenantID:      tenantID,
				variantType:   "icon",
			},
			tenantParams: &params,
		}},
		&countingStore{objects: map[string]storedObject{
			"tenants/acme/icons/icon.png": {data: testJPEG(), contentType: "image/png"},
		}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/tenants/"+mediaID.String()+"/logo", nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if params.VariantType != "logo" {
		t.Fatalf("variant_type = %q, want logo", params.VariantType)
	}
}

// The image belongs to the tenant the host resolved to, so another tenant's
// media_id must not be served even when the object exists in the store.
func TestTenantImageOfAnotherTenantReturnsNotFound(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	otherTenantID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	mediaID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			tenant: dbmodels.GetTenantImageVariantByTypeForTenantRow{
				ObjectKey:   "tenants/acme/icons/icon.png",
				ContentType: "image/png",
			},
			tenantKey: tenantVariantKey{
				tenantImageID: mediaID,
				tenantID:      otherTenantID,
				variantType:   "icon",
			},
		}},
		&countingStore{objects: map[string]storedObject{
			"tenants/acme/icons/icon.png": {data: testJPEG(), contentType: "image/png"},
		}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/tenants/"+mediaID.String()+"/icon", nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestTenantImageMissingReturnsNotFound(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("88888888-8888-8888-8888-888888888888")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{}},
		&countingStore{objects: map[string]storedObject{}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/tenants/"+mediaID.String()+"/icon", nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestRewriteOriginRequestDropsClientOriginContentType(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/x", nil)
	req.Header.Set(originContentTypeHeader, "text/html")

	cleared := rewriteOriginRequest(req, "obj", "")
	if got := cleared.Header.Get(originContentTypeHeader); got != "" {
		t.Fatalf("empty fallback left client header %q", got)
	}

	replaced := rewriteOriginRequest(req, "obj", "image/jpeg")
	if got := replaced.Header.Get(originContentTypeHeader); got != "image/jpeg" {
		t.Fatalf("header = %q, want image/jpeg", got)
	}
}

func TestEpisodeImageMissingObjectIsNotPubliclyCacheable(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/missing.jpg",
				ContentType:     "image/jpeg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: true,
			},
		}},
		&countingStore{objects: map[string]storedObject{}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

func TestServeConvertedRejectsOversizeConversion(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cache:        newMemoryCache(time.Hour, defaultMemoryMaxBytes),
		maxConverted: 8,
		logger:       slog.Default(),
		proxy: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/webp")
			_, _ = w.Write([]byte("0123456789"))
		}),
	}
	req := httptest.NewRequest(http.MethodGet, "/images/episodes/x", nil)
	rec := httptest.NewRecorder()
	h.serveConverted(rec, req, "obj", "image/jpeg", "public, max-age=3600")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if _, ok := h.cache.Get(context.Background(), cacheKey("obj", req)); ok {
		t.Fatal("oversized conversion was cached")
	}
}
