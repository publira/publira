package platformsearch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// ErrNoIndex is a rebuild asked of the SQL engine, which keeps no index.
var ErrNoIndex = errors.New("the saved search engine is sql, which keeps no index to build")

// ErrBuildRunning is a build asked for while another holds the lock.
var ErrBuildRunning = errors.New("another build of the catalog index is running")

// buildLockKey names the session advisory lock one build holds, so the
// worker's pass and a publiractl rebuild never fill and swap the same alias at
// once.
const buildLockKey = "platform_search_build"

// maxBuildError bounds the error a failed build records.
const maxBuildError = 2000

// BuildParams is one build.
type BuildParams struct {
	// DB is the maintenance role's pool: it reads every tenant's catalog and
	// moves the serving configuration once the build completes.
	DB      *sql.DB
	Secrets Decrypter
	Logger  *slog.Logger
	// Force rebuilds the index of the saved configuration even when the search
	// already answers from it, for an index definition that changed or an
	// index that was lost. Without it a build is made only while one is due.
	Force bool
}

// BuildResult is what a build did.
type BuildResult struct {
	// Built is false when there was nothing to build.
	Built bool
	// Index is the index the alias names once the build is done.
	Index string
	// Alias is the alias it was built behind.
	Alias string
	// Serving reports whether the search moved onto the build, which it does
	// unless a save moved the revision on while it ran.
	Serving bool
}

// Build builds the index the saved configuration names from the database and
// moves the search onto it once the index holds the catalog. A failure is
// recorded on the row, where the platform API reports it, and leaves the
// search answering from where it was.
func Build(ctx context.Context, p BuildParams) (BuildResult, error) {
	logger := p.Logger
	if logger == nil {
		logger = slog.Default()
	}
	q := dbmodels.New(p.DB)
	row, found, err := Get(ctx, q)
	if err != nil {
		return BuildResult{}, err
	}
	stored := Unsaved()
	if found {
		stored = FromConfig(row)
	}
	if !stored.Engine.HasIndex() {
		if p.Force {
			return BuildResult{}, ErrNoIndex
		}
		return BuildResult{}, nil
	}
	if !p.Force && stored.State == Serving {
		return BuildResult{}, nil
	}

	unlock, err := lockBuild(ctx, p.DB)
	if err != nil {
		return BuildResult{}, err
	}
	defer unlock()

	backend, index, err := build(ctx, p, row, logger)
	if err != nil {
		recordCtx := context.WithoutCancel(ctx)
		if _, recordErr := q.RecordPlatformSearchBuildFailure(recordCtx, dbmodels.RecordPlatformSearchBuildFailureParams{
			BuildError: truncate(err.Error()),
			Revision:   row.Revision,
		}); recordErr != nil {
			return BuildResult{}, errors.Join(err, fmt.Errorf("record the failed build: %w", recordErr))
		}
		return BuildResult{}, err
	}
	result := BuildResult{Built: true, Index: index, Alias: row.IndexAlias.String}
	_, err = q.ServePlatformSearchConfig(ctx, row.Revision)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// A save moved the revision on while this ran. Its own build comes
		// next, and the search stays where it was until then.
		logger.InfoContext(ctx, "catalog index built for a revision saved over since", "revision", row.Revision)
		return result, nil
	case err != nil:
		return BuildResult{}, fmt.Errorf("move the search onto revision %d: %w", row.Revision, err)
	}
	result.Serving = true
	logger.InfoContext(ctx, "catalog search moved onto the built index", "revision", row.Revision, "engine", row.Engine, "index", index)

	// Every tenant is written once more now that the search answers from the
	// new index. The worker writes into an index being built only while its
	// build is due, and a build retried after a failure is not: an event drained
	// between a tenant's resync after the swap and the move above reached the
	// previous engine alone. From the move on, every event reads the row and
	// writes here, and any write that committed before it is read again below.
	if err := resync(ctx, p.DB, backend); err != nil {
		return result, fmt.Errorf("the search moved onto %s, but writing every tenant again failed, which may leave a write made during the build out of it; run publiractl search reindex: %w", index, err)
	}
	return result, nil
}

func resync(ctx context.Context, db *sql.DB, backend *opensearchbackend.Backend) error {
	tenantIDs, err := dbmodels.New(db).ListCatalogIndexTenantIDs(ctx)
	if err != nil {
		return fmt.Errorf("list tenants: %w", err)
	}
	for _, tenantID := range tenantIDs {
		if _, _, err := catalogindex.SyncTenant(ctx, db, backend, tenantID); err != nil {
			return fmt.Errorf("sync tenant %s: %w", tenantID, err)
		}
	}
	return nil
}

func build(ctx context.Context, p BuildParams, row dbmodels.PlatformSearchConfig, logger *slog.Logger) (*opensearchbackend.Backend, string, error) {
	stored := FromConfig(row)
	cfg := opensearchbackend.Config{URL: stored.URL, Index: stored.Index, Username: stored.Username}
	if encrypted := strings.TrimSpace(row.PasswordEncrypted.String); encrypted != "" {
		if p.Secrets == nil {
			return nil, "", ErrSecretManagerUnavailable
		}
		password, err := p.Secrets.DecryptString(encrypted)
		if err != nil {
			return nil, "", fmt.Errorf("decrypt the search engine password: %w", err)
		}
		cfg.Password = password
	}
	connectCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	backend, err := opensearchbackend.New(connectCtx, cfg)
	cancel()
	if err != nil {
		return nil, "", err
	}
	logger.InfoContext(ctx, "catalog index build started", "revision", row.Revision, "engine", row.Engine, "alias", cfg.Index)
	index, err := catalogindex.Rebuild(ctx, p.DB, backend, logger)
	return backend, index, err
}

// lockBuild takes the build lock on a connection of its own, which holds it
// until the returned function releases it.
func lockBuild(ctx context.Context, db *sql.DB) (func(), error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsearch: connect for the build lock: %w", err)
	}
	var locked bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1, 0))", buildLockKey).Scan(&locked); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("platformsearch: take the build lock: %w", err)
	}
	if !locked {
		_ = conn.Close()
		return nil, ErrBuildRunning
	}
	return func() {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(hashtextextended($1, 0))", buildLockKey)
		_ = conn.Close()
	}, nil
}

func truncate(message string) string {
	if len(message) <= maxBuildError {
		return message
	}
	cut := maxBuildError
	for cut > 0 && !utf8.RuneStart(message[cut]) {
		cut--
	}
	return message[:cut] + "…"
}
