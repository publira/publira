package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
	edgeAddr := testutil.FreeAddr(t)
	internalAddr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      edgeAddr,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": internalAddr,
	}, revalidationWithoutPlatformConsole()), "server")
	p.WaitReady(t, "http://"+edgeAddr+"/readyz")
	p.WaitReady(t, "http://"+internalAddr+"/readyz")

	// The edge names the public pool alone, under the one name an outsider may
	// read; the internal listener names every login it serves.
	assertReadyChecks(t, "http://"+edgeAddr+"/readyz", "db")
	assertReadyChecks(t, "http://"+internalAddr+"/readyz", "db.public", "db.admin", "db.platform")
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

	internalAddr := testutil.FreeAddr(t)
	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      testutil.FreeAddr(t),
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": internalAddr,
	}, revalidationWithoutPlatformConsole(), env), "server")
	p.WaitReady(t, "http://"+internalAddr+"/readyz")
	return "http://" + internalAddr
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
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          addr,
	}, revalidationWithoutPlatformConsole()), "worker")
	p.WaitReady(t, "http://"+addr+"/readyz")

	// One check per pool: with three logins behind one process, a single "db"
	// could not say which of them stopped answering.
	assertReadyChecks(t, "http://"+addr+"/readyz", "db.outbox", "db.ticker", "db.content_stats")
}

// A server that hosts the worker brings up all three listeners, each with the
// readiness checks it answers with in a process of its own, and one SIGTERM
// stops all of it: the exit status is 0 only when every listener drained and
// every hook — the audit log flush, the River client, the six pools — returned
// within the shared deadline.
func TestServerWithWorkerServesBothHalvesAndStopsThemTogether(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	edgeAddr := testutil.FreeAddr(t)
	internalAddr := testutil.FreeAddr(t)
	workerAddr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      edgeAddr,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": internalAddr,
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          workerAddr,
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker")
	for _, addr := range []string{edgeAddr, internalAddr, workerAddr} {
		p.WaitReady(t, "http://"+addr+"/readyz")
		assertLive(t, "http://"+addr+"/livez")
	}

	assertReadyChecks(t, "http://"+edgeAddr+"/readyz", "db")
	assertReadyChecks(t, "http://"+internalAddr+"/readyz", "db.public", "db.admin", "db.platform")
	assertReadyChecks(t, "http://"+workerAddr+"/readyz", "db.outbox", "db.ticker", "db.content_stats")

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
		"PUBLIRA_PUBLIC_API_ADDR":         testutil.FreeAddr(t),
		"PUBLIRA_PUBLIC_API_GRPC_ADDR":    testutil.FreeAddr(t),
		"PUBLIRA_WORKER_DB_URL":           pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":           pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL":    pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":             testutil.FreeAddr(t),
		"PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE": "not-a-number",
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1; output:\n%s", code, output)
	}
	if !strings.Contains(output, "PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE") {
		t.Fatalf("output does not name PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE:\n%s", output)
	}
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
