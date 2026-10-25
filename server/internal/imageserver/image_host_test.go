package imageserver

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/tenantstatus"
)

// An image host is another origin than the storefront's pages, so what the
// viewer reads cross-origin has to be allowed and exposed there, while the
// tenant's own domain and console host keep answering as they did.
func TestAnImageHostIsAnsweredAsTheStorefrontWithCORS(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	tenant := dbmodels.Tenant{
		ID:          tenantID,
		Domain:      "example.test",
		ImageDomain: sql.NullString{String: "images.example.test", Valid: true},
	}
	queries := stubTenantQueries{
		creator: dbmodels.GetCreatorImageByIDForTenantRow{
			ObjectKey:   "creators/avatar.jpg",
			ContentType: "image/jpeg",
		},
	}

	for _, tc := range []struct {
		name     string
		resolver stubResolver
		login    string
		cors     bool
	}{
		{"the image host", stubResolver{tenant: tenant, images: true}, "publira_public", true},
		{"the storefront domain", stubResolver{tenant: tenant}, "publira_public", false},
		{"the console host", stubResolver{tenant: tenant, console: true}, "publira_admin", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			used := ""
			srv := newTestServerWithSites(t,
				tc.resolver,
				SiteDB{Tenants: recordingFactory{login: "publira_public", q: queries, used: &used}},
				SiteDB{Tenants: recordingFactory{login: "publira_admin", q: queries, used: &used}},
				&countingStore{objects: map[string]storedObject{
					"creators/avatar.jpg": {data: testJPEG(), contentType: "image/jpeg"},
				}},
				auth.NewTokenManager([]byte(testMediaJWTSecret)),
			)

			req := httptest.NewRequest(http.MethodGet, "/images/creators/"+mediaID.String(), nil)
			req.Host = "images.example.test"
			req.Header.Set("Origin", "https://example.test")
			req.Header.Set("Accept", "image/webp")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
			}
			if used != tc.login {
				t.Errorf("answered as %q, want %q", used, tc.login)
			}
			assertImageHostCORS(t, rec, tc.cors)
		})
	}
}

func assertImageHostCORS(t *testing.T, rec *httptest.ResponseRecorder, want bool) {
	t.Helper()
	allowOrigin := rec.Header().Get("Access-Control-Allow-Origin")
	exposeHeaders := rec.Header().Get("Access-Control-Expose-Headers")
	if !want {
		if allowOrigin != "" || exposeHeaders != "" {
			t.Errorf("CORS headers = %q / %q, want none", allowOrigin, exposeHeaders)
		}
		return
	}
	if allowOrigin != "https://example.test" {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", allowOrigin, "https://example.test")
	}
	for _, header := range []string{imageEncryptionHeader, imageContentTypeHeader, imageKeyIDHeader} {
		if !strings.Contains(exposeHeaders, header) {
			t.Errorf("Access-Control-Expose-Headers = %q, want it to name %s", exposeHeaders, header)
		}
	}
}

// The image host is a storefront host: a free body leaves it encrypted, the
// way it leaves the domain, and a staff preview token is not honoured on it.
func TestAnImageHostServesEpisodeBodiesAsTheStorefront(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	episodeID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	userID := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	tokens := auth.NewTokenManager([]byte(testMediaJWTSecret))
	images := stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}, images: true}

	serve := func(t *testing.T, queries stubTenantQueries, token string) *httptest.ResponseRecorder {
		t.Helper()
		srv := newTestServerWithTokens(t,
			images,
			stubFactory{q: queries},
			&countingStore{objects: map[string]storedObject{
				"episodes/page.jpg": {data: testJPEG(), contentType: "image/jpeg"},
			}},
			tokens,
		)
		req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String()+"?"+auth.MediaTokenQueryParam+"="+url.QueryEscape(token), nil)
		req.Host = "images.example.test"
		req.Header.Set("Accept", "image/webp")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}

	t.Run("a free body is encrypted", func(t *testing.T) {
		token, _, err := tokens.IssueFreeEpisodeMediaToken(tenantID.String(), episodeID.String(), time.Now())
		if err != nil {
			t.Fatalf("IssueFreeEpisodeMediaToken() error = %v", err)
		}
		rec := serve(t, stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				EpisodeID:       episodeID,
				ObjectKey:       "episodes/page.jpg",
				ContentType:     "image/jpeg",
				IsPublished:     true,
				HasPublicAccess: true,
			},
			userRefErr: sql.ErrNoRows,
		}, token)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get(imageEncryptionHeader); got != imageEncryptionAlgorithm {
			t.Errorf("%s = %q, want %q", imageEncryptionHeader, got, imageEncryptionAlgorithm)
		}
		assertImageHostCORS(t, rec, true)
	})

	t.Run("an admin-media token is not honoured", func(t *testing.T) {
		token, _, err := tokens.IssueAdminMediaToken("admin-public-id", tenantID.String(), episodeID.String(), 4, time.Now())
		if err != nil {
			t.Fatalf("IssueAdminMediaToken() error = %v", err)
		}
		rec := serve(t, unpublishedPaidEpisodeQueries(mediaID, episodeID, userID, 4, tenantID, []string{auth.RoleTenantAdmin}), token)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
		assertImageHostCORS(t, rec, true)
	})
}

func TestAnImageHostRefusesWhatTheStorefrontRefuses(t *testing.T) {
	t.Setenv(tenantorigin.SchemeEnv, "")
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")

	serve := func(t *testing.T, resolver stubResolver) *httptest.ResponseRecorder {
		t.Helper()
		srv := newTestServer(t, resolver, stubFactory{q: stubTenantQueries{}}, &countingStore{})
		req := httptest.NewRequest(http.MethodGet, "/images/creators/"+mediaID.String(), nil)
		req.Host = "images.example.test"
		req.Header.Set("Accept", "image/webp")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}

	t.Run("a host no tenant serves is not found", func(t *testing.T) {
		rec := serve(t, stubResolver{err: sql.ErrNoRows, images: true})
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
		assertImageHostCORS(t, rec, false)
	})

	// The refusal carries the CORS headers too, so the viewer reads the status
	// rather than an opaque network error.
	t.Run("a suspended tenant is forbidden", func(t *testing.T) {
		rec := serve(t, stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test", Status: tenantstatus.Suspended}, images: true})
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
		assertImageHostCORS(t, rec, true)
	})
}
