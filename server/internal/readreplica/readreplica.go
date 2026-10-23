// Package readreplica answers a request's reads from a hot standby of the
// primary, and only when doing so cannot show the request less than the
// primary would have.
//
// A standby replays the primary's write-ahead log behind it, so a row the
// primary committed a moment ago may not be on the standby yet. That lag is not
// left for the reader to see. Before a request is answered on the replica, the
// primary's current write position is read, and the replica answers only once
// it has replayed up to that position: every transaction that committed before
// the request arrived is then visible on it. A replica still short of that
// position after [CatchUpWait] does not answer, and the primary does.
//
// The rule is what keeps the web apps' caches correct, and not only a reader's
// own writes. A write drops the cache entries it leaves stale once it has
// committed, and the next request refills them; a replica that answered that
// request from before the write would put the previous answer back for as long
// as the entry lives. Under the rule, a refill requested after the commit is
// answered with it.
//
// The primary still answers one statement per request, pg_current_wal_flush_lsn(),
// which reads shared memory and touches no table. The flushed position is the
// one compared because it is the one a standby can reach: the primary streams
// only what it has flushed, and a record inserted but not yet flushed — the
// ones nothing waits on are flushed by the WAL writer up to 200ms later — would
// hold every request past [CatchUpWait] on a primary doing nothing. A commit
// is flushed before it returns, so the flushed position already covers every
// transaction that has committed, as long as synchronous_commit is left on,
// which Publira never turns off.
package readreplica

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/tenantconn"
)

const (
	// CatchUpWait is how long a request waits for the replica to replay up to
	// the primary's position before the primary answers it instead. Streaming
	// replication within one region is ordinarily a few milliseconds behind,
	// and the primary is never idle while readers write view events, so the
	// replica is rarely at the primary's very position when a request arrives
	// and usually is within a few polls. A replica further behind than this is
	// lagging, and the request is better answered at once on the primary than
	// held for it.
	CatchUpWait = 50 * time.Millisecond

	// catchUpPoll is how often the replica's position is read again while a
	// request waits for it.
	catchUpPoll = 5 * time.Millisecond

	primaryPositionSQL = "SELECT pg_current_wal_flush_lsn()::text"

	// replayedSQL answers whether the server is a standby and, when it is,
	// whether it has replayed up to $1. A server that is not in recovery is
	// not a standby of the primary, whatever the variable that named it says,
	// and its position cannot be compared with the primary's.
	replayedSQL = "SELECT pg_is_in_recovery(), COALESCE(pg_last_wal_replay_lsn() >= $1::pg_lsn, false)"
)

// Pools is one login's primary pool and, optionally, its replica pool.
type Pools struct {
	// Primary is the pool every write and every read the replica does not
	// answer is made on.
	Primary *sql.DB
	// Replica is a pool on a hot standby of Primary's cluster, signed in as the
	// same login, which [CheckLogin] confirms. Nil keeps every read on
	// Primary.
	Replica *sql.DB
	// Logger reports the connections tenantconn has to discard; nil is
	// slog.Default.
	Logger *slog.Logger
}

// CheckLogin refuses a replica that does not sign in as the same login as
// primary. A replica signed in as another login would answer as that login's
// row-level security and grants, which is a role change the operator did not
// ask for.
func CheckLogin(ctx context.Context, primary, replica *sql.DB) error {
	var primaryLogin, replicaLogin string
	if err := primary.QueryRowContext(ctx, "SELECT current_user").Scan(&primaryLogin); err != nil {
		return fmt.Errorf("read the primary's login: %w", err)
	}
	if err := replica.QueryRowContext(ctx, "SELECT current_user").Scan(&replicaLogin); err != nil {
		return fmt.Errorf("read the replica's login: %w", err)
	}
	if primaryLogin != replicaLogin {
		return fmt.Errorf("the replica signs in as %s, not as %s like the primary", replicaLogin, primaryLogin)
	}
	return nil
}

// Acquire returns a connection bound to tenantID the way [tenantconn.Acquire]
// does, on the replica when it has replayed everything the primary had
// committed when Acquire was called, and on the primary otherwise. onReplica
// reports which one it is.
//
// The replica's position is read on the connection that is returned, because
// a replica URL may name several standbys behind one address, and two
// connections to it need not be on the same one. An error from the replica is
// returned rather than answered on the primary: the replica's readiness check
// is what takes a process whose replica is down out of service.
func (p Pools) Acquire(ctx context.Context, tenantID uuid.UUID) (conn *sql.Conn, release func(), onReplica bool, err error) {
	if p.Replica == nil {
		conn, release, err = tenantconn.Acquire(ctx, p.Primary, tenantID, p.Logger)
		return conn, release, false, err
	}

	var position string
	if err := p.Primary.QueryRowContext(ctx, primaryPositionSQL).Scan(&position); err != nil {
		return nil, func() {}, false, fmt.Errorf("read the primary's position: %w", err)
	}

	conn, release, err = tenantconn.Acquire(ctx, p.Replica, tenantID, p.Logger)
	if err != nil {
		return nil, func() {}, false, err
	}
	caughtUp, err := waitForReplay(ctx, conn, position)
	if err != nil {
		release()
		return nil, func() {}, false, err
	}
	if caughtUp {
		return conn, release, true, nil
	}
	release()

	conn, release, err = tenantconn.Acquire(ctx, p.Primary, tenantID, p.Logger)
	return conn, release, false, err
}

// errNotStandby stops the wait for a replica that is not in recovery, which
// will never replay anything.
var errNotStandby = errors.New("not a standby")

// waitForReplay reports whether conn's server replays up to position within
// [CatchUpWait].
func waitForReplay(ctx context.Context, conn *sql.Conn, position string) (bool, error) {
	deadline := time.Now().Add(CatchUpWait)
	for {
		caughtUp, err := replayed(ctx, conn, position)
		if errors.Is(err, errNotStandby) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if caughtUp {
			return true, nil
		}
		wait := min(catchUpPoll, time.Until(deadline))
		if wait <= 0 {
			return false, nil
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, ctx.Err()
		case <-timer.C:
		}
	}
}

func replayed(ctx context.Context, conn *sql.Conn, position string) (bool, error) {
	var inRecovery, caughtUp bool
	if err := conn.QueryRowContext(ctx, replayedSQL, position).Scan(&inRecovery, &caughtUp); err != nil {
		return false, fmt.Errorf("read the replica's position: %w", err)
	}
	if !inRecovery {
		return false, errNotStandby
	}
	return caughtUp, nil
}
