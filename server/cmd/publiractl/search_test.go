package main

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func searchCommand(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := runGroup(&searchGroup, args, pipedConsole("", &stderr), &stdout)
	return code, stdout.String(), stderr.String()
}

// The SQL backend keeps no index, so there is nothing to build and the command
// says so rather than connecting anywhere.
func TestSearchReindexRefusesTheSQLBackend(t *testing.T) {
	t.Setenv("PUBLIRA_SEARCH_BACKEND", "sql")
	code, _, stderr := searchCommand(t, "reindex")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1; stderr:\n%s", code, stderr)
	}
	if !strings.Contains(stderr, "PUBLIRA_SEARCH_BACKEND") {
		t.Fatalf("stderr = %q, want the variable named", stderr)
	}
}

func TestSearchReindexBuildsTheIndexAndRewritesOneTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	search := testutil.StartOpenSearch(t)
	alias := "catalog-publiractl-" + uuid.NewString()
	t.Setenv("PUBLIRA_SEARCH_BACKEND", "opensearch")
	t.Setenv("PUBLIRA_OPENSEARCH_URL", search.URL)
	t.Setenv("PUBLIRA_OPENSEARCH_INDEX", alias)
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

	code, stdout, stderr := searchCommand(t, "reindex")
	if code != 0 {
		t.Fatalf("reindex: exit code = %d\n%s", code, stderr)
	}
	if !strings.HasPrefix(stdout, "Rebuilt the catalog index; "+alias+" now names "+alias+"-") {
		t.Fatalf("reindex stdout = %q, want the index the alias names", stdout)
	}

	code, stdout, stderr = searchCommand(t, "reindex", "--tenant", "search-ctl.example.com")
	if code != 0 {
		t.Fatalf("reindex --tenant: exit code = %d\n%s", code, stderr)
	}
	if want := "Rewrote the catalog documents of tenant SEARCHCTL001: 1 written, 1 deleted.\n"; stdout != want {
		t.Fatalf("reindex --tenant stdout = %q, want %q", stdout, want)
	}
}
