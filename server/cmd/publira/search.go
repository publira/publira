package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/sqlbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// searchBackendFromEnv reads PUBLIRA_SEARCH_BACKEND before any pool is opened,
// so a value naming no backend stops the process with the variable's name. What
// it returns builds the backend on the public pool.
func searchBackendFromEnv() (func(pool *sql.DB) catalogsearch.Backend, error) {
	switch name := strings.TrimSpace(os.Getenv("PUBLIRA_SEARCH_BACKEND")); name {
	case "", "sql":
		return func(pool *sql.DB) catalogsearch.Backend {
			return sqlbackend.New(dbmodels.New(pool))
		}, nil
	default:
		return nil, fmt.Errorf("PUBLIRA_SEARCH_BACKEND %q names no search backend; the one available is \"sql\"", name)
	}
}
