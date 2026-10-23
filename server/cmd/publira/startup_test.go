package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/sqldb"
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
		"PUBLIRA_PUBLIC_DB_URL":   pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":    pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL": pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	assertLive(t, base+"/livez")

	// One check per login, so a failure says which of them stopped answering.
	assertReadyChecks(t, base+"/readyz", "db.public", "db.admin", "db.platform")
}

// Every namespace is answered under /rpc on the one listener, the console ones
// to whoever reaches it: an anonymous caller is refused by the procedure's own
// authentication with a Connect error, not by a missing route. The same
// procedures at the root, or under /api, the prefix before /rpc, are not a
// further path to them.
func TestServerAnswersEveryNamespaceUnderItsPrefixAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	base := startServer(t, pg, nil)

	for _, tc := range []struct {
		procedure, body, want string
	}{
		// Refused by the consoles' authentication before any handler runs. The
		// tenant console's names a tenant that exists, because the tenant is
		// looked up before the caller is.
		{"/publira.admin.v1.AdminSeriesService/ListSeries", `{"tenant":{"tenantId":"` + tenant.ID.String() + `"}}`, "unauthenticated"},
		{"/publira.platform.v1.PlatformTenantService/ListTenants", `{}`, "unauthenticated"},
		// Served without a session, and refused for credentials that match no
		// operator.
		{"/publira.platform.v1.PlatformAuthService/Login", `{}`, "unauthenticated"},
		// Served without a session too, and refused without the web service
		// token, which the Platform Console's setup screen sends.
		{"/publira.platform.v1.PlatformSetupService/CreateInitialUser", `{}`, "unauthenticated"},
	} {
		if got := connectErrorCode(t, base+"/rpc"+tc.procedure, tc.body); got != tc.want {
			t.Fatalf("POST /rpc%s code = %q, want %q", tc.procedure, got, tc.want)
		}
		assertRouteRegistered(t, base, tc.procedure, false)
		assertRouteRegistered(t, base, "/api"+tc.procedure, false)
	}
	assertRouteRegistered(t, base, "/images/creators/media", true)
}

// A server given some roles serves those alone: their namespaces under /rpc,
// the images of their sites, and readiness for their pools. The URLs of the
// logins it is not given name a port nothing listens on, so a process that
// opened one anyway would refuse to start, and the web service token and a
// sign-in provider's keys are read only where a role reads them.
func TestServerServesTheStorefrontRoleAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant, preview := seedPreviewPage(t, pg)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":     pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":      unreachableDBURL("publira_admin"),
		"PUBLIRA_PLATFORM_DB_URL":   unreachableDBURL("publira_platform"),
		"PUBLIRA_WEB_SERVICE_TOKEN": "",
		"PUBLIRA_PUBLIC_API_ADDR":   anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--role", "storefront")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.public")

	assertRouteRegistered(t, base, "/rpc/publira.v1.CatalogService/ListPublishedSeries", true)
	assertRouteRegistered(t, base, "/rpc/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, base, "/rpc/publira.platform.v1.PlatformTenantService/ListTenants", false)

	catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, base+"/rpc")))
	if _, err := catalog.SearchPublishedSeries(t.Context(), &publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		Query:  "Harbor",
	}); err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	// No object store is saved, so an image the server answers is a 503, and
	// one it refuses to answer is a 404.
	assertImageStatus(t, base+preview, tenant.Domain, http.StatusServiceUnavailable)
	assertImageStatus(t, base+preview, "admin-"+tenant.Domain, http.StatusNotFound)

	if out := p.Output(); strings.Contains(out, "web service token") {
		t.Fatalf("output reports the web service token, which the storefront role does not read:\n%s", out)
	}
	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

func TestServerServesTheConsoleRoles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant, preview := seedPreviewPage(t, pg)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":   unreachableDBURL("publira_public"),
		"PUBLIRA_ADMIN_DB_URL":    pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL": pg.PlatformURL,
		// The public API alone verifies a sign-in provider's ID tokens, so a
		// value it would refuse is not read here.
		"PUBLIRA_SIGN_IN_APPLE_KEYS_URL": "not a url",
		"PUBLIRA_PUBLIC_API_ADDR":        anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--role", "admin,platform")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.admin", "db.platform")

	assertRouteRegistered(t, base, "/rpc/publira.v1.CatalogService/ListPublishedSeries", false)
	assertRouteRegistered(t, base, "/rpc/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteRegistered(t, base, "/rpc/publira.platform.v1.PlatformTenantService/ListTenants", true)

	assertImageStatus(t, base+preview, "admin-"+tenant.Domain, http.StatusServiceUnavailable)
	assertImageStatus(t, base+preview, tenant.Domain, http.StatusNotFound)

	if out := p.Output(); !strings.Contains(out, "web service token is enabled") {
		t.Fatalf("output does not report the web service token:\n%s", out)
	}
	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

func TestServerServesThePlatformRoleAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":   unreachableDBURL("publira_public"),
		"PUBLIRA_ADMIN_DB_URL":    unreachableDBURL("publira_admin"),
		"PUBLIRA_PLATFORM_DB_URL": pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--role", "platform")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.platform")

	assertRouteRegistered(t, base, "/rpc/publira.v1.CatalogService/ListPublishedSeries", false)
	assertRouteRegistered(t, base, "/rpc/publira.admin.v1.AdminSeriesService/ListSeries", false)
	assertRouteRegistered(t, base, "/rpc/publira.platform.v1.PlatformTenantService/ListTenants", true)
	// Neither site is the platform role's, so image delivery, and with it
	// PUBLIRA_IMAGE_CACHE_TTL, is not there at all.
	assertRouteRegistered(t, base, "/images/creators/media", false)

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// unreachableDBURL names a port nothing listens on, so opening it fails at
// once.
func unreachableDBURL(login string) string {
	return "postgres://" + login + ":password@127.0.0.1:1/publira?sslmode=disable"
}

// connectErrorCode answers the code of the Connect error a request to url
// carrying body is refused with, which only a registered procedure answers
// with.
func connectErrorCode(t *testing.T, url, body string) string {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close() //nolint:errcheck

	var answer struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&answer); err != nil || resp.StatusCode == http.StatusNotFound {
		t.Fatalf("POST %s status = %d, want a Connect error (decode error: %v)", url, resp.StatusCode, err)
	}
	return answer.Code
}

// The web apps' credential reaches the tenant console's tenant-level reads and
// the Platform Console's platform-level reads, never
// their writes, and nothing at all once the variable is unset.
func TestServerAdmitsTheWebServiceTokenOnlyWhenItIsSet(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Fantasy", Slug: "fantasy"})
	token := testutil.DeploymentSecrets()["PUBLIRA_WEB_SERVICE_TOKEN"]
	tenantCtx := &publirattypesv1.TenantContext{TenantId: tenant.ID.String()}

	t.Run("set", func(t *testing.T) {
		url := startServer(t, pg, nil) + "/rpc"
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
		url := startServer(t, pg, map[string]string{"PUBLIRA_WEB_SERVICE_TOKEN": ""}) + "/rpc"
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

// startServer starts `publira server` on pg with the deployment secrets,
// overridden by env, and answers the base URL of its listener.
func startServer(t *testing.T, pg *testutil.PostgresEnv, env map[string]string) string {
	t.Helper()

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":   pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":    pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL": pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR": anyLoopbackPort,
	}, revalidationWithoutPlatformConsole(), env), "server")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	return base
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

// A Stripe API origin the provider could not call is refused before a pool is
// opened, rather than at the first checkout.
func TestServerRefusesAStripeAPIURLThatIsNotOne(t *testing.T) {
	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_STRIPE_API_URL": "127.0.0.1:8500",
	}, revalidationWithoutPlatformConsole()), "server")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, "PUBLIRA_STRIPE_API_URL") {
		t.Fatalf("output does not name PUBLIRA_STRIPE_API_URL:\n%s", output)
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

// Two replicas that split the queues between them, one hosting the Outbox
// drain alone and one the other three queues, process every kind of work one
// replica hosting every queue does, each on its own queues alone. River's
// elected leader enqueues every periodic job whatever it hosts itself, so
// which replica starts first decides which of them enqueues the other's jobs,
// and both orders are run.
//
// The drain replica is given the other logins' URLs on a port nothing listens
// on and a maintenance tunable it would refuse, so opening either pool, or
// reading what only the maintenance jobs read, would stop it from starting.
func TestWorkerReplicasSplitTheQueues(t *testing.T) {
	for _, tc := range []struct {
		name       string
		drainFirst bool
	}{
		{"the drain replica leads", true},
		{"the jobs replica leads", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pg := testutil.StartPostgres(t)
			pg.Reset(t)

			startDrain := func() *testutil.Process {
				p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
					"PUBLIRA_WORKER_DB_URL":           pg.OutboxURL,
					"PUBLIRA_TICKER_DB_URL":           unreachableDBURL("publira_ticker"),
					"PUBLIRA_CONTENT_STATS_DB_URL":    unreachableDBURL("publira_content_stats"),
					"PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE": "not-a-number",
					"PUBLIRA_WORKER_ADDR":             anyLoopbackPort,
				}, revalidationWithoutPlatformConsole()), "worker", "--queue", "outbox")
				base := listenerURL(t, p, "worker")
				p.WaitReady(t, base+"/readyz")
				assertReadyChecks(t, base+"/readyz", "db.outbox")
				return p
			}
			startJobs := func() *testutil.Process {
				p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
					"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
					"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
					"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
					"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
				}, revalidationWithoutPlatformConsole()), "worker", "--queue", "ticker,maintenance,search_index")
				base := listenerURL(t, p, "worker")
				p.WaitReady(t, base+"/readyz")
				assertReadyChecks(t, base+"/readyz", "db.outbox", "db.ticker", "db.content_stats")
				return p
			}

			// The replica started first is the only one running when River
			// elects a leader, and it has enqueued and worked a job of its own
			// before the second starts.
			var drain, jobs *testutil.Process
			if tc.drainFirst {
				drain = startDrain()
				waitForFinishedKinds(t, pg.DB, "outbox.drain")
				jobs = startJobs()
			} else {
				jobs = startJobs()
				waitForFinishedKinds(t, pg.DB, "ticker.publish_episodes")
				drain = startDrain()
			}

			event, err := dbmodels.New(pg.DB).InsertOutboxEvent(t.Context(), dbmodels.InsertOutboxEventParams{
				ID:             uuid.Must(uuid.NewV7()),
				EventType:      outbox.EventTypeTest,
				Payload:        json.RawMessage(`{}`),
				IdempotencyKey: "test:" + t.Name(),
				AvailableAt:    time.Now().UTC().Add(-time.Second),
			})
			if err != nil {
				t.Fatalf("insert an outbox event: %v", err)
			}
			waitForFinishedKinds(t, pg.DB,
				"outbox.drain",
				"outbox.process",
				"ticker.publish_episodes",
				"ticker.apply_free_windows",
				"ticker.roll_tenant_day",
				"ticker.expire_pinned_announcements",
				"ticker.apply_series_publications",
				"ticker.apply_campaign_banners",
				"ticker.apply_campaign_prices",
				"maintenance.project_episode_reads",
				"maintenance.aggregate_content_stats",
				"maintenance.aggregate_rankings",
				"maintenance.build_recommend_features",
				"maintenance.purge_content_events",
				"maintenance.purge_ranking_snapshots",
				"maintenance.purge_mfa_challenges",
				"maintenance.purge_withdrawn_comments",
				"maintenance.purge_orphan_images",
				"maintenance.close_royalty_statements",
				"maintenance.sync_google_play_voided_purchases",
				"maintenance.build_search_index",
			)
			got, err := dbmodels.New(pg.DB).GetOutboxEvent(t.Context(), event.ID)
			if err != nil {
				t.Fatalf("read the outbox event: %v", err)
			}
			if got.Status != outbox.StatusDone {
				t.Fatalf("outbox event status = %q, want %q", got.Status, outbox.StatusDone)
			}

			// Each replica worked the queues it hosts and no other: the jobs on
			// River's default queue were attempted by one client, and every
			// other job by one other.
			drainClients := riverClientsWorking(t, pg.DB, "queue = 'default'")
			jobsClients := riverClientsWorking(t, pg.DB, "queue <> 'default'")
			if len(drainClients) != 1 || len(jobsClients) != 1 || drainClients[0] == jobsClients[0] {
				t.Fatalf("default queue attempted by %v and the other queues by %v, want one client each and not the same one", drainClients, jobsClients)
			}

			if out := drain.Output(); !strings.Contains(out, `not_hosted="[ticker maintenance search_index]"`) {
				t.Fatalf("the drain replica does not name the queues it leaves to others:\n%s", out)
			}
			if out := jobs.Output(); !strings.Contains(out, `not_hosted=[outbox]`) {
				t.Fatalf("the jobs replica does not name the queue it leaves to others:\n%s", out)
			}
			for _, p := range []*testutil.Process{drain, jobs} {
				if code := p.Stop(t); code != 0 {
					t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
				}
			}
		})
	}
}

// A replica that hosts the drain alone may be the leader, and River's leader
// rescues every job a dead client left running, retrying one only for a kind
// its own registry knows. A pass a jobs replica was killed in the middle of is
// therefore retried, not discarded, while the drain replica leads.
func TestWorkerReplicaRescuesTheJobsOfQueuesItLeavesToOthers(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// River's tables are made the way the worker makes them, so the jobs
	// below are waiting for the rescuer's first pass on startup.
	outboxDB, err := sqldb.Open(pg.OutboxURL)
	if err != nil {
		t.Fatalf("open the outbox pool: %v", err)
	}
	defer outboxDB.Close() //nolint:errcheck
	if err := outbox.Migrate(t.Context(), outboxDB); err != nil {
		t.Fatalf("migrate River: %v", err)
	}

	// Running for longer than River waits before calling a job stuck, on a
	// client that is gone, with attempts left.
	kinds := []string{"ticker.publish_episodes", "maintenance.purge_mfa_challenges"}
	for _, kind := range kinds {
		queue, _, _ := strings.Cut(kind, ".")
		if _, err := pg.DB.ExecContext(t.Context(), `
			INSERT INTO river_job (args, attempt, attempted_at, attempted_by, kind, max_attempts, queue, state)
			VALUES ('{}', 1, now() - interval '3 hours', ARRAY['a-replica-that-died'], $1, 3, $2, 'running')`,
			kind, queue); err != nil {
			t.Fatalf("insert a stuck %s job: %v", kind, err)
		}
	}

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        unreachableDBURL("publira_ticker"),
		"PUBLIRA_CONTENT_STATS_DB_URL": unreachableDBURL("publira_content_stats"),
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "worker", "--queue", "outbox")
	p.WaitReady(t, listenerURL(t, p, "worker")+"/readyz")

	deadline := time.Now().Add(60 * time.Second)
	for {
		states := map[string]string{}
		rows, err := pg.DB.QueryContext(t.Context(),
			"SELECT kind, state FROM river_job WHERE 'a-replica-that-died' = ANY(attempted_by)")
		if err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		for rows.Next() {
			var kind, state string
			if err := rows.Scan(&kind, &state); err != nil {
				t.Fatalf("read river_job: %v", err)
			}
			states[kind] = state
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		rescued := 0
		for _, kind := range kinds {
			switch states[kind] {
			case "running":
			case "retryable", "available":
				rescued++
			default:
				t.Fatalf("stuck %s job is %q, want it scheduled for a retry; output:\n%s", kind, states[kind], p.Output())
			}
		}
		if rescued == len(kinds) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("stuck jobs still running after 60s: %v", states)
		}
		time.Sleep(200 * time.Millisecond)
	}

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// waitForFinishedKinds waits until a run of each kind has finished in
// river_job. A cancelled run counts: the orphan image sweep cancels itself on a
// platform with no object store saved.
func waitForFinishedKinds(t *testing.T, db *sql.DB, kinds ...string) {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		rows, err := db.QueryContext(t.Context(),
			"SELECT DISTINCT kind FROM river_job WHERE kind = ANY($1) AND state IN ('completed', 'cancelled')", kinds)
		if err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		finished := map[string]bool{}
		for rows.Next() {
			var kind string
			if err := rows.Scan(&kind); err != nil {
				t.Fatalf("read river_job: %v", err)
			}
			finished[kind] = true
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		var missing []string
		for _, kind := range kinds {
			if !finished[kind] {
				missing = append(missing, kind)
			}
		}
		if len(missing) == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for a finished run of %v", missing)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// riverClientsWorking answers the River clients that attempted a job matching
// where.
func riverClientsWorking(t *testing.T, db *sql.DB, where string) []string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(),
		"SELECT DISTINCT client FROM river_job, unnest(attempted_by) AS client WHERE "+where+" ORDER BY client")
	if err != nil {
		t.Fatalf("read river_job: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var clients []string
	for rows.Next() {
		var client string
		if err := rows.Scan(&client); err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		clients = append(clients, client)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read river_job: %v", err)
	}
	return clients
}

// A server that hosts the worker brings up both listeners, each with the
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
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker")
	server := listenerURL(t, p, "server")
	worker := listenerURL(t, p, "worker")
	for _, url := range []string{server, worker} {
		p.WaitReady(t, url+"/readyz")
		assertLive(t, url+"/livez")
	}

	assertReadyChecks(t, server+"/readyz", "db.public", "db.admin", "db.platform")
	assertReadyChecks(t, worker+"/readyz", "db.outbox", "db.ticker", "db.content_stats")

	if code := p.Stop(t); code != 0 {
		t.Fatalf("exit code after SIGTERM = %d, want 0; output:\n%s", code, p.Output())
	}
}

// The worker a server hosts takes --queue as a worker process does: it opens
// the pools of the queues it is given alone, and readiness names those.
func TestServerWithWorkerHostsTheQueuesItIsGiven(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      anyLoopbackPort,
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        unreachableDBURL("publira_ticker"),
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--with-worker", "--queue", "outbox,maintenance,search_index")
	server := listenerURL(t, p, "server")
	worker := listenerURL(t, p, "worker")
	for _, url := range []string{server, worker} {
		p.WaitReady(t, url+"/readyz")
	}

	assertReadyChecks(t, server+"/readyz", "db.public", "db.admin", "db.platform")
	assertReadyChecks(t, worker+"/readyz", "db.outbox", "db.content_stats")

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
