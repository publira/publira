package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/testutil"
)

// The sweep that removes the tags nothing carries any more runs inside a series
// save, alongside other series saves. These tests pin the two rules that keep it
// from taking a tag another save has just taken: the sweep locks its candidates
// and re-checks them in a second statement, and the foreign key refuses a delete
// that would take a live assignment with it.

// seedTaggedSeries returns a tenant with two series and one tag, carried by the
// first series only.
func seedTaggedSeries(t *testing.T, pg *testutil.PostgresEnv) (tenantID, firstSeriesID, secondSeriesID, tagID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	first := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	second := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Series B", Published: true})

	tagID = uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tags (id, tenant_id, name, slug)
		VALUES ($1, $2, 'Time Travel', 'time-travel')
	`, tagID, tenant.ID); err != nil {
		t.Fatalf("insert tag: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_tags (tenant_id, series_id, tag_id)
		VALUES ($1, $2, $3)
	`, tenant.ID, first.ID, tagID); err != nil {
		t.Fatalf("insert series tag: %v", err)
	}
	return tenant.ID, first.ID, second.ID, tagID
}

// waitForBlockedBackend waits until some other session is waiting on a lock,
// which is how the test knows the sweep has reached the row the other save
// holds instead of racing past it.
func waitForBlockedBackend(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		var blocked int
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT count(*)
			FROM pg_stat_activity
			WHERE pid <> pg_backend_pid()
				AND wait_event_type = 'Lock'
		`).Scan(&blocked); err != nil {
			t.Fatalf("read pg_stat_activity: %v", err)
		}
		if blocked > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("no session ever waited on a lock; the sweep did not reach the tag the other save holds")
}

func TestUnusedTagSweepKeepsATagAnotherSaveTookWhileItWaited(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID, firstSeriesID, secondSeriesID, tagID := seedTaggedSeries(t, pg)

	// The save on the first series drops its assignments, which is what makes
	// the tag look unused from this transaction's snapshot.
	sweeping, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the sweeping transaction: %v", err)
	}
	defer sweeping.Rollback() //nolint:errcheck
	if _, err := sweeping.ExecContext(ctx, "DELETE FROM series_tags WHERE series_id = $1", firstSeriesID); err != nil {
		t.Fatalf("delete the assignments of the first series: %v", err)
	}

	// The save on the second series takes the same tag and holds the row it
	// upserted, without committing yet.
	taking, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the taking transaction: %v", err)
	}
	defer taking.Rollback() //nolint:errcheck
	if _, err := taking.ExecContext(ctx, `
		INSERT INTO tags (id, tenant_id, name, slug)
		VALUES ($1, $2, 'Time Travel', 'time-travel')
		ON CONFLICT (tenant_id, slug) DO UPDATE
		SET name = tags.name
	`, uuid.Must(uuid.NewV7()), tenantID); err != nil {
		t.Fatalf("upsert the tag: %v", err)
	}
	if _, err := taking.ExecContext(ctx, `
		INSERT INTO series_tags (tenant_id, series_id, tag_id)
		VALUES ($1, $2, $3)
	`, tenantID, secondSeriesID, tagID); err != nil {
		t.Fatalf("take the tag on the second series: %v", err)
	}

	// The sweep now blocks on the row the other save holds. It resumes once
	// that save commits, and the assignment it committed has to survive.
	type lockResult struct {
		ids []uuid.UUID
		err error
	}
	locked := make(chan lockResult, 1)
	go func() {
		rows, err := sweeping.QueryContext(ctx, `
			SELECT t.id
			FROM tags t
			WHERE t.tenant_id = $1
				AND NOT EXISTS (SELECT 1 FROM series_tags st WHERE st.tag_id = t.id)
			ORDER BY t.id
			FOR UPDATE
		`, tenantID)
		if err != nil {
			locked <- lockResult{err: err}
			return
		}
		defer rows.Close() //nolint:errcheck
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if scanErr := rows.Scan(&id); scanErr != nil {
				locked <- lockResult{err: scanErr}
				return
			}
			ids = append(ids, id)
		}
		locked <- lockResult{ids: ids, err: rows.Err()}
	}()

	waitForBlockedBackend(t, pg)
	if err := taking.Commit(); err != nil {
		t.Fatalf("commit the taking transaction: %v", err)
	}

	candidates := <-locked
	if candidates.err != nil {
		t.Fatalf("lock the unused tags: %v", candidates.err)
	}

	// Whether the stale snapshot still reports the tag as a candidate is up to
	// PostgreSQL. What matters is the second statement, which reads a fresh
	// snapshot and leaves the tag alone.
	if _, err := sweeping.ExecContext(ctx, `
		DELETE FROM tags t
		WHERE t.tenant_id = $1
			AND t.id = ANY($2::uuid[])
			AND NOT EXISTS (SELECT 1 FROM series_tags st WHERE st.tag_id = t.id)
	`, tenantID, uuidArray(candidates.ids)); err != nil {
		t.Fatalf("delete the unused tags: %v", err)
	}
	if err := sweeping.Commit(); err != nil {
		t.Fatalf("commit the sweeping transaction: %v", err)
	}

	var tags, assignments int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM tags WHERE id = $1", tagID).Scan(&tags); err != nil {
		t.Fatalf("count tags: %v", err)
	}
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM series_tags WHERE series_id = $1", secondSeriesID).Scan(&assignments); err != nil {
		t.Fatalf("count assignments: %v", err)
	}
	if tags != 1 {
		t.Fatalf("tag rows = %d, want the tag the second save took to survive", tags)
	}
	if assignments != 1 {
		t.Fatalf("assignments of the second series = %d, want the one it saved", assignments)
	}
}

func TestDeletingATagASeriesCarriesIsRefused(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, _, _, tagID := seedTaggedSeries(t, pg)

	_, err := pg.DB.ExecContext(ctx, "DELETE FROM tags WHERE id = $1", tagID)
	if !dberr.IsForeignKeyViolation(err) {
		t.Fatalf("delete of a tag a series carries = %v, want a foreign key violation", err)
	}
}

// uuidArray renders the locked ids for the delete's uuid[] parameter. lib/pq
// has no typed array for uuid.UUID, so they go over as strings.
func uuidArray(ids []uuid.UUID) any {
	values := make([]string, 0, len(ids))
	for _, id := range ids {
		values = append(values, id.String())
	}
	return pq.Array(values)
}
