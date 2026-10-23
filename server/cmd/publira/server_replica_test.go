package main

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/testutil"
)

// A storefront given a replica opens it as a pool of its own, names it in
// readiness, and answers the catalogue and the storefront's images with it. The
// queries themselves are publicapi's and imageserver's to place; this is the
// wiring between them and the variable.
func TestServerReadsTheStorefrontReplica(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	tenant, preview := seedPreviewPage(t, pg.PostgresEnv)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":         pg.PublicURL,
		"PUBLIRA_PUBLIC_DB_REPLICA_URL": pg.StandbyPublicURL,
		"PUBLIRA_ADMIN_DB_URL":          unreachableDBURL("publira_admin"),
		"PUBLIRA_PLATFORM_DB_URL":       unreachableDBURL("publira_platform"),
		"PUBLIRA_PUBLIC_API_ADDR":       anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--role", "storefront")
	base := listenerURL(t, p, "server")
	p.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.public", "db.public.replica")

	pg.WaitForReplay(t)
	catalog := publirav1connect.NewCatalogServiceClient(connect.NewClient(connecthttp.NewTransport(http.DefaultClient, base+"/rpc")))
	if _, err := catalog.SearchPublishedSeries(t.Context(), &publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		Query:  "Harbor",
	}); err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	assertImageStatus(t, base+preview, tenant.Domain, http.StatusServiceUnavailable)
}

// A replica URL naming another login would answer the storefront's reads with
// that login's reach, so the server refuses to start on one.
func TestServerRefusesAReplicaSignedInAsAnotherLogin(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	admin := strings.Replace(pg.StandbyPublicURL, "publira_public:publicpass", "publira_admin:adminpass", 1)

	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":         pg.PublicURL,
		"PUBLIRA_PUBLIC_DB_REPLICA_URL": admin,
		"PUBLIRA_PUBLIC_API_ADDR":       anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "server", "--role", "storefront")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, publicDBReplicaURLEnv) || !strings.Contains(output, "publira_admin") {
		t.Fatalf("output does not name %s and the login it signs in as:\n%s", publicDBReplicaURLEnv, output)
	}
}

// The replica's pool is bounded by the variables every other pool is, and an
// unset variable opens none.
func TestOpenReplicaPool(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	primary := pg.OpenPublicDB(t)

	t.Run("unset", func(t *testing.T) {
		t.Setenv(publicDBReplicaURLEnv, "")
		replica, err := openReplicaPool(primary, publicDBReplicaURLEnv)
		if err != nil || replica != nil {
			t.Fatalf("openReplicaPool = %v, %v; want no pool", replica, err)
		}
	})

	t.Run("bounded", func(t *testing.T) {
		t.Setenv(publicDBReplicaURLEnv, pg.StandbyPublicURL)
		t.Setenv("PUBLIRA_DB_MAX_OPEN_CONNS", "4")
		t.Setenv("PUBLIRA_DB_MAX_IDLE_CONNS", "2")
		replica, err := openReplicaPool(primary, publicDBReplicaURLEnv)
		if err != nil {
			t.Fatalf("openReplicaPool: %v", err)
		}
		t.Cleanup(func() { _ = replica.Close() })
		if got := replica.Stats().MaxOpenConnections; got != 4 {
			t.Fatalf("MaxOpenConnections = %d, want 4", got)
		}
	})
}

// The storefront's images that read no credential are answered on the replica,
// and the episode body, which reads a reader's grant when it is given one, on
// the primary.
func TestStorefrontImagesReadTheReplica(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	tenant, preview := seedPreviewPage(t, pg.PostgresEnv)
	body := strings.TrimSuffix(preview, "/preview")

	spans := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	primary, err := sqldb.Open(pg.PublicURL)
	if err != nil {
		t.Fatalf("open the primary: %v", err)
	}
	t.Cleanup(func() { _ = primary.Close() })
	replica, err := sqldb.Open(pg.StandbyPublicURL)
	if err != nil {
		t.Fatalf("open the replica: %v", err)
	}
	t.Cleanup(func() { _ = replica.Close() })
	base := serveOnPools(t, serverPools{public: primary, publicReplica: replica})

	// answeredOn names the port of the server each query named query ran on
	// while path was requested.
	answeredOn := func(t *testing.T, path, query string, want int) []int64 {
		t.Helper()
		before := len(spans.Ended())
		assertImageStatus(t, base+path, tenant.Domain, want)
		var ports []int64
		for _, span := range spans.Ended()[before:] {
			var summary string
			var port int64
			for _, kv := range span.Attributes() {
				switch kv.Key {
				case semconv.DBQuerySummaryKey:
					summary = kv.Value.AsString()
				case semconv.ServerPortKey:
					port = kv.Value.AsInt64()
				}
			}
			if summary == query {
				ports = append(ports, port)
			}
		}
		return ports
	}

	standbyPort := urlPort(t, pg.StandbyPublicURL)
	primaryPort := urlPort(t, pg.PublicURL)

	t.Run("a preview is read on the replica", func(t *testing.T) {
		for range 20 {
			pg.WaitForReplay(t)
			ports := answeredOn(t, preview, "GetEpisodePreviewImageByIDForTenant", http.StatusServiceUnavailable)
			if slices.Equal(ports, []int64{standbyPort}) {
				return
			}
		}
		t.Fatal("the preview's row was never read on the replica")
	})

	t.Run("an episode body is read on the primary", func(t *testing.T) {
		pg.WaitForReplay(t)
		// The episode costs nothing, so the page is answered without a
		// credential, as far as the object store nobody has saved.
		ports := answeredOn(t, body, "GetEpisodeImagePublicAccessByIDForTenant", http.StatusServiceUnavailable)
		if !slices.Equal(ports, []int64{primaryPort}) {
			t.Fatalf("the episode body's row was read on ports %v, want the primary's %d", ports, primaryPort)
		}
	})
}

func urlPort(t *testing.T, rawURL string) int64 {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %q: %v", rawURL, err)
	}
	port, err := strconv.ParseInt(u.Port(), 10, 64)
	if err != nil {
		t.Fatalf("port of %q: %v", rawURL, err)
	}
	return port
}
