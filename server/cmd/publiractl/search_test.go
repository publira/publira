package main

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func searchCommand(t *testing.T, stdin string, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := runGroup(&searchGroup, args, pipedConsole(stdin, &stderr), &stdout)
	return code, stdout.String(), stderr.String()
}

func mustSearchCommand(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	code, stdout, stderr := searchCommand(t, stdin, args...)
	if code != 0 {
		t.Fatalf("search %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

// An engine the command does not know is refused before anything is written,
// and the refusal names every engine it does know.
func TestSearchSetRefusesAnUnknownEngine(t *testing.T) {
	code, _, stderr := searchCommand(t, "", "set", "--engine", "solr")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1; stderr:\n%s", code, stderr)
	}
	if !strings.Contains(stderr, "--engine") || !strings.Contains(stderr, "sql, opensearch, elasticsearch") {
		t.Fatalf("stderr = %q, want the flag and every engine named", stderr)
	}
}

// The SQL engine keeps no index, so there is nothing to build and the command
// says so rather than connecting anywhere.
func TestSearchReindexRefusesTheSQLEngine(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", pg.ContentStatsURL)

	code, _, stderr := searchCommand(t, "", "reindex")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1; stderr:\n%s", code, stderr)
	}
	if !strings.Contains(stderr, "runs on sql") {
		t.Fatalf("stderr = %q, want the sql engine named", stderr)
	}
}

func TestSearchSetSavesTheEngineAndReindexMovesTheSearchOntoIt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	search := testutil.StartOpenSearch(t)
	alias := "catalog-publiractl-" + uuid.NewString()
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", pg.ContentStatsURL)
	t.Cleanup(func() {
		req, err := http.NewRequest(http.MethodDelete, search.URL+"/"+alias+"-*", nil)
		if err == nil {
			if resp, err := http.DefaultClient.Do(req); err == nil {
				_ = resp.Body.Close()
			}
		}
	})

	tenant := pg.SeedTenant(t, "SEARCHCTL001", "search-ctl.example.com", "Search Tenant")
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SEARCHCTL002", Title: "Seed Garden", Published: true})
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SEARCHCTL003", Title: "Seed Draft"})

	if got := mustSearchCommand(t, "", "show"); got != "No search engine is saved; the catalog search runs on sql\n" {
		t.Fatalf("show before a save = %q", got)
	}
	saved := mustSearchCommand(t, "", "set", "--engine", "opensearch", "--url", search.URL, "--index", alias)
	if !strings.HasPrefix(saved, "Saved the search engine opensearch, revision 1. The worker builds the index "+alias) {
		t.Fatalf("set = %q, want the build announced", saved)
	}
	show := mustSearchCommand(t, "", "show")
	for _, want := range []string{"Searching on:", "sql (revision 0)", "due; the worker builds the index of revision 1"} {
		if !strings.Contains(show, want) {
			t.Fatalf("show = %q, want it to contain %q", show, want)
		}
	}

	test := mustSearchCommand(t, "", "test")
	for _, want := range []string{"OpenSearch", "analysis-kuromoji", "analysis-icu", "installed"} {
		if !strings.Contains(test, want) {
			t.Fatalf("test = %q, want it to contain %q", test, want)
		}
	}

	stdout := mustSearchCommand(t, "", "reindex")
	if !strings.HasPrefix(stdout, "Rebuilt the catalog index; "+alias+" now names "+alias+"-") || !strings.HasSuffix(stdout, "The search answers from it.\n") {
		t.Fatalf("reindex stdout = %q, want the index the alias names and the search on it", stdout)
	}
	if show := mustSearchCommand(t, "", "show"); !strings.Contains(show, "none due") || !strings.Contains(show, "opensearch at "+search.URL) {
		t.Fatalf("show after the reindex = %q, want the search on opensearch", show)
	}

	stdout = mustSearchCommand(t, "", "reindex", "--tenant", "search-ctl.example.com")
	if want := "Rewrote the catalog documents of tenant SEARCHCTL001: 1 written, 1 deleted.\n"; stdout != want {
		t.Fatalf("reindex --tenant stdout = %q, want %q", stdout, want)
	}

	if got := mustSearchCommand(t, "", "set", "--engine", "sql"); got != "Saved the search engine sql, revision 2. The search answers from it.\n" {
		t.Fatalf("set sql = %q", got)
	}
}

// A password is never taken on the command line, is stored encrypted, and is
// refused without the username it belongs to.
func TestSearchSetStoresThePasswordEncrypted(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	settings := []string{"set", "--engine", "opensearch", "--url", "https://search.example.com"}

	code, _, stderr := searchCommand(t, "secret\n", append(settings, "--password-stdin")...)
	if code != 1 || !strings.Contains(stderr, "--username") {
		t.Fatalf("set with a password and no username: exit code = %d, stderr = %q, want --username refused", code, stderr)
	}

	mustSearchCommand(t, testSecretValue+"\n", append(settings, "--username", "publira", "--password-stdin")...)
	var encrypted string
	if err := pg.DB.QueryRowContext(context.Background(), "SELECT password_encrypted FROM platform_search_config").Scan(&encrypted); err != nil {
		t.Fatalf("read platform_search_config: %v", err)
	}
	if encrypted == "" || strings.Contains(encrypted, testSecretValue) {
		t.Fatalf("password_encrypted = %q, want it sealed", encrypted)
	}
	show := mustSearchCommand(t, "", "show")
	if strings.Contains(show, testSecretValue) || !strings.Contains(show, "Password:") || !strings.Contains(show, "saved") {
		t.Fatalf("show = %q, want the password reported as saved and never printed", show)
	}
}

// Elasticsearch is saved, tested, and rebuilt the way OpenSearch is, and the
// test names the product that answered.
func TestSearchReindexBuildsTheIndexOnElasticsearch(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	search := testutil.StartElasticsearch(t)
	alias := "catalog-publiractl-" + uuid.NewString()
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", pg.ContentStatsURL)
	t.Cleanup(func() {
		req, err := http.NewRequest(http.MethodDelete, search.URL+"/"+alias+"-*", nil)
		if err == nil {
			if resp, err := http.DefaultClient.Do(req); err == nil {
				_ = resp.Body.Close()
			}
		}
	})
	tenant := pg.SeedTenant(t, "SEARCHCTL101", "search-es.example.com", "Search Tenant")
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SEARCHCTL102", Title: "Seed Garden", Published: true})

	mustSearchCommand(t, "", "set", "--engine", "elasticsearch", "--url", search.URL, "--index", alias)
	if test := mustSearchCommand(t, "", "test"); !strings.Contains(test, "Elasticsearch") {
		t.Fatalf("test = %q, want Elasticsearch named", test)
	}
	stdout := mustSearchCommand(t, "", "reindex")
	if !strings.HasPrefix(stdout, "Rebuilt the catalog index; "+alias+" now names "+alias+"-") {
		t.Fatalf("reindex stdout = %q", stdout)
	}
	if show := mustSearchCommand(t, "", "show"); !strings.Contains(show, "elasticsearch at "+search.URL) || !strings.Contains(show, "none due") {
		t.Fatalf("show after the reindex = %q, want the search on elasticsearch", show)
	}

	// The same node saved as OpenSearch fails its test, naming the product.
	mustSearchCommand(t, "", "set", "--engine", "opensearch", "--url", search.URL, "--index", alias)
	code, stdout, stderr := searchCommand(t, "", "test")
	if code != 1 || !strings.Contains(stdout, "Elasticsearch") || !strings.Contains(stderr, "SEARCH_TEST_WRONG_PRODUCT") {
		t.Fatalf("test of opensearch on Elasticsearch: exit code = %d, stdout = %q, stderr = %q", code, stdout, stderr)
	}
}
