package dataexport

import (
	"context"
	"database/sql"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/storage/storagetest"
	"github.com/publira/publira/server/internal/testutil"
)

// A build that outlived its claim and one that took the request over both
// store an archive. The one whose record loses deletes what it stored, and
// the archive the row names stays.
func TestTheBuildWhoseClaimLostDeletesOnlyItsOwnArchive(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "EXPORTRACE01", "export-race.example.com", "Export Race")
	reader := pg.SeedEndUser(t, tenant.ID, "EXPORTRACEU1", "reader@export-race.example.com", "Reader")
	id := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(context.Background(), `INSERT INTO user_data_exports (id, tenant_id, user_id) VALUES ($1, $2, $3)`, id, tenant.ID, reader.ID); err != nil {
		t.Fatalf("insert data export: %v", err)
	}

	db := pg.OpenContentStatsDB(t)
	queries := dbmodels.New(db)
	bucket := storagetest.NewMemory()
	started := time.Date(2026, 11, 2, 6, 0, 0, 0, time.UTC)
	claim := func(at time.Time) dbmodels.UserDataExport {
		t.Helper()
		request, err := queries.ClaimUserDataExport(context.Background(), dbmodels.ClaimUserDataExportParams{
			ClaimedAt:   sql.NullTime{Time: at, Valid: true},
			StaleBefore: at.Add(-StaleClaim),
		})
		if err != nil {
			t.Fatalf("claim at %s: %v", at, err)
		}
		return request
	}
	first := claim(started)
	second := claim(started.Add(StaleClaim + time.Minute))
	deps := func(at time.Time) Deps {
		return Deps{DB: db, Storage: bucket, Reclaimers: bucket, Logger: slog.New(slog.DiscardHandler), Now: func() time.Time { return at }}
	}

	if built, err := buildOne(context.Background(), deps(second.ClaimedAt.Time), queries, second); err != nil || !built {
		t.Fatalf("the build under the second claim = %v, %v, want built", built, err)
	}
	if built, err := buildOne(context.Background(), deps(second.ClaimedAt.Time.Add(time.Minute)), queries, first); err != nil || built {
		t.Fatalf("the build under the first claim = %v, %v, want its record refused", built, err)
	}

	var key string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT object_key FROM user_data_exports WHERE id = $1`, id).Scan(&key); err != nil {
		t.Fatalf("read the object key: %v", err)
	}
	if keys := bucket.Keys(); !slices.Equal(keys, []string{key}) {
		t.Fatalf("bucket = %v, want the archive the row names, %s, alone", keys, key)
	}
}
