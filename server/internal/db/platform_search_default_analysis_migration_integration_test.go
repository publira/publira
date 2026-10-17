package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/lib/pq"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// serving configuration recorded the version of the default analysis its
// indices were built with, and the one that started recording it.
const (
	beforeDefaultAnalysisVersion = 20261017124715
	defaultAnalysisVersion       = 20261017135523
)

// Indices built from the default before its version was recorded were built
// from the earlier default, built for Japanese on plugins, so once the
// migrations have run they have a build due, which rebuilds them with the one
// the server ships. Indices built from a saved shared definition stay served.
func TestDefaultAnalysisVersionMigrationRebuildsWhatTheDefaultBuilt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforeDefaultAnalysisVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The row is written by hand, serving the revision it was saved at with an
	// index for every language: the generated queries read back every column
	// on the newest schema.
	serve := func(analysis any) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `DELETE FROM platform_search_config`); err != nil {
			t.Fatalf("delete the search settings: %v", err)
		}
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO platform_search_config (
			    engine, url, index_alias, analysis, revision,
			    serving_revision, serving_engine, serving_url, serving_index_alias, serving_analysis, serving_locales, serving_since
			)
			VALUES ('opensearch', 'http://search.example.com', 'publira-catalog', $1, 3,
			        3, 'opensearch', 'http://search.example.com', 'publira-catalog', $1, $2, NOW())
		`, analysis, pq.Array(platformsearch.IndexLocales)); err != nil {
			t.Fatalf("insert the search settings: %v", err)
		}
	}
	state := func() platformsearch.BuildState {
		t.Helper()
		row, _, err := platformsearch.Get(ctx, dbmodels.New(pg.DB))
		if err != nil {
			t.Fatalf("read the search settings: %v", err)
		}
		return platformsearch.FromConfig(row).State
	}

	serve(nil)
	pg.MigrateTo(t, defaultAnalysisVersion)
	if got := state(); got != platformsearch.Building {
		t.Fatalf("state of indices built from the default = %v, want a build due", got)
	}

	pg.MigrateTo(t, beforeDefaultAnalysisVersion)
	serve(`{"analyzer":{"written_form":{"type":"standard"},"alternate_form":{"type":"standard"}},"normalizer":{"exact_match":{"type":"custom"}}}`)
	pg.MigrateTo(t, defaultAnalysisVersion)
	if got := state(); got != platformsearch.Serving {
		t.Fatalf("state of indices built from a saved analysis = %v, want them served", got)
	}
}
