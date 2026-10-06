package platformsearch_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

const testSurface = "web"

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

// sqlMarker stands in for the SQL backend: whatever it answers names it, so a
// test can tell which engine a search reached.
type sqlMarker struct{ id uuid.UUID }

func (m sqlMarker) page() catalogsearch.Page { return catalogsearch.Page{IDs: []uuid.UUID{m.id}} }

func (m sqlMarker) SearchSeries(context.Context, catalogsearch.SeriesRequest) (catalogsearch.Page, error) {
	return m.page(), nil
}

func (m sqlMarker) SearchCreators(context.Context, catalogsearch.Request) (catalogsearch.Page, error) {
	return m.page(), nil
}

func (m sqlMarker) SearchLabels(context.Context, catalogsearch.Request) (catalogsearch.Page, error) {
	return m.page(), nil
}

type env struct {
	pg       *testutil.PostgresEnv
	search   *testutil.OpenSearchEnv
	platform *dbmodels.Queries
	secrets  *secretcrypto.Manager
	marker   sqlMarker
	searcher platformsearch.Searcher
	tenantID uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	search := testutil.StartOpenSearch(t)
	secrets := testEncryptor(t)
	platform := pg.OpenPlatformDB(t)
	marker := sqlMarker{id: uuid.New()}
	tenant := pg.SeedTenant(t, "SEARCHSET001", "search-settings.example.com", "Search Settings Tenant")
	return &env{
		pg:       pg,
		search:   search,
		platform: dbmodels.New(platform),
		secrets:  secrets,
		marker:   marker,
		searcher: platformsearch.Searcher{
			Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{
				Queries:  dbmodels.New(platform),
				Secrets:  secrets,
				Interval: -1,
			}),
			SQL: marker,
		},
		tenantID: tenant.ID,
	}
}

// alias is an alias of the test's own on the shared node, whose indices are
// deleted once the test is done.
func (e *env) alias(t *testing.T) string {
	t.Helper()
	alias := "catalog-settings-test-" + uuid.NewString()
	client := e.client(t)
	t.Cleanup(func() {
		resp, err := client.Indices.Get(context.Background(), &opensearchapi.IndicesGetReq{Indices: []string{alias + "*"}})
		if err != nil || resp.Entries == nil {
			return
		}
		if indices := slices.Collect(maps.Keys(resp.Entries)); len(indices) > 0 {
			_, _ = client.Indices.Delete(context.Background(), &opensearchapi.IndicesDeleteReq{Indices: indices})
		}
	})
	return alias
}

func (e *env) client(t *testing.T) *opensearchapi.Client {
	t.Helper()
	client, err := opensearchapi.NewClient(opensearchapi.Config{Client: opensearch.Config{Addresses: []string{e.search.URL}, DiscoverNodesOnStart: new(false)}})
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	return client
}

func (e *env) save(t *testing.T, settings platformsearch.Settings) dbmodels.PlatformSearchConfig {
	t.Helper()
	saved, err := platformsearch.Save(context.Background(), e.pg.OpenPlatformDB(t), slog.Default(), e.secrets, auditlog.SystemPlatformActor, platformsearch.SaveParams{Settings: settings})
	if err != nil {
		t.Fatalf("Save(%+v): %v", settings, err)
	}
	return saved
}

func (e *env) build(t *testing.T) (platformsearch.BuildResult, error) {
	t.Helper()
	return platformsearch.Build(context.Background(), platformsearch.BuildParams{DB: e.pg.OpenContentStatsDB(t), Secrets: e.secrets})
}

func (e *env) searchSeries(t *testing.T, query string) []uuid.UUID {
	t.Helper()
	page, err := e.searcher.SearchSeries(context.Background(), catalogsearch.SeriesRequest{Request: catalogsearch.Request{
		TenantID: e.tenantID, Surface: testSurface, Query: query, Limit: 10,
	}})
	if err != nil {
		t.Fatalf("SearchSeries(%q): %v", query, err)
	}
	return page.IDs
}

func (e *env) stored(t *testing.T) platformsearch.Stored {
	t.Helper()
	row, found, err := platformsearch.Get(context.Background(), e.platform)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found {
		return platformsearch.Unsaved()
	}
	return platformsearch.FromConfig(row)
}

func openSearch(url, alias string) platformsearch.Settings {
	return platformsearch.Settings{Engine: platformsearch.EngineOpenSearch, URL: url, Index: alias}
}

// A switch to OpenSearch does not leave the storefront answering from an empty
// index: the search stays on SQL while the index is built from the database,
// moves onto it once the build completes, and moves back to SQL as soon as SQL
// is saved again.
func TestTheSearchMovesOntoAnEngineOnceItsIndexIsBuilt(t *testing.T) {
	e := newEnv(t)
	series := e.pg.SeedSeries(t, e.tenantID, testutil.SeriesSeed{PublicID: "SEARCHSET002", Title: "Seed Garden", Published: true})
	alias := e.alias(t)

	if got := e.searchSeries(t, "Seed"); !slices.Equal(got, []uuid.UUID{e.marker.id}) {
		t.Fatalf("search before any save = %v, want the SQL engine's answer", got)
	}

	saved := e.save(t, openSearch(e.search.URL, alias))
	if stored := platformsearch.FromConfig(saved); stored.State != platformsearch.Building || stored.Serving.Engine != platformsearch.EngineSQL {
		t.Fatalf("saved = %+v, want a build due and the search still on sql", stored)
	}
	if got := e.searchSeries(t, "Seed"); !slices.Equal(got, []uuid.UUID{e.marker.id}) {
		t.Fatalf("search while the build is due = %v, want the SQL engine's answer", got)
	}

	result, err := e.build(t)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !result.Built || !result.Serving || result.Alias != alias {
		t.Fatalf("Build = %+v, want the index built behind %s and served", result, alias)
	}
	if stored := e.stored(t); stored.State != platformsearch.Serving || stored.Serving.Engine != platformsearch.EngineOpenSearch || stored.Serving.Revision != saved.Revision {
		t.Fatalf("stored = %+v, want the search on the saved revision", stored)
	}
	if got := e.searchSeries(t, "Seed"); !slices.Equal(got, []uuid.UUID{series.ID}) {
		t.Fatalf("search after the build = %v, want %v from OpenSearch", got, series.ID)
	}

	// A pass with nothing to build does nothing.
	if result, err := e.build(t); err != nil || result.Built {
		t.Fatalf("Build with nothing due = (%+v, %v), want nothing built", result, err)
	}

	back := e.save(t, platformsearch.Settings{Engine: platformsearch.EngineSQL})
	if stored := platformsearch.FromConfig(back); stored.State != platformsearch.Serving || stored.Serving.Engine != platformsearch.EngineSQL {
		t.Fatalf("saved = %+v, want the search back on sql at once", stored)
	}
	if got := e.searchSeries(t, "Seed"); !slices.Equal(got, []uuid.UUID{e.marker.id}) {
		t.Fatalf("search after saving sql = %v, want the SQL engine's answer", got)
	}
}

// A build that fails leaves the search where it was and says why, and the
// worker stops writing to an engine that refused the index, so the events keep
// draining.
func TestAFailedBuildLeavesTheSearchWhereItWas(t *testing.T) {
	e := newEnv(t)
	unreachable := "http://" + testutil.FreeAddr(t)
	e.save(t, openSearch(unreachable, "publira-catalog"))

	if _, err := e.build(t); err == nil {
		t.Fatal("Build against an engine that does not answer succeeded")
	}
	stored := e.stored(t)
	if stored.State != platformsearch.BuildFailed || stored.Failure == nil || stored.Failure.Error == "" {
		t.Fatalf("stored = %+v, want the failure recorded", stored)
	}
	if stored.Serving.Engine != platformsearch.EngineSQL {
		t.Fatalf("serving = %+v, want the search still on sql", stored.Serving)
	}
	if got := e.searchSeries(t, "Seed"); !slices.Equal(got, []uuid.UUID{e.marker.id}) {
		t.Fatalf("search after a failed build = %v, want the SQL engine's answer", got)
	}

	indexer := platformsearch.Indexer{
		DB:       e.pg.OpenOutboxDB(t),
		Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{Queries: dbmodels.New(e.pg.OpenOutboxDB(t)), Interval: -1}),
	}
	if err := indexer.Sync(context.Background(), e.tenantID, string(opensearchbackend.KindSeries), uuid.New()); err != nil {
		t.Fatalf("Sync after a failed build: %v, want the event done", err)
	}

	// Saving again clears the failure, since nothing is building that
	// revision any more.
	if stored := platformsearch.FromConfig(e.save(t, openSearch(unreachable, "publira-other"))); stored.State != platformsearch.Building || stored.Failure != nil {
		t.Fatalf("saved = %+v, want a build due and no failure", stored)
	}
}

// While a build is due the worker writes every catalog change into the index
// the search answers from and into the one being built, so neither misses a
// write that commits while the other is in use.
func TestTheIndexerWritesIntoBothEnginesWhileABuildIsDue(t *testing.T) {
	e := newEnv(t)
	first, second := e.alias(t), e.alias(t)
	e.save(t, openSearch(e.search.URL, first))
	if _, err := e.build(t); err != nil {
		t.Fatalf("Build: %v", err)
	}
	e.save(t, openSearch(e.search.URL, second))

	series := e.pg.SeedSeries(t, e.tenantID, testutil.SeriesSeed{PublicID: "SEARCHSET003", Title: "Seed Garden", Published: true})
	outbox := e.pg.OpenOutboxDB(t)
	indexer := platformsearch.Indexer{
		DB:       outbox,
		Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{Queries: dbmodels.New(outbox), Secrets: e.secrets, Interval: -1}),
	}
	if err := indexer.Sync(context.Background(), e.tenantID, string(opensearchbackend.KindSeries), series.ID); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	client := e.client(t)
	for _, alias := range []string{first, second} {
		if _, err := client.Indices.Refresh(context.Background(), &opensearchapi.IndicesRefreshReq{Indices: []string{alias}}); err != nil {
			t.Fatalf("refresh %s: %v", alias, err)
		}
		backend, err := opensearchbackend.New(context.Background(), opensearchbackend.Config{URL: e.search.URL, Index: alias})
		if err != nil {
			t.Fatalf("New(%s): %v", alias, err)
		}
		page, err := backend.SearchSeries(context.Background(), catalogsearch.SeriesRequest{Request: catalogsearch.Request{
			TenantID: e.tenantID, Surface: testSurface, Query: "Seed", Limit: 10,
		}})
		if err != nil {
			t.Fatalf("search %s: %v", alias, err)
		}
		if !slices.Equal(page.IDs, []uuid.UUID{series.ID}) {
			t.Fatalf("search %s = %v, want %v", alias, page.IDs, series.ID)
		}
	}
}

// The password is stored encrypted and kept, replaced, or cleared the way the
// mode says, and a credential that only changes how the engine the search
// already answers from is reached takes effect at once: it shares that index.
func TestSaveKeepsReplacesAndClearsThePassword(t *testing.T) {
	e := newEnv(t)
	db := e.pg.OpenPlatformDB(t)
	ctx := context.Background()
	save := func(p platformsearch.SaveParams) (dbmodels.PlatformSearchConfig, error) {
		return platformsearch.Save(ctx, db, slog.Default(), e.secrets, auditlog.SystemPlatformActor, p)
	}
	withUser := platformsearch.Settings{Engine: platformsearch.EngineOpenSearch, URL: "https://search.example.com", Index: "publira-catalog", Username: "publira"}

	if _, err := save(platformsearch.SaveParams{Settings: withUser, SecretMode: secretupdate.Unchanged}); fielderr.Field(err) != platformsearch.FieldPassword {
		t.Fatalf("save with a username and no password = %v, want the password refused", err)
	}
	zero := int64(0)
	saved, err := save(platformsearch.SaveParams{Settings: withUser, SecretMode: secretupdate.Replace, Password: "first-password", ExpectedRevision: &zero})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.PasswordEncrypted.String == "first-password" {
		t.Fatal("the password was stored in the clear")
	}
	if plain, err := e.secrets.DecryptString(saved.PasswordEncrypted.String); err != nil || plain != "first-password" {
		t.Fatalf("stored password decrypts to (%q, %v)", plain, err)
	}

	if _, err := save(platformsearch.SaveParams{Settings: withUser, SecretMode: secretupdate.Replace, Password: "x", ExpectedRevision: &zero}); !errors.Is(err, platformsearch.ErrConflict) {
		t.Fatalf("save at a stale revision = %v, want ErrConflict", err)
	}

	// The same password sent again writes nothing.
	again, err := save(platformsearch.SaveParams{Settings: withUser, SecretMode: secretupdate.Replace, Password: "first-password"})
	if err != nil || again.Revision != saved.Revision {
		t.Fatalf("save of the same values = (revision %d, %v), want revision %d kept", again.Revision, err, saved.Revision)
	}

	renamed := withUser
	renamed.Username = "someone-else"
	if _, err := save(platformsearch.SaveParams{Settings: renamed, SecretMode: secretupdate.Unchanged}); !errors.Is(err, platformsearch.ErrUsernameChanged) {
		t.Fatalf("keeping the password under another username = %v, want ErrUsernameChanged", err)
	}

	// Make the saved engine the one the search answers from, as a build would.
	if _, err := dbmodels.New(e.pg.OpenContentStatsDB(t)).ServePlatformSearchConfig(ctx, saved.Revision); err != nil {
		t.Fatalf("serve: %v", err)
	}
	rotated, err := save(platformsearch.SaveParams{Settings: withUser, SecretMode: secretupdate.Replace, Password: "second-password"})
	if err != nil {
		t.Fatalf("rotate the password: %v", err)
	}
	if rotated.ServingRevision != rotated.Revision || rotated.ServingPasswordEncrypted != rotated.PasswordEncrypted {
		t.Fatalf("rotated = serving revision %d of %d, want the new password served at once", rotated.ServingRevision, rotated.Revision)
	}

	anonymous := withUser
	anonymous.Username = ""
	cleared, err := save(platformsearch.SaveParams{Settings: anonymous})
	if err != nil {
		t.Fatalf("save without credentials: %v", err)
	}
	if cleared.Username.Valid || cleared.PasswordEncrypted.Valid {
		t.Fatalf("saved = %+v, want the credential cleared", cleared)
	}
}

// The Platform Console and publiractl search test ask the same question: what
// the engine is and whether it has the plugins the index is built from.
func TestTheConnectionTestReportsTheEngineAndItsPlugins(t *testing.T) {
	e := newEnv(t)
	recorder := auditlog.New(e.platform, slog.Default())
	tester := platformsearch.Tester{Secrets: e.secrets, Recorder: recorder}
	ctx := context.Background()

	result, err := tester.Test(ctx, e.platform, auditlog.SystemPlatformActor, platformsearch.TestParams{
		Settings: platformsearch.Settings{Engine: platformsearch.EngineOpenSearch, URL: e.search.URL},
	})
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if !result.Succeeded() || result.Product != opensearchbackend.ProductOpenSearch || result.Version == "" || !result.KuromojiPresent || !result.ICUPresent {
		t.Fatalf("Test = %+v, want OpenSearch with both plugins", result)
	}

	result, err = tester.Test(ctx, e.platform, auditlog.SystemPlatformActor, platformsearch.TestParams{
		Settings: platformsearch.Settings{Engine: platformsearch.EngineOpenSearch, URL: "http://" + testutil.FreeAddr(t)},
	})
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if result.Reason != platformsearch.ReasonUnreachable {
		t.Fatalf("Test of a closed port = %+v, want %s", result, platformsearch.ReasonUnreachable)
	}

	if _, err := tester.Test(ctx, e.platform, auditlog.SystemPlatformActor, platformsearch.TestParams{
		Settings: platformsearch.Settings{Engine: platformsearch.EngineSQL},
	}); fielderr.Field(err) != platformsearch.FieldEngine {
		t.Fatalf("Test of sql = %v, want the engine refused", err)
	}

	var outcomes []string
	rows, err := e.pg.DB.QueryContext(ctx, "SELECT outcome FROM platform_audit_logs WHERE action = 'platform_search_connection_tested' ORDER BY created_at")
	if err != nil {
		t.Fatalf("list audit entries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var outcome string
		if err := rows.Scan(&outcome); err != nil {
			t.Fatalf("scan: %v", err)
		}
		outcomes = append(outcomes, outcome)
	}
	if !slices.Equal(outcomes, []string{"success", "failure"}) {
		t.Fatalf("audit outcomes = %v, want one entry per test that ran", outcomes)
	}
}
