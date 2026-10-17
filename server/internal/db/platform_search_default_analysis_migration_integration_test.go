package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// default analysis was built on no plugin, and the one that leaves the indices
// built from the earlier default to be built again.
const (
	beforePluginFreeDefaultAnalysisVersion = 20261017013141
	pluginFreeDefaultAnalysisVersion       = 20261017105846
)

// An engine whose indices were built from the default analysis has a build
// due once the migrations have run, which rebuilds them with the default the
// server now ships, and one built from a saved shared analysis has none.
func TestPluginFreeDefaultAnalysisMigrationRebuildsWhatTheDefaultBuilt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforePluginFreeDefaultAnalysisVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The row is written by hand, serving the revision it was saved at: the
	// generated queries read back every column on the newest schema.
	serve := func(analysis any) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `DELETE FROM platform_search_config`); err != nil {
			t.Fatalf("delete the search settings: %v", err)
		}
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO platform_search_config (
			    engine, url, index_alias, analysis, revision,
			    serving_revision, serving_engine, serving_url, serving_index_alias, serving_analysis, serving_since
			)
			VALUES ('opensearch', 'http://search.example.com', 'publira-catalog', $1, 3,
			        3, 'opensearch', 'http://search.example.com', 'publira-catalog', $1, NOW())
		`, analysis); err != nil {
			t.Fatalf("insert the search settings: %v", err)
		}
	}
	revisions := func() (revision, serving int64) {
		t.Helper()
		if err := pg.DB.QueryRowContext(ctx, `SELECT revision, serving_revision FROM platform_search_config`).Scan(&revision, &serving); err != nil {
			t.Fatalf("read the search settings: %v", err)
		}
		return revision, serving
	}

	serve(nil)
	pg.MigrateTo(t, pluginFreeDefaultAnalysisVersion)
	// A revision ahead of the serving one is a build due.
	if revision, serving := revisions(); revision != 4 || serving != 3 {
		t.Fatalf("revisions of the default = (%d, %d), want (4, 3)", revision, serving)
	}

	pg.MigrateTo(t, beforePluginFreeDefaultAnalysisVersion)
	serve(`{"analyzer":{"written_form":{"type":"standard"},"alternate_form":{"type":"standard"}},"normalizer":{"exact_match":{"type":"custom"}}}`)
	pg.MigrateTo(t, pluginFreeDefaultAnalysisVersion)
	if revision, serving := revisions(); revision != 3 || serving != 3 {
		t.Fatalf("revisions of a saved analysis = (%d, %d), want (3, 3)", revision, serving)
	}
}
