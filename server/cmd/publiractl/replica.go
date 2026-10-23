package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/readreplica"
	"github.com/publira/publira/server/internal/sqldb"
)

// contentStatsDBReplicaURLEnv names the hot standby the rebuilds read
// content_events on, the variable publira worker reads for the same jobs. It
// has no development default: unset is no replica.
const contentStatsDBReplicaURLEnv = "PUBLIRA_CONTENT_STATS_DB_REPLICA_URL"

// openContentStatsReplica opens the replica contentStatsDBReplicaURLEnv names,
// bounded like every other pool, and answers nil when it is unset. It has to
// sign in as primary's login, the same check publira worker makes: a URL naming
// another login would read with that login's reach.
func openContentStatsReplica(ctx context.Context, primary *sql.DB) (*sql.DB, error) {
	url := strings.TrimSpace(os.Getenv(contentStatsDBReplicaURLEnv))
	if url == "" {
		return nil, nil
	}
	replica, err := sqldb.Open(url)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", contentStatsDBReplicaURLEnv, err)
	}
	if err := readreplica.CheckLogin(ctx, primary, replica); err != nil {
		_ = replica.Close()
		return nil, fmt.Errorf("%s: %w", contentStatsDBReplicaURLEnv, err)
	}
	return replica, nil
}
