package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/imageserver"
)

func TestRunWithoutCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run(nil, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: publira <command>") {
		t.Fatalf("stderr = %q, want the usage text", stderr.String())
	}
}

func TestRunUnknownCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"api-server"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown command "api-server"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: publira <command>") {
		t.Fatalf("stderr = %q, want the usage text", out)
	}
}

// Everything a process reads is in the environment, and the flags there are
// choose what server hosts, so any other argument is a mistake rather than a
// setting. None of these invocations starts anything.
func TestRunRejectsArgumentsTheCommandDoesNotTake(t *testing.T) {
	for _, tc := range []struct {
		args   []string
		reason string
	}{
		{[]string{"server", "--port", "8000"}, "flag provided but not defined: -port"},
		{[]string{"server", "extra"}, "server takes no arguments other than --role, --with-worker, and --queue"},
		{[]string{"server", "--with-worker", "extra"}, "server takes no arguments other than --role, --with-worker, and --queue"},
		{[]string{"server", "--listener", "edge"}, "flag provided but not defined: -listener"},
		{[]string{"server", "--role", "worker"}, `--role must be storefront, admin, or platform, not "worker"`},
		{[]string{"server", "--role", "edge"}, `--role must be storefront, admin, or platform, not "edge"`},
		{[]string{"server", "--role", ""}, "--role names an empty role"},
		{[]string{"server", "--role", "storefront,"}, "--role names an empty role"},
		{[]string{"server", "--role", "admin,admin"}, `--role names "admin" twice`},
		{[]string{"server", "--role", "admin", "--role", "admin"}, `--role names "admin" twice`},
		{[]string{"server", "--role"}, "flag needs an argument: -role"},
		{[]string{"server", "--queue", "outbox"}, "--queue names the queues of the worker --with-worker hosts"},
		{[]string{"server", "--queue", "outbox,ticker,maintenance,search_index"}, "--queue names the queues of the worker --with-worker hosts"},
		{[]string{"server", "--with-worker=false", "--queue", "outbox"}, "--queue names the queues of the worker --with-worker hosts"},
		{[]string{"server", "--with-worker", "--queue", "storefront"}, `--queue must be outbox, ticker, maintenance, or search_index, not "storefront"`},
		{[]string{"worker", "--role", "storefront"}, "flag provided but not defined: -role"},
		{[]string{"worker", "extra"}, "worker takes no arguments other than --queue"},
		{[]string{"worker", "--queue", "outbox", "extra"}, "worker takes no arguments other than --queue"},
		{[]string{"worker", "--with-worker"}, "flag provided but not defined: -with-worker"},
		{[]string{"worker", "--queue", "default"}, `--queue must be outbox, ticker, maintenance, or search_index, not "default"`},
		{[]string{"worker", "--queue", "searchindex"}, `--queue must be outbox, ticker, maintenance, or search_index, not "searchindex"`},
		{[]string{"worker", "--queue", ""}, "--queue names an empty queue"},
		{[]string{"worker", "--queue", "outbox,"}, "--queue names an empty queue"},
		{[]string{"worker", "--queue", "ticker,ticker"}, `--queue names "ticker" twice`},
		{[]string{"worker", "--queue", "ticker", "--queue", "ticker"}, `--queue names "ticker" twice`},
		{[]string{"worker", "--queue"}, "flag needs an argument: -queue"},
		{[]string{"--with-worker"}, `unknown command "--with-worker"`},
		{[]string{"healthcheck"}, "healthcheck takes the URL of at least one /livez or /readyz"},
		{[]string{"healthcheck", "127.0.0.1:8000/readyz"}, `healthcheck takes absolute http or https URLs, not "127.0.0.1:8000/readyz"`},
		{[]string{"healthcheck", "/readyz"}, `healthcheck takes absolute http or https URLs, not "/readyz"`},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			var stderr strings.Builder
			if code := run(tc.args, &stderr); code != 2 {
				t.Fatalf("exit code = %d, want 2", code)
			}
			out := stderr.String()
			if !strings.Contains(out, tc.reason) {
				t.Fatalf("stderr = %q, want %q", out, tc.reason)
			}
			if !strings.Contains(out, "Usage: publira <command>") {
				t.Fatalf("stderr = %q, want the usage text", out)
			}
		})
	}
}

// Without --role the server serves all three surfaces, and --with-worker adds
// the worker to whichever it serves, hosting every queue unless --queue names
// some.
func TestParseServerFlags(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want hosted
	}{
		{nil, hosted{server: allServerRoles}},
		{[]string{"--with-worker"}, hosted{server: allServerRoles, worker: allWorkerQueues}},
		{[]string{"-with-worker"}, hosted{server: allServerRoles, worker: allWorkerQueues}},
		{[]string{"--with-worker=false"}, hosted{server: allServerRoles}},
		{[]string{"--role", "storefront"}, hosted{server: serverRoles{storefront: true}}},
		{[]string{"--role=admin,platform"}, hosted{server: serverRoles{admin: true, platform: true}}},
		{[]string{"--role", "platform", "--role", "storefront"}, hosted{server: serverRoles{storefront: true, platform: true}}},
		{[]string{"--role", "admin, storefront,platform"}, hosted{server: allServerRoles}},
		{[]string{"--role", "storefront", "--with-worker"}, hosted{server: serverRoles{storefront: true}, worker: allWorkerQueues}},
		{[]string{"--with-worker", "--queue", "outbox"}, hosted{server: allServerRoles, worker: workerQueues{outbox: true}}},
		{[]string{"--queue=ticker,maintenance", "--with-worker"}, hosted{server: allServerRoles, worker: workerQueues{ticker: true, maintenance: true}}},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got, err := parseServerFlags(tc.args)
			if err != nil {
				t.Fatalf("parseServerFlags(%q): %v", tc.args, err)
			}
			if got != tc.want {
				t.Fatalf("parseServerFlags(%q) = %+v, want %+v", tc.args, got, tc.want)
			}
		})
	}
}

// Without --queue the worker hosts all four queues.
func TestParseWorkerFlags(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want workerQueues
	}{
		{nil, allWorkerQueues},
		{[]string{"--queue", "outbox"}, workerQueues{outbox: true}},
		{[]string{"-queue=search_index"}, workerQueues{searchIndex: true}},
		{[]string{"--queue", "ticker,maintenance,search_index"}, workerQueues{ticker: true, maintenance: true, searchIndex: true}},
		{[]string{"--queue", "maintenance", "--queue", "ticker"}, workerQueues{ticker: true, maintenance: true}},
		{[]string{"--queue", "search_index, outbox,ticker,maintenance"}, allWorkerQueues},
	} {
		t.Run(strings.Join(tc.args, " "), func(t *testing.T) {
			got, err := parseWorkerFlags(tc.args)
			if err != nil {
				t.Fatalf("parseWorkerFlags(%q): %v", tc.args, err)
			}
			if got != tc.want {
				t.Fatalf("parseWorkerFlags(%q) = %+v, want %+v", tc.args, got, tc.want)
			}
		})
	}
}

func TestUsageListsEveryCommandAndFlag(t *testing.T) {
	out := usage()
	for _, entry := range []string{"server", "worker", "healthcheck", "--role", "--with-worker", "--queue"} {
		if !strings.Contains(out, "  "+entry+" ") {
			t.Fatalf("usage text is missing %q", entry)
		}
	}
}

// A process reports under the names of what its roles serve, the first of
// them its default.
func TestServerServiceNamesFollowTheRoles(t *testing.T) {
	for _, tc := range []struct {
		name  string
		roles serverRoles
		want  []string
	}{
		{"all", allServerRoles, []string{publicapi.ServiceName, adminapi.ServiceName, platformapi.ServiceName, imageserver.ServiceName}},
		{"storefront", serverRoles{storefront: true}, []string{publicapi.ServiceName, imageserver.ServiceName}},
		{"admin", serverRoles{admin: true}, []string{adminapi.ServiceName, imageserver.ServiceName}},
		{"platform", serverRoles{platform: true}, []string{platformapi.ServiceName}},
		{"admin,platform", serverRoles{admin: true, platform: true}, []string{adminapi.ServiceName, platformapi.ServiceName, imageserver.ServiceName}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := serverServiceNames(tc.roles); !slices.Equal(got, tc.want) {
				t.Fatalf("serverServiceNames(%+v) = %v, want %v", tc.roles, got, tc.want)
			}
		})
	}
}

// One listener serves the namespaces of the roles a process was given under
// /rpc, and the images when a role with a site is among them.
// The edge forwards only publira.v1 and the images to it, so a console
// procedure a process serves is kept off the internet by the edge and from
// whoever reaches the server anyway by its own authentication, while one it
// does not serve is not there at all. Readiness names the pools the roles hold, and no other.
func TestServerHandlerServesWhatItsRolesServe(t *testing.T) {
	const (
		public   = "/publira.v1.CatalogService/ListPublishedSeries"
		admin    = "/publira.admin.v1.AdminSeriesService/ListSeries"
		platform = "/publira.platform.v1.PlatformTenantService/ListTenants"
		images   = "/images/creators/media"
	)
	for _, tc := range []struct {
		name   string
		roles  serverRoles
		routes []string
		checks []string
	}{
		{"all", allServerRoles, []string{public, admin, platform, images}, []string{"db.public", "db.admin", "db.platform"}},
		{"storefront", serverRoles{storefront: true}, []string{public, images}, []string{"db.public"}},
		{"admin", serverRoles{admin: true}, []string{admin, images}, []string{"db.admin"}},
		{"platform", serverRoles{platform: true}, []string{platform}, []string{"db.platform"}},
		{"admin,platform", serverRoles{admin: true, platform: true}, []string{admin, platform, images}, []string{"db.admin", "db.platform"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PUBLIRA_REDIS_URL", "disabled")
			var pools serverPools
			if tc.roles.storefront {
				pools.public = newPingOnlyPool(t)
			}
			if tc.roles.admin {
				pools.admin = newPingOnlyPool(t)
			}
			if tc.roles.platform {
				pools.platform = newPingOnlyPool(t)
			}
			built, err := assembleServer(shared{logger: slog.Default()}, serverConfig{
				clientIPs: clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}),
			}, pools)
			if err != nil {
				t.Fatalf("assembleServer: %v", err)
			}
			ts := httptest.NewServer(built.handler)
			t.Cleanup(func() {
				ts.Close()
				for _, drain := range built.drain {
					_ = drain(context.Background())
				}
				_ = built.close()
			})

			for _, route := range []string{public, admin, platform, images} {
				served := slices.Contains(tc.routes, route)
				if route == images {
					assertRouteRegistered(t, ts.URL, route, served)
					continue
				}
				assertRouteRegistered(t, ts.URL, "/rpc"+route, served)
				// A procedure is reached through /rpc alone: the same
				// procedure at the root, or under /api, the prefix before /rpc,
				// is not a further way in.
				assertRouteRegistered(t, ts.URL, route, false)
				assertRouteRegistered(t, ts.URL, "/api"+route, false)
			}
			assertReadyChecks(t, ts.URL+"/readyz", tc.checks...)
		})
	}
}

// newPingOnlyPool stands in for a role's pool where only what is built on it
// is under test: it answers a ping and nothing else.
func newPingOnlyPool(t *testing.T) *sql.DB {
	t.Helper()
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// assertRouteRegistered asks with POST for a health probe, which the probe
// refuses before anything runs, and with GET for a Connect procedure, which
// every one here refuses the same way; an image route is registered for GET
// alone, so the POST is refused by the mux before the handler runs. Each
// registered route therefore answers something other than 404 without a
// database behind it.
func assertRouteRegistered(t *testing.T, baseURL, path string, wantRegistered bool) {
	t.Helper()
	method := http.MethodGet
	if strings.HasPrefix(path, "/images/") || path == "/readyz" {
		method = http.MethodPost
	}
	req, err := http.NewRequest(method, baseURL+path, nil)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_ = resp.Body.Close()

	gotRegistered := resp.StatusCode != http.StatusNotFound
	if gotRegistered != wantRegistered {
		t.Fatalf("path %s status = %d, registered = %v, want registered = %v", path, resp.StatusCode, gotRegistered, wantRegistered)
	}
}
