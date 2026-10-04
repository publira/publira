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
func searchBackendFromEnv() (func(pool *sql.DB) catalogsearch.Backend, error) {
	backend, err := openSearchFromEnv()
	if err != nil {
		return nil, err
	}
	if backend == nil {
		return func(pool *sql.DB) catalogsearch.Backend {
			return sqlbackend.New(dbmodels.New(pool))
		}, nil
	}
	return func(*sql.DB) catalogsearch.Backend { return backend }, nil
}

// openSearchFromEnv connects to OpenSearch when PUBLIRA_SEARCH_BACKEND names
// it, and answers nil for the SQL backend, which keeps no index. The server
// searches through what it returns and the worker writes the catalog index
// through it.
//
// The engine is connected here rather than on first use: one that does not
// answer stops the process, the same way a missing variable does, instead of
// leaving it to answer every search or every outbox event with an error.
func openSearchFromEnv() (*opensearchbackend.Backend, error) {
	switch name := strings.TrimSpace(os.Getenv("PUBLIRA_SEARCH_BACKEND")); name {
	case "", "sql":
		return nil, nil
	case "opensearch":
		cfg, err := opensearchbackend.ConfigFromEnv()
		if err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), searchConnectTimeout)
		defer cancel()
		return opensearchbackend.New(ctx, cfg)
	default:
		return nil, fmt.Errorf("PUBLIRA_SEARCH_BACKEND %q names no search backend; the ones available are \"sql\" and \"opensearch\"", name)
	}
}
