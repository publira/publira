package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func TestMain(m *testing.M) {
	if testutil.RunMainIfChild(main) {
		return
	}
	os.Exit(m.Run())
}

// A standard deployment sets bootstrap secrets and infrastructure connections
// and nothing else; every runtime tuning value has to fall back to a default.
// Object storage is not among them: it is saved from the Platform Console this
// process serves, so the process has to start before there is one, and the
// image routes read it when an image is requested.
func TestServerStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      anyLoopbackPort,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server")
	edge := listenerURL(t, p, "server (edge)")
	internal := listenerURL(t, p, "server (internal)")
	p.WaitReady(t, edge+"/readyz")
	p.WaitReady(t, internal+"/readyz")

	// The edge names the public pool alone, under the one name an outsider may
	// read; the internal listener names every login it serves.
	assertReadyChecks(t, edge+"/readyz", "db")
	assertReadyChecks(t, internal+"/readyz", "db.public", "db.admin", "db.platform")
}

// A server serving the edge listener alone answers what the edge forwards and
// nothing else, and holds only the two logins the edge answers as. The
// platform URL names a port nothing listens on, so a process that opened that
// pool anyway would refuse to start, and the search, whose engine settings it
// reads on the admin pool, is what proves it needs no platform pool to answer.
func TestServerServesTheEdgeListenerAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	internalAddr := testutil.UnreachableAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      unreachablePlatformDBURL,
		"PUBLIRA_PUBLIC_API_ADDR":      anyLoopbackPort,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": internalAddr,
	}, revalidationWithoutPlatformConsole()), "server", "--listener", "edge")
	base := listenerURL(t, p, "server (edge)")
	p.WaitReady(t, base+"/readyz")
	assertLive(t, base+"/livez")
	assertReadyChecks(t, base+"/readyz", "db")

	assertRouteRegistered(t, base, "/api/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, base, "/images/creators/media", true)
	assertRouteRegistered(t, base, "/api/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, base, "/api/publira.platform.v1.PlatformTenantService/ListTenants", false)

	catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, base+"/api")))
	if _, err := catalog.SearchPublishedSeries(t.Context(), &publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		Query:  "Harbor",
	}); err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}

	assertNotListening(t, internalAddr)
	// The web service token is read for the console APIs alone, which this
	// process does not serve.
	if out := p.Output(); strings.Contains(out, "web service token") {
		t.Fatalf("output reports the web service token, which the edge does not read:\n%s", out)
	}

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// A server serving the internal listener alone answers all three namespaces
// to the web apps, with a readiness check per login, and leaves the edge's
// port and the image routes to another process.
func TestServerServesTheInternalListenerAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	edgeAddr := testutil.UnreachableAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      edgeAddr,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--listener", "internal")
	base := listenerURL(t, p, "server (internal)")
	p.WaitReady(t, base+"/readyz")
	assertLive(t, base+"/livez")
	assertReadyChecks(t, base+"/readyz", "db.public", "db.admin", "db.platform")

	assertRouteRegistered(t, base, "/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, base, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, base, "/publira.platform.v1.PlatformTenantService/ListTenants", true)
	assertRouteRegistered(t, base, "/images/creators/media", false)

	assertNotListening(t, edgeAddr)

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// unreachablePlatformDBURL names a port nothing listens on, so opening it
// fails at once.
const unreachablePlatformDBURL = "postgres://publira_platform:platformpass@127.0.0.1:1/publira?sslmode=disable"

// assertNotListening fails when anything accepts a connection on addr. The
// address comes from [testutil.UnreachableAddr], whose port no other server can
// be given, so a process that tried to listen on it anyway would also fail to
// bind and exit with a non-zero status.
func assertNotListening(t *testing.T, addr string) {
	t.Helper()

	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err == nil {
		_ = conn.Close()
		t.Fatalf("%s accepts connections, want nothing listening", addr)
	}
}

// The web apps' credential reaches the tenant console's tenant-level reads and
// the Platform Console's platform-level reads on the internal listener, never
// their writes, and nothing at all once the variable is unset.
func TestServerAdmitsTheWebServiceTokenOnlyWhenItIsSet(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Fantasy", Slug: "fantasy"})
	token := testutil.DeploymentSecrets()["PUBLIRA_WEB_SERVICE_TOKEN"]
	tenantCtx := &publirattypesv1.TenantContext{TenantId: tenant.ID.String()}

	t.Run("set", func(t *testing.T) {
		url := startInternalListener(t, pg, nil)
		genres := publiraadminv1connect.NewAdminGenreServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))
		settings := publiraadminv1connect.NewTenantSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))

		listed, err := genres.ListGenres(testutil.WithBearer(t.Context(), token), &publiraadminv1.ListGenresRequest{Tenant: tenantCtx})
		if err != nil {
			t.Fatalf("ListGenres: %v", err)
		}
		if len(listed.Genres) != 1 || listed.Genres[0].Name != "Fantasy" {
			t.Fatalf("genres = %v, want the tenant's one genre", listed.Genres)
		}
		_, err = genres.CreateGenre(testutil.WithBearer(t.Context(), token), &publiraadminv1.CreateGenreRequest{Tenant: tenantCtx, Name: "Mystery"})
		if code := connect.CodeOf(err); code != connect.CodePermissionDenied {
			t.Fatalf("CreateGenre code = %v, want %v", code, connect.CodePermissionDenied)
		}
		_, err = settings.GetTenantTimezone(testutil.WithBearer(t.Context(), token), &publiraadminv1.GetTenantTimezoneRequest{Tenant: tenantCtx})
		if code := connect.CodeOf(err); code != connect.CodePermissionDenied {
			t.Fatalf("GetTenantTimezone code = %v, want %v", code, connect.CodePermissionDenied)
		}

		tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))
		policy := publirasplatformv1connect.NewPlatformPolicyServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))

		listedTenants, err := tenants.ListTenants(testutil.WithBearer(t.Context(), token), &publirasplatformv1.ListTenantsRequest{})
		if err != nil {
			t.Fatalf("ListTenants: %v", err)
		}
		if len(listedTenants.Tenants) != 1 || listedTenants.Tenants[0].PublicId != tenant.PublicID {
			t.Fatalf("tenants = %v, want the one seeded tenant", listedTenants.Tenants)
		}
		_, err = tenants.CreateTenant(testutil.WithBearer(t.Context(), token), &publirasplatformv1.CreateTenantRequest{DefaultLocale: "en", Name: "Tenant B", Domain: "tenant-b.example.com"})
		if code := connect.CodeOf(err); code != connect.CodePermissionDenied {
			t.Fatalf("CreateTenant code = %v, want %v", code, connect.CodePermissionDenied)
		}
		_, err = policy.UpdatePlatformPolicy(testutil.WithBearer(t.Context(), token), &publirasplatformv1.UpdatePlatformPolicyRequest{})
		if code := connect.CodeOf(err); code != connect.CodePermissionDenied {
			t.Fatalf("UpdatePlatformPolicy code = %v, want %v", code, connect.CodePermissionDenied)
		}
	})
	t.Run("unset", func(t *testing.T) {
		url := startInternalListener(t, pg, map[string]string{"PUBLIRA_WEB_SERVICE_TOKEN": ""})
		genres := publiraadminv1connect.NewAdminGenreServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))

		_, err := genres.ListGenres(testutil.WithBearer(t.Context(), token), &publiraadminv1.ListGenresRequest{Tenant: tenantCtx})
		if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
			t.Fatalf("ListGenres code = %v, want %v", code, connect.CodeUnauthenticated)
		}
		tenants := publirasplatformv1connect.NewPlatformTenantServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, url)))
		_, err = tenants.ListTenants(testutil.WithBearer(t.Context(), token), &publirasplatformv1.ListTenantsRequest{})
		if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
			t.Fatalf("ListTenants code = %v, want %v", code, connect.CodeUnauthenticated)
		}
	})
}

// startInternalListener starts `publira server` on pg with the deployment
// secrets, overridden by env, and answers the base URL of its internal
// listener.
func startInternalListener(t *testing.T, pg *testutil.PostgresEnv, env map[string]string) string {
	t.Helper()

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      anyLoopbackPort,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole(), env), "server")
	internal := listenerURL(t, p, "server (internal)")
	p.WaitReady(t, internal+"/readyz")
	return internal
}

// A password in a redis:// URL would cross the network in cleartext, so the
// process refuses to start rather than falling back to in-process state.
func TestServerRefusesAPasswordOverPlaintextRedis(t *testing.T) {
	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_REDIS_URL": "redis://:secret@redis:6379",
	}, revalidationWithoutPlatformConsole()), "server")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, "PUBLIRA_REDIS_URL") || !strings.Contains(output, "rediss://") {
		t.Fatalf("output does not name PUBLIRA_REDIS_URL and rediss://:\n%s", output)
	}
}

// The worker starts on the same footing. Object storage is not among what it
// needs either: the orphan image sweep is the only job that needs a bucket,
// and it resolves one from the platform's settings when a run starts.
func TestWorkerStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "worker")
	worker := listenerURL(t, p, "worker")
	p.WaitReady(t, worker+"/readyz")

	// One check per pool: with three logins behind one process, a single "db"
	// could not say which of them stopped answering.
	assertReadyChecks(t, worker+"/readyz", "db.outbox", "db.ticker", "db.content_stats")
}

// A server that hosts the worker brings up all three listeners, each with the
// readiness checks it answers with in a process of its own, and one SIGTERM
// stops all of it: the exit status is 0 only when every listener drained and
// every hook — the audit log flush, the River client, the six pools — returned
// within the shared deadline.
func TestServerWithWorkerServesBothHalvesAndStopsThemTogether(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      anyLoopbackPort,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": anyLoopbackPort,
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker")
	edge := listenerURL(t, p, "server (edge)")
	internal := listenerURL(t, p, "server (internal)")
	worker := listenerURL(t, p, "worker")
	for _, url := range []string{edge, internal, worker} {
		p.WaitReady(t, url+"/readyz")
		assertLive(t, url+"/livez")
	}

	assertReadyChecks(t, edge+"/readyz", "db")
	assertReadyChecks(t, internal+"/readyz", "db.public", "db.admin", "db.platform")
	assertReadyChecks(t, worker+"/readyz", "db.outbox", "db.ticker", "db.content_stats")

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// Either half failing to initialize stops the process, as it does when that
// half runs alone. The worker is built after the server, so a worker that
// cannot start is also the case where a built half has to be taken down.
func TestServerWithWorkerRefusesToStartWhenTheWorkerCannot(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":           pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":            pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":         pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":         anyLoopbackPort,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR":    anyLoopbackPort,
		"PUBLIRA_WORKER_DB_URL":           pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":           pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL":    pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":             anyLoopbackPort,
		"PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE": "not-a-number",
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1; output:\n%s", code, output)
	}
	if !strings.Contains(output, "PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE") {
		t.Fatalf("output does not name PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE:\n%s", output)
	}
}

// anyLoopbackPort is the address every listener a test starts is given: the
// process binds whatever port the kernel picks, and listenerURL reads it back.
// A port picked by the test and freed before the process binds it can be taken
// in between by a server of another package's tests, and that server would
// then answer for the process under test.
const anyLoopbackPort = "127.0.0.1:0"

// listenerURL waits for p to log the address the listener its startup log
// calls name has bound, and answers that listener's base URL.
func listenerURL(t *testing.T, p *testutil.Process, name string) string {
	t.Helper()
	m := p.WaitOutput(t, regexp.MustCompile(`msg="starting `+regexp.QuoteMeta(name)+`" addr=(\S+)`))
	return "http://" + m[1]
}

// revalidationWithoutPlatformConsole is where a deployment that runs no
// Platform Console sends cache tags: the storefront and the tenant console,
// and no web-platform URL at all.
func revalidationWithoutPlatformConsole() map[string]string {
	return map[string]string{
		"PUBLIRA_WEB_STOREFRONT_INTERNAL_URL": "http://web-storefront:3000",
		"PUBLIRA_WEB_ADMIN_INTERNAL_URL":      "http://web-admin:4000",
	}
}

// A revalidate token with no web app to send to can only be a mistake, so both
// processes refuse to start and name the variables that would have fixed it.
func TestRefusesARevalidateTokenWithNoDestination(t *testing.T) {
	for _, args := range [][]string{{"server"}, {"worker"}, {"server", "--with-worker"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets()), args...)
			if code == 0 {
				t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
			}
			for _, env := range []string{
				"PUBLIRA_WEB_STOREFRONT_INTERNAL_URL",
				"PUBLIRA_WEB_ADMIN_INTERNAL_URL",
				"PUBLIRA_WEB_PLATFORM_INTERNAL_URL",
			} {
				if !strings.Contains(output, env) {
					t.Fatalf("output does not name %s:\n%s", env, output)
				}
			}
		})
	}
}

// Without a command the binary is nothing a deployment can run, and it says
// so rather than picking one.
func TestRefusesToStartWithoutACommand(t *testing.T) {
	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets()))
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, "Usage: publira <command>") {
		t.Fatalf("output does not carry the usage text:\n%s", output)
	}
}

// assertLive fails unless url answers 200.
func assertLive(t *testing.T, url string) {
	t.Helper()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("liveness request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("liveness request: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%s status = %d, want %d", url, resp.StatusCode, http.StatusOK)
	}
}

// assertReadyChecks fails unless /readyz names exactly the given checks, so a
// pool a listener serves without registering a check of its own is caught
// here rather than by an operator reading an unexplained 503.
func assertReadyChecks(t *testing.T, url string, want ...string) {
	t.Helper()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("readiness request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("readiness request: %v", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	var body struct {
		Checks map[string]struct {
			Status string `json:"status"`
		} `json:"checks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode /readyz: %v", err)
	}
	if len(body.Checks) != len(want) {
		t.Fatalf("checks = %v, want exactly %v", body.Checks, want)
	}
	for _, name := range want {
		check, ok := body.Checks[name]
		if !ok {
			t.Fatalf("checks = %v, want one named %q", body.Checks, name)
		}
		if check.Status != "ok" {
			t.Fatalf("%s status = %q, want ok", name, check.Status)
		}
	}
}
