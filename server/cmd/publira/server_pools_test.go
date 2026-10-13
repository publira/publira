package main

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"image"
	"image/png"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/testutil"
)

// Every surface reads the platform's settings it needs on its own pool: the
// public API's search and the storefront's images as publira_public, the
// tenant console's images and uploads as publira_admin. A pool a request must
// not reach is a silentPool, so a read on it fails the test however the
// handler would have recovered from it.
func TestEachSurfaceReadsItsSettingsOnItsOwnPool(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant, preview := seedPreviewPage(t, pg)

	t.Run("the public API searches as publira_public alone", func(t *testing.T) {
		base := serveOnPools(t, serverPools{
			public:   pg.OpenPublicDB(t),
			admin:    silentPool(t, "publira_admin"),
			platform: silentPool(t, "publira_platform"),
		})
		catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, base+"/api")))
		if _, err := catalog.SearchPublishedSeries(t.Context(), &publirav1.SearchPublishedSeriesRequest{
			Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
			Query:  "Harbor",
		}); err != nil {
			t.Fatalf("SearchPublishedSeries: %v", err)
		}
	})

	// No object store is saved, so the image is refused once its settings
	// are read: a 503 says they were read, and read on a pool granted them.
	t.Run("a storefront image is answered as publira_public alone", func(t *testing.T) {
		base := serveOnPools(t, serverPools{
			public:   pg.OpenPublicDB(t),
			admin:    silentPool(t, "publira_admin"),
			platform: silentPool(t, "publira_platform"),
		})
		assertImageStatus(t, base+preview, tenant.Domain, http.StatusServiceUnavailable)
	})

	// The host is looked up as a storefront's first, since the site is not
	// known until one of the lookups answers; that lookup is all the public
	// pool may see.
	t.Run("a console image is answered as publira_admin", func(t *testing.T) {
		public, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		t.Cleanup(func() { _ = public.Close() })
		mock.ExpectQuery("GetTenantByDomains").WillReturnRows(sqlmock.NewRows([]string{"id"}))

		base := serveOnPools(t, serverPools{
			public:   public,
			admin:    pg.OpenAdminDB(t),
			platform: silentPool(t, "publira_platform"),
		})
		assertImageStatus(t, base+preview, "admin-"+tenant.Domain, http.StatusServiceUnavailable)
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("public pool: %v", err)
		}
	})

	t.Run("a console upload reads the object store as publira_admin", func(t *testing.T) {
		admin := pg.SeedTenantAdmin(t, tenant.ID, "TAUSER01", "admin@tenant-a.example.com", "Admin")
		token, _, err := testutil.TokenManager().Issue(admin.PublicID, auth.AudienceAdmin, tenant.ID.String(), admin.Role, admin.CredentialsVersion, time.Now())
		if err != nil {
			t.Fatalf("issue an admin token: %v", err)
		}
		base := serveOnPools(t, serverPools{
			public:   pg.OpenPublicDB(t),
			admin:    pg.OpenAdminDB(t),
			platform: silentPool(t, "publira_platform"),
		})
		themes := publiraadminv1connect.NewTenantThemeServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, base+"/api")))
		_, err = themes.UploadTenantIcon(testutil.WithBearer(t.Context(), token), &publiraadminv1.UploadTenantIconRequest{
			Tenant:          &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
			IconData:        squarePNG(t),
			IconContentType: "image/png",
		})
		if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
			t.Fatalf("UploadTenantIcon code = %v (%v), want %v for a platform with no object store saved", code, err, connect.CodeFailedPrecondition)
		}
	})
}

// seedPreviewPage seeds a tenant with a published series and the first page
// of a published episode, and answers the tenant and the path of that page's
// preview, which anyone may read.
func seedPreviewPage(t *testing.T, pg *testutil.PostgresEnv) (testutil.Tenant, string) {
	t.Helper()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Harbor", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "One", Status: testutil.EpisodeStatusPublished})
	page := pg.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	return tenant, "/images/episodes/" + page.String() + "/preview"
}

// serveOnPools serves what `publira server` builds on pools, and answers its
// base URL.
func serveOnPools(t *testing.T, pools serverPools) string {
	t.Helper()
	t.Setenv("PUBLIRA_REDIS_URL", "disabled")

	built, err := assembleServer(shared{logger: slog.Default()}, serverConfig{
		idTokens:  signin.VerifierConfig{},
		clientIPs: clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}),
		tokens:    testutil.TokenManager(),
	}, pools)
	if err != nil {
		t.Fatalf("assembleServer: %v", err)
	}
	ts := httptest.NewServer(built.handler)
	t.Cleanup(func() {
		ts.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, drain := range built.drain {
			_ = drain(ctx)
		}
		_ = built.close()
	})
	return ts.URL
}

func assertImageStatus(t *testing.T, url, host string, want int) {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	req.Host = host
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("GET %s on %s status = %d, want %d", url, host, resp.StatusCode, want)
	}
}

func squarePNG(t *testing.T) []byte {
	t.Helper()

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 128, 128))); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

// silentPool stands in for a login a request must not reach: the first
// connection it is asked for fails the test.
func silentPool(t *testing.T, login string) *sql.DB {
	t.Helper()

	db := sql.OpenDB(silentConnector{t: t, login: login})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

type silentConnector struct {
	t     *testing.T
	login string
}

func (c silentConnector) Connect(context.Context) (driver.Conn, error) {
	c.t.Errorf("a connection was opened as %s", c.login)
	return nil, errSilentPool
}

func (c silentConnector) Driver() driver.Driver { return silentDriver{} }

type silentDriver struct{}

func (silentDriver) Open(string) (driver.Conn, error) { return nil, errSilentPool }

var errSilentPool = errors.New("this login must not be reached")
