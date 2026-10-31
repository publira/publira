package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/readguard"
	"github.com/publira/publira/server/internal/testutil"
)

// readGuardedClients call the public API behind the client address resolution
// the server runs every request through, so the guard counts each address a
// call names in Forwarded, and a call naming none as one from inside the
// install.
type readGuardedClients struct {
	catalog publirav1connect.CatalogServiceClient
	domain  publirav1connect.DomainServiceClient
}

func newReadGuardedClients(t *testing.T) readGuardedClients {
	t.Helper()
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	// Nothing past the guard is under test, so every query a call it lets
	// through makes is unexpected, and fails the call with something other
	// than resource_exhausted.
	server := newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil, nil)
	server.readGuard = readguard.New(testutil.Limiter(), platformpolicy.Fixed(platformpolicy.Defaults()))
	resolver := clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies})
	testServer := httptest.NewServer(resolver.Middleware(handlerFromServer(server)))
	t.Cleanup(testServer.Close)
	client := connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))
	return readGuardedClients{
		catalog: publirav1connect.NewCatalogServiceClient(client),
		domain:  publirav1connect.NewDomainServiceClient(client),
	}
}

// defaultReadLimit is the reads of allowance a platform that saved no policy
// gives one client in a window.
func defaultReadLimit(allowance readguard.Allowance) int {
	return readguard.Limit(platformpolicy.Defaults().AnonymousReads, allowance)
}

// from is the context of a call the edge forwarded from client, or of one a web
// app makes as itself when client is empty.
func from(client string) context.Context {
	if client == "" {
		return context.Background()
	}
	return testutil.WithRequestHeader(context.Background(), "Forwarded", "for="+client)
}

func (c readGuardedClients) search(ctx context.Context) error {
	_, err := c.catalog.SearchPublishedSeries(ctx, &publirav1.SearchPublishedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: uuid.NewString()},
		Query:  "seed",
	})
	return err
}

func (c readGuardedClients) resolveDomain(ctx context.Context) error {
	_, err := c.domain.GetTenantByDomain(ctx, &publirav1.GetTenantByDomainRequest{Domains: []string{"example.com"}})
	return err
}

func refusedForRate(err error) bool {
	return connect.CodeOf(err) == connect.CodeResourceExhausted
}

func TestReadGuardRefusesAClientPastTheSearchAllowance(t *testing.T) {
	clients := newReadGuardedClients(t)
	reader := from("203.0.113.10")

	limit := defaultReadLimit(readguard.Search)
	for i := range limit {
		if err := clients.search(reader); refusedForRate(err) {
			t.Fatalf("search %d of %d refused for its rate, want the whole allowance served", i+1, limit)
		}
	}
	ctx, call := testutil.NewClientContext(reader)
	if err := clients.search(ctx); !refusedForRate(err) {
		t.Fatalf("search past the allowance: code = %v, want resource_exhausted", connect.CodeOf(err))
	}
	if call.ResponseHeader().Get("Retry-After") == "" {
		t.Fatal("the refusal carries no Retry-After, want the wait the other limits give")
	}

	if err := clients.search(from("198.51.100.7")); refusedForRate(err) {
		t.Fatal("another client's search refused, want each client counted on its own")
	}
	if err := clients.resolveDomain(reader); refusedForRate(err) {
		t.Fatal("a call outside the search refused, want the search counted apart from the public API")
	}
}

func TestReadGuardRefusesAClientPastThePublicAPIAllowance(t *testing.T) {
	clients := newReadGuardedClients(t)
	reader := from("203.0.113.10")

	limit := defaultReadLimit(readguard.PublicAPI)
	for i := range limit {
		if err := clients.resolveDomain(reader); refusedForRate(err) {
			t.Fatalf("call %d of %d refused for its rate, want the whole allowance served", i+1, limit)
		}
	}
	if err := clients.resolveDomain(reader); !refusedForRate(err) {
		t.Fatalf("call past the allowance: code = %v, want resource_exhausted", connect.CodeOf(err))
	}
	if err := clients.resolveDomain(from("198.51.100.7")); refusedForRate(err) {
		t.Fatal("another client's call refused, want each client counted on its own")
	}
}

func TestReadGuardLeavesAWebAppCallingAsItselfAlone(t *testing.T) {
	clients := newReadGuardedClients(t)
	app := from("")

	for i := range defaultReadLimit(readguard.Search) * 2 {
		if err := clients.search(app); refusedForRate(err) {
			t.Fatalf("search %d from inside the install refused for its rate, want it never charged", i+1)
		}
	}
}

func TestReadAllowanceSendsTheCatalogSearchesToTheirOwn(t *testing.T) {
	for _, procedure := range []string{
		publirav1connect.CatalogServiceSearchPublishedSeriesProcedure,
		publirav1connect.CatalogServiceSearchPublishedCreatorsProcedure,
		publirav1connect.CatalogServiceSearchPublishedLabelsProcedure,
	} {
		if got := readAllowance(procedure); got != readguard.Search {
			t.Errorf("readAllowance(%q) = %s, want %s", procedure, got, readguard.Search)
		}
	}
	for _, procedure := range []string{
		publirav1connect.CatalogServiceListPublishedSeriesProcedure,
		publirav1connect.DomainServiceGetTenantByDomainProcedure,
		publirav1connect.EpisodeReadServiceMarkEpisodeAsReadProcedure,
	} {
		if got := readAllowance(procedure); got != readguard.PublicAPI {
			t.Errorf("readAllowance(%q) = %s, want %s", procedure, got, readguard.PublicAPI)
		}
	}
}
