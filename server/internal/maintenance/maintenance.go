// Package maintenance runs this repository's recurring rebuild and purge work.
// Each job is a settings value with a Run method that builds its runner, runs
// one pass, and records what the pass covered in the structured log.
//
// Who invokes a pass is the caller's business. An operator invokes one from the
// command line through cmd/publiractl, and the worker invokes the same one on
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

	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/storage"
)

// Deps is what a pass runs on.
type Deps struct {
	// DB is the maintenance role's own pool. Every query below runs on it.
	DB *sql.DB
	// Storage resolves the bucket OrphanImagePurge reclaims, and is the one
	// dependency no other job takes.
	Storage storage.ReclaimerSource
	// Secrets decrypts the store credentials GooglePlayVoidedPurchaseSync
	// calls Google Play with, and GooglePlay is the API it calls.
	Secrets    paymentsettings.SecretManager
	GooglePlay VoidedPurchaseLister
	Logger     *slog.Logger
}

// errNoDB is what a caller that passed no pool gets, rather than the nil
// dereference the first query would be.
var errNoDB = errors.New("maintenance: db is nil")

// errNoStorage and errNoGooglePlay are the same for the jobs that reach past
// the database.
var (
	errNoStorage    = errors.New("maintenance: storage is nil")
	errNoGooglePlay = errors.New("maintenance: google play client is nil")
)

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}
