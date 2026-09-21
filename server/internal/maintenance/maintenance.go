// Package maintenance runs this repository's recurring rebuild and purge work.
// Each job is a settings value with a Run method that builds its runner, runs
// one pass, and records what the pass covered in the structured log.
//
// Who invokes a pass is the caller's business. An operator invokes one from the
// command line through cmd/batch, and the worker invokes the same one on
// River's schedule through internal/maintenancejobs, so the two cannot drift
// into separate implementations of the same maintenance.
//
// The tunables are read from the environment here rather than by either caller,
// for that same reason: a chunk size the CLI honours and the worker ignores
// would be a setting that only works when a person types it.
package maintenance

import (
	"database/sql"
	"errors"
	"log/slog"

	"github.com/publira/publira/server/internal/storage"
)

// Deps is what a pass runs on.
type Deps struct {
	// DB is the maintenance role's own pool. Every query below runs on it.
	DB *sql.DB
	// Storage is the bucket OrphanImagePurge reclaims, and the one dependency
	// no other job takes.
	Storage storage.Reclaimer
	// Bucket names that bucket for the reclamation log. The Reclaimer holds
	// the name and exposes none, and a sweep that deletes objects is one whose
	// log has to say where it deleted them.
	Bucket string
	Logger *slog.Logger
}

// errNoDB is what a caller that passed no pool gets, rather than the nil
// dereference the first query would be.
var errNoDB = errors.New("maintenance: db is nil")

// errNoStorage is the same for the one job that reaches past the database.
var errNoStorage = errors.New("maintenance: storage is nil")

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}
