package testutil

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/network"
	"github.com/testcontainers/testcontainers-go/wait"
)

// primaryAlias is the name the standby reaches the primary by on the network
// the two containers share.
const primaryAlias = "primary"

// allowReplicationScript lets the standby stream from the primary. The image
// only admits ordinary connections from other hosts, and a replication
// connection is matched by its own line in pg_hba.conf. It runs before the
// server is started for good, so nothing has to reload it.
const allowReplicationScript = `#!/bin/sh
set -e
echo "host replication all all scram-sha-256" >> "$PGDATA/pg_hba.conf"
`

// standbyScript copies the primary with pg_basebackup and starts the copy as a
// hot standby streaming from it. -R writes the connection it copied over into
// the standby's configuration, so the copy follows the primary from the
// position the backup ended at; -c fast skips the spread checkpoint that would
// otherwise hold the backup for minutes.
const standbyScript = `set -e
dir=/var/lib/postgresql/standby
rm -rf "$dir"
pg_basebackup -h ` + primaryAlias + ` -U ` + defaultUser + ` -D "$dir" -R -X stream -c fast
chmod 700 "$dir"
exec postgres -D "$dir"
`

// ReplicatedPostgres is a PostgreSQL primary prepared the way [StartPostgres]
// prepares the shared one, with a hot standby of the whole cluster streaming
// from it, so a test can read from a server that answers as of a moment the
// primary has moved past.
//
// The embedded environment is the primary, and every seed helper writes there.
// It is the test's own pair rather than a shared one, and it has no snapshot:
// [PostgresEnv.Reset] is not for it.
type ReplicatedPostgres struct {
	*PostgresEnv
	// StandbyURL is the superuser on the standby.
	StandbyURL string
	// StandbyPublicURL connects to the standby as publira_public, the login the
	// storefront's replica pool signs in as.
	StandbyPublicURL string
	// StandbyContentStatsURL connects to the standby as publira_content_stats,
	// the login the maintenance jobs' replica pool signs in as.
	StandbyContentStatsURL string

	standby *sql.DB
}

// StartReplicatedPostgres starts a primary and a hot standby of it for the
// test, and terminates both when the test ends. Skips when -short is set or
// Docker is unavailable.
func StartReplicatedPostgres(t *testing.T) *ReplicatedPostgres {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping PostgreSQL integration test in short mode")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()

	skipOrFail := func(format string, err error) {
		t.Helper()
		if isDockerUnavailable(err) {
			t.Skipf("skipping PostgreSQL integration test: Docker unavailable: %v", err)
		}
		t.Fatalf(format, err)
	}

	nw, err := network.New(ctx)
	if err != nil {
		skipOrFail("create network: %v", err)
	}
	t.Cleanup(func() {
		if err := nw.Remove(context.Background()); err != nil {
			t.Errorf("remove network: %v", err)
		}
	})

	primary, err := postgres.Run(
		ctx,
		defaultPostgresImage,
		postgres.WithDatabase(defaultDatabase),
		postgres.WithUsername(defaultUser),
		postgres.WithPassword(defaultPassword),
		postgres.BasicWaitStrategies(),
		postgres.WithSQLDriver("pgx"),
		network.WithNetwork([]string{primaryAlias}, nw),
		testcontainers.WithFiles(testcontainers.ContainerFile{
			Reader:            strings.NewReader(allowReplicationScript),
			ContainerFilePath: "/docker-entrypoint-initdb.d/allow-replication.sh",
			FileMode:          0o755,
		}),
	)
	if err != nil {
		skipOrFail("start primary: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(primary); err != nil {
			t.Errorf("terminate primary: %v", err)
		}
	})

	primaryURL, err := primary.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("primary connection string: %v", err)
	}
	if err := runMigrations(primaryURL); err != nil {
		t.Fatalf("migrate primary: %v", err)
	}
	db, err := sql.Open("pgx", primaryURL)
	if err != nil {
		t.Fatalf("open primary: %v", err)
	}
	configurePool(db)
	t.Cleanup(func() { _ = db.Close() })
	if err := applyAppRoles(ctx, db); err != nil {
		t.Fatalf("apply app roles: %v", err)
	}

	// The standby is copied after the schema and the roles exist, so it starts
	// with both and every row seeded later reaches it by replication.
	standby, err := testcontainers.Run(
		ctx,
		defaultPostgresImage,
		network.WithNetwork([]string{"standby"}, nw),
		testcontainers.WithEnv(map[string]string{"PGPASSWORD": defaultPassword}),
		testcontainers.WithConfigModifier(func(config *container.Config) {
			config.User = "postgres"
		}),
		testcontainers.WithEntrypoint("sh", "-c", standbyScript),
		testcontainers.WithExposedPorts("5432/tcp"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept read-only connections"),
			wait.ForListeningPort("5432/tcp"),
		),
	)
	if err != nil {
		skipOrFail("start standby: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(standby); err != nil {
			t.Errorf("terminate standby: %v", err)
		}
	})

	endpoint, err := standby.PortEndpoint(ctx, "5432/tcp", "")
	if err != nil {
		t.Fatalf("standby endpoint: %v", err)
	}
	standbyURL := fmt.Sprintf("postgres://%s:%s@%s/%s?sslmode=disable", defaultUser, defaultPassword, endpoint, defaultDatabase)
	standbyDB, err := sql.Open("pgx", standbyURL)
	if err != nil {
		t.Fatalf("open standby: %v", err)
	}
	configurePool(standbyDB)
	t.Cleanup(func() { _ = standbyDB.Close() })

	env := &PostgresEnv{URL: primaryURL, DB: db}
	for _, login := range []struct {
		target   *string
		user     string
		password string
	}{
		{&env.PlatformURL, platformDBUser, platformDBPassword},
		{&env.AdminURL, adminDBUser, adminDBPassword},
		{&env.PublicURL, publicDBUser, publicDBPassword},
		{&env.TickerURL, tickerDBUser, tickerDBPassword},
		{&env.OutboxURL, outboxDBUser, outboxDBPassword},
		{&env.ContentStatsURL, contentStatsDBUser, contentStatsDBPassword},
	} {
		if *login.target, err = appConnectionString(primaryURL, login.user, login.password); err != nil {
			t.Fatal(err)
		}
	}
	standbyPublicURL, err := appConnectionString(standbyURL, publicDBUser, publicDBPassword)
	if err != nil {
		t.Fatal(err)
	}
	standbyContentStatsURL, err := appConnectionString(standbyURL, contentStatsDBUser, contentStatsDBPassword)
	if err != nil {
		t.Fatal(err)
	}
	return &ReplicatedPostgres{
		PostgresEnv:            env,
		StandbyURL:             standbyURL,
		StandbyPublicURL:       standbyPublicURL,
		StandbyContentStatsURL: standbyContentStatsURL,
		standby:                standbyDB,
	}
}

// OpenStandbyPublicDB opens a connection to the standby as publira_public. The
// connection is closed via t.Cleanup.
func (r *ReplicatedPostgres) OpenStandbyPublicDB(t *testing.T) *sql.DB {
	t.Helper()
	return r.openAppDB(t, r.StandbyPublicURL, publicDBUser)
}

// OpenStandbyContentStatsDB opens a connection to the standby as
// publira_content_stats. The connection is closed via t.Cleanup.
func (r *ReplicatedPostgres) OpenStandbyContentStatsDB(t *testing.T) *sql.DB {
	t.Helper()
	return r.openAppDB(t, r.StandbyContentStatsURL, contentStatsDBUser)
}

// WaitForReplay waits until the standby has replayed everything the primary
// has committed so far, which is what a test reading from the standby needs
// after seeding the primary.
func (r *ReplicatedPostgres) WaitForReplay(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()

	var position string
	if err := r.DB.QueryRowContext(ctx, "SELECT pg_current_wal_flush_lsn()::text").Scan(&position); err != nil {
		t.Fatalf("read the primary's position: %v", err)
	}
	for {
		var replayed bool
		if err := r.standby.QueryRowContext(ctx, "SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn", position).Scan(&replayed); err != nil {
			t.Fatalf("read the standby's position: %v", err)
		}
		if replayed {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("the standby did not replay up to %s: %v", position, ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// PauseReplay stops the standby applying what the primary sends until
// [ReplicatedPostgres.ResumeReplay], so everything written on the primary in
// between is replication lag the standby does not catch up on by itself. It
// returns once replay has actually stopped. Replay is resumed when the test
// ends.
func (r *ReplicatedPostgres) PauseReplay(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()

	if _, err := r.standby.ExecContext(ctx, "SELECT pg_wal_replay_pause()"); err != nil {
		t.Fatalf("pause replay: %v", err)
	}
	t.Cleanup(func() { _ = r.resumeReplay(context.Background()) })
	for {
		var state string
		if err := r.standby.QueryRowContext(ctx, "SELECT pg_get_wal_replay_pause_state()").Scan(&state); err != nil {
			t.Fatalf("read replay state: %v", err)
		}
		if state == "paused" {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("replay did not pause: %v", ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// ResumeReplay lets the standby apply what the primary sent while it was
// paused.
func (r *ReplicatedPostgres) ResumeReplay(t *testing.T) {
	t.Helper()
	if err := r.resumeReplay(t.Context()); err != nil {
		t.Fatalf("resume replay: %v", err)
	}
}

func (r *ReplicatedPostgres) resumeReplay(ctx context.Context) error {
	_, err := r.standby.ExecContext(ctx, "SELECT pg_wal_replay_resume()")
	return err
}
