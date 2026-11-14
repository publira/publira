package outbox_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// episodeHoldEnv is a tenant with one episode, which the tests delete the way
// DeleteEpisode does: its listing locked for update, then the episode.
type episodeHoldEnv struct {
	pg       *testutil.PostgresEnv
	tenantID uuid.UUID
	episode  testutil.Episode
}

func newEpisodeHoldEnv(t *testing.T) episodeHoldEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "HOLDT1", "hold.example.com", "Hold Press")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "HOLDSER1", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "HOLDEP01", Title: "Episode", Status: testutil.EpisodeStatusPublished,
	})
	return episodeHoldEnv{pg: pg, tenantID: tenant.ID, episode: episode}
}

// beginDeletion opens the deletion's transaction and locks the listing as
// DeleteEpisode does, giving up after lockTimeout when one is named.
func (e episodeHoldEnv) beginDeletion(t *testing.T, ctx context.Context, lockTimeout string) (*sql.Tx, error) {
	t.Helper()
	tx, err := e.pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the deletion: %v", err)
	}
	if lockTimeout != "" {
		if _, err := tx.ExecContext(ctx, "SET LOCAL lock_timeout = '"+lockTimeout+"'"); err != nil {
			t.Fatalf("set lock_timeout: %v", err)
		}
	}
	_, err = tx.ExecContext(ctx, "SELECT 1 FROM episode_listings WHERE tenant_id = $1 AND episode_id = $2 FOR UPDATE", e.tenantID, e.episode.ID)
	return tx, err
}

func (e episodeHoldEnv) finishDeletion(t *testing.T, ctx context.Context, tx *sql.Tx) {
	t.Helper()
	if _, err := tx.ExecContext(ctx, "DELETE FROM episodes WHERE tenant_id = $1 AND id = $2", e.tenantID, e.episode.ID); err != nil {
		t.Fatalf("delete the episode: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit the deletion: %v", err)
	}
}

// A deletion that began first is waited for, and leaves nothing to file: the
// notification it would have missed is never written.
func TestHoldEpisodeWaitsForADeletionThatBeganFirst(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	env := newEpisodeHoldEnv(t)

	deletion, err := env.beginDeletion(t, ctx, "")
	if err != nil {
		t.Fatalf("lock the listing: %v", err)
	}
	defer deletion.Rollback() //nolint:errcheck

	type result struct {
		held, filed bool
		err         error
	}
	done := make(chan result, 1)
	worker := env.pg.OpenOutboxDB(t)
	go func() {
		filed := false
		held, err := outbox.HoldEpisode(ctx, worker, env.tenantID, env.episode.PublicID, func(*dbmodels.Queries) error {
			filed = true
			return nil
		})
		done <- result{held: held, filed: filed, err: err}
	}()

	select {
	case r := <-done:
		t.Fatalf("the hold returned %+v while the deletion held the listing", r)
	case <-time.After(500 * time.Millisecond):
	}
	env.finishDeletion(t, ctx, deletion)

	r := <-done
	if r.err != nil {
		t.Fatalf("HoldEpisode: %v", r.err)
	}
	if r.held || r.filed {
		t.Fatalf("held = %v, filed = %v, want neither once the episode is gone", r.held, r.filed)
	}
}

// A hold that began first keeps the deletion waiting until its notification is
// committed, so the removal the deletion queues finds the row. The ticker's
// login holds it as the worker's does.
func TestHoldEpisodeKeepsADeletionWaitingUntilItCommits(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	env := newEpisodeHoldEnv(t)

	for name, db := range map[string]*sql.DB{
		"outbox": env.pg.OpenOutboxDB(t),
		"ticker": env.pg.OpenTickerDB(t),
	} {
		held, err := outbox.HoldEpisode(ctx, db, env.tenantID, env.episode.PublicID, func(q *dbmodels.Queries) error {
			deletion, err := env.beginDeletion(t, ctx, "200ms")
			defer deletion.Rollback() //nolint:errcheck
			if !isLockNotAvailable(err) {
				t.Errorf("%s: the deletion's lock = %v, want it to wait for the hold", name, err)
			}
			return nil
		})
		if err != nil || !held {
			t.Fatalf("%s: HoldEpisode = %v, %v, want held", name, held, err)
		}
	}

	// Once the hold is over, the deletion goes ahead.
	deletion, err := env.beginDeletion(t, ctx, "5s")
	if err != nil {
		t.Fatalf("lock the listing after the hold: %v", err)
	}
	env.finishDeletion(t, ctx, deletion)
}

// isLockNotAvailable reports whether err is PostgreSQL's lock_not_available,
// which a lock_timeout raises.
func isLockNotAvailable(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "55P03"
}
