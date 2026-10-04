package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	"github.com/publira/publira/server/internal/catalogsearch/sqlbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// searchConnectTimeout bounds how long a starting process waits for the
// search engine before it gives up.
const searchConnectTimeout = 30 * time.Second

// searchBackendFromEnv reads PUBLIRA_SEARCH_BACKEND before any pool is opened,
// so a value naming no backend stops the process with the variable's name. What
// it returns builds the backend on the public pool.
//
// The OpenSearch backend is connected here rather than on the first search:
// an engine that does not answer stops the process, the same way a missing
// variable does, instead of leaving it to answer every search with an error.
func searchBackendFromEnv() (func(pool *sql.DB) catalogsearch.Backend, error) {
	switch name := strings.TrimSpace(os.Getenv("PUBLIRA_SEARCH_BACKEND")); name {
	case "", "sql":
		return func(pool *sql.DB) catalogsearch.Backend {
			return sqlbackend.New(dbmodels.New(pool))
		}, nil
	case "opensearch":
		cfg, err := opensearchbackend.ConfigFromEnv()
		if err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), searchConnectTimeout)
		defer cancel()
		backend, err := opensearchbackend.New(ctx, cfg)
		if err != nil {
			return nil, err
		}
		return func(*sql.DB) catalogsearch.Backend { return backend }, nil
	default:
		return nil, fmt.Errorf("PUBLIRA_SEARCH_BACKEND %q names no search backend; the ones available are \"sql\" and \"opensearch\"", name)
	}
}
