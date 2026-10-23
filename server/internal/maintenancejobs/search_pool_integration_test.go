package maintenancejobs_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/testutil"
)

// A maintenance pass holds its turn on a connection of the maintenance pool,
// and the search index build holds its lock on another of the same pool, so
// the two each pin one while they work on a third. On a pool of the smallest
// size an operator may set, a build that comes due while a pass holds its turn
// still fills the index and moves the search onto it, rather than waiting on
// the pass for a connection the pass is waiting on too.
func TestASearchBuildFinishesBesideAMaintenancePassOnTheSmallestPool(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	engine := testutil.StartOpenSearch(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	secrets, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	tenant := pg.SeedTenant(t, "MAINTSEARCH1", "maintenancesearch.example.com", "Maintenance Search Tenant")
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "MAINTSEARCH2", Title: "Seed Garden", Published: true})

	pool := pg.OpenContentStatsDB(t)
	pool.SetMaxOpenConns(sqldb.MinMaxOpenConns)
	source := newHeldSource()
	startWorker(t, pg, maintenancejobs.Config{DB: pool, Storage: source, Secrets: secrets})

	select {
	case <-source.entered:
	case <-ctx.Done():
		t.Fatalf("waiting for the orphan image sweep to start: %v", ctx.Err())
	}
	defer close(source.release)

	if _, err := platformsearch.Save(ctx, pg.OpenPlatformDB(t), slog.New(slog.NewTextHandler(io.Discard, nil)), secrets, auditlog.SystemPlatformActor, platformsearch.SaveParams{
		Settings: platformsearch.Settings{
			Engine: platformsearch.EngineOpenSearch,
			URL:    engine.URL,
			Index:  "catalog-maintenance-pool-test-" + uuid.NewString(),
		},
	}); err != nil {
		t.Fatalf("save the search engine: %v", err)
	}
	inserter, err := river.NewClient(riverdatabasesql.New(pg.DB), &river.Config{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("build an insert-only client: %v", err)
	}
	if _, err := inserter.Insert(ctx, maintenancejobs.BuildSearchIndexArgs{}, nil); err != nil {
		t.Fatalf("enqueue a search index build: %v", err)
	}

	waitFor(t, ctx, "the search to move onto the built index while the sweep holds its turn", func() bool {
		row, found, err := platformsearch.Get(ctx, dbmodels.New(pg.DB))
		if err != nil {
			t.Fatalf("read the search settings: %v", err)
		}
		return found && platformsearch.FromConfig(row).State == platformsearch.Serving
	})
}
