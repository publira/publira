package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/sqldb"
)

var searchGroup = commandGroup{
	name:    "search",
	summary: "Rebuild the OpenSearch catalog index from the database",
	commands: []command{
		{
			name:    "reindex",
			summary: "Rebuild the catalog index into a new index and move the alias onto it, or rewrite one tenant's documents in place",
			setup:   setupSearchReindex,
		},
	},
}

// defaultContentStatsDBURL is publira_content_stats in the development
// database, the same fallback publira worker uses for
// PUBLIRA_CONTENT_STATS_DB_URL. The reindex reads every tenant's catalog and
// writes nothing to the database, which is the maintenance role's reach.
const defaultContentStatsDBURL = "postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable"

// searchConnectTimeout bounds how long the command waits for the engine to
// answer before it gives up.
const searchConnectTimeout = 30 * time.Second

var errNoSearchIndex = errors.New(`PUBLIRA_SEARCH_BACKEND is not "opensearch"; the SQL backend keeps no index to rebuild`)

func setupSearchReindex(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := f.String("tenant", "", "rewrite only this tenant's documents, by public ID or domain, without a new index")
	return func(ctx context.Context, env *commandEnv) error {
		if strings.TrimSpace(os.Getenv("PUBLIRA_SEARCH_BACKEND")) != "opensearch" {
			return errNoSearchIndex
		}
		cfg, err := opensearchbackend.ConfigFromEnv()
		if err != nil {
			return err
		}
		connectCtx, cancel := context.WithTimeout(ctx, searchConnectTimeout)
		backend, err := opensearchbackend.New(connectCtx, cfg)
		cancel()
		if err != nil {
			return err
		}

		db, err := sqldb.Open(resolveDBURL(defaultContentStatsDBURL, "PUBLIRA_CONTENT_STATS_DB_URL"))
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck

		if *ref != "" {
			return syncSearchTenant(ctx, env, db, backend, *ref)
		}
		index, err := catalogindex.Rebuild(ctx, db, backend, env.logger)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(env.stdout, "Rebuilt the catalog index; %s now names %s.\n", cfg.Index, index)
		return err
	}
}

// syncSearchTenant rewrites one tenant's documents in the index the alias
// names. It makes no new index: one holding a single tenant would have to
// copy every other tenant's documents across, and the writes their events
// made during the copy would be lost with the old index.
func syncSearchTenant(ctx context.Context, env *commandEnv, db *sql.DB, backend *opensearchbackend.Backend, ref string) error {
	tenant, err := platformtenants.Find(ctx, dbmodels.New(db), ref)
	if err != nil {
		return tenantError(err)
	}
	written, deleted, err := catalogindex.SyncTenant(ctx, db, backend, tenant.ID)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(env.stdout, "Rewrote the catalog documents of tenant %s: %d written, %d deleted.\n", tenant.PublicID, written, deleted)
	return err
}
