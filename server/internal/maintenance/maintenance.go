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
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentreconciliation"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/readreplica"
	"github.com/publira/publira/server/internal/storage"
)

// Deps is what a pass runs on.
type Deps struct {
	// DB is the maintenance role's own pool. Every write runs on it, and so
	// does every read Replica does not make.
	DB *sql.DB
	// Replica is a pool on a hot standby of DB's cluster, signed in as the
	// same login. Nil keeps every read on DB. It makes a job's read only when
	// the read is of content_events, the table every reader's view appends to
	// and the one whose reads grow with an install, and only when the job is
	// a rebuild that replaces rows of its own with what it read:
	//
	//   - ContentStatsAggregation reads a tenant's day of content_events,
	//     purchases and published comments on it.
	//   - RecommendFeatureBuild reads a tenant's window of content_events for
	//     the user snapshot on it. The item snapshot is read from
	//     content_daily_stats, a row per title and day, on DB.
	//
	// Every other read stays on DB. EpisodeReadProjection reads which reads
	// it has not projected yet in order to write them, and a purge deletes
	// what it reads: the read is the write's own condition, and splitting the
	// two across servers would let another write land between them.
	// RankingAggregation reads content_daily_stats alone. The progress the
	// chain records, the locks a rebuild takes, and the rows it writes are the
	// primary's by nature, since a standby refuses every write.
	// SearchIndexBuild reads the catalog rather than content_events, and
	// counts on the order of the catalog_index_sync events the worker drains
	// from the primary for every write made after its read.
	//
	// A rebuild reads on Replica only once Replica has replayed everything the
	// primary had committed when that tenant's rebuild began, waiting up to
	// replicaCatchUpWait for it, and on DB when it has not.
	Replica *sql.DB
	// Storage resolves the bucket OrphanImagePurge reclaims, and is the one
	// dependency no other job takes.
	Storage storage.ReclaimerSource
	// Secrets decrypts the store credentials GooglePlayVoidedPurchaseSync
	// calls Google Play with, and the credentials PaymentReconciliation reads
	// each source with. GooglePlay is the API both call.
	Secrets    paymentsettings.SecretManager
	GooglePlay GooglePlayReader
	// Payments, AppStore, and AppStoreVerifier are the rest of what
	// PaymentReconciliation reads: the web payment providers, and the App
	// Store's transaction histories.
	Payments         *paymentprovider.Registry
	AppStore         paymentreconciliation.AppStoreHistory
	AppStoreVerifier paymentreconciliation.TransactionVerifier
	Logger           *slog.Logger
}

// replicaCatchUpWait is how long a tenant's rebuild waits for Replica to
// replay up to the primary's position before reading on DB instead. It is far
// above a request's [readreplica.CatchUpWait]: nobody waits on a rebuild, and
// the reads of a tenant large enough to want a replica run for longer than
// this, so a few seconds spent here keep them off the primary. A replica still
// behind after them is lagging, not catching up.
const replicaCatchUpWait = 5 * time.Second

// errNoDB is what a caller that passed no pool gets, rather than the nil
// dereference the first query would be.
var errNoDB = errors.New("maintenance: db is nil")

// errNoStorage and errNoGooglePlay are the same for the jobs that reach past
// the database.
var (
	errNoStorage    = errors.New("maintenance: storage is nil")
	errNoGooglePlay = errors.New("maintenance: google play client is nil")
)

// pools is DB and Replica as the rebuilds that read on Replica take them.
func (d Deps) pools() readreplica.Pools {
	return readreplica.Pools{Primary: d.DB, Replica: d.Replica, Logger: d.logger(), Wait: replicaCatchUpWait}
}

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}
