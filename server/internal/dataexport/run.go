// Package dataexport builds a reader's archive of what the install keeps about
// them, keeps it in the bucket for Retention, and deletes it afterwards or
// with the account. The public API records the request and streams the
// archive back; the worker's maintenance jobs build it and purge it.
package dataexport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/storage"
)

// Retention is how long an archive is kept once it is ready, and the record
// of a request that failed once it failed.
const Retention = 7 * 24 * time.Hour

// StaleClaim is how old a claim grows before another worker takes the
// request over from the one that made it, which died mid-build. It is far
// above how long one build takes, so a slow build is not built twice.
const StaleClaim = 15 * time.Minute

// ContentType is what an archive is stored and served as.
const ContentType = "application/zip"

// ObjectKey is where one request's archive is stored. It sits under the
// tenant's prefix, which the orphan sweep walks, so an archive whose row was
// never written, as one a build stored and then could not record is, is
// deleted by the sweep a day later.
func ObjectKey(tenantPublicID string, id uuid.UUID) string {
	return "tenants/" + tenantPublicID + "/data-exports/" + id.String() + ".zip"
}

// Deps is what a pass runs on.
type Deps struct {
	// DB is the maintenance role's pool, which reads every tenant's rows.
	DB *sql.DB
	// Storage stores an archive and deletes one, from the bucket the platform
	// names when the pass runs.
	Storage storage.Provider
	// Reclaimers resolves the bucket a purge deletes from, and an archive no
	// row can name once it is stored.
	Reclaimers storage.ReclaimerSource
	Logger     *slog.Logger
	// Now is the clock, and time.Now when nil.
	Now func() time.Time
}

func (d Deps) now() time.Time {
	if d.Now == nil {
		return time.Now()
	}
	return d.Now()
}

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}

// Summary is what RunPending did.
type Summary struct {
	Built  int
	Failed int
}

// RunPending builds every request waiting, oldest first, until none is left.
// A request is failed rather than retried only when the platform has no
// object store to keep it in, which the reader can ask again once it does.
// Any other failure leaves the claim to grow stale, so a later pass takes the
// request up again, and ends the pass.
func RunPending(ctx context.Context, deps Deps) (Summary, error) {
	var summary Summary
	if deps.DB == nil {
		return summary, errors.New("dataexport: db is nil")
	}
	// Under row-level security every tenant's requests would read as none,
	// and the pass would succeed having built nothing.
	if err := dbroles.RequireEveryTenant(ctx, deps.DB, "data export build"); err != nil {
		return summary, err
	}
	queries := dbmodels.New(deps.DB)
	for {
		now := deps.now()
		request, err := queries.ClaimUserDataExport(ctx, dbmodels.ClaimUserDataExportParams{
			ClaimedAt:   sql.NullTime{Time: now, Valid: true},
			StaleBefore: now.Add(-StaleClaim),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return summary, nil
		}
		if err != nil {
			return summary, fmt.Errorf("claim a data export: %w", err)
		}
		built, err := buildOne(ctx, deps, queries, request)
		if err != nil {
			return summary, err
		}
		if built {
			summary.Built++
		} else {
			summary.Failed++
		}
	}
}

// buildOne builds one claimed request, stores it, and records it with the
// notification it owes, or records that it failed. It answers whether it was
// built.
func buildOne(ctx context.Context, deps Deps, queries *dbmodels.Queries, request dbmodels.UserDataExport) (bool, error) {
	logger := deps.logger().With("tenant_id", request.TenantID, "data_export_id", request.ID)
	tenant, err := queries.GetTenantByID(ctx, request.TenantID)
	if err != nil {
		return false, fmt.Errorf("read the tenant of data export %s: %w", request.ID, err)
	}
	userID := request.UserID.UUID

	store, err := storage.Pin(ctx, deps.Storage)
	if errors.Is(err, storage.ErrNotConfigured) || (err == nil && store == nil) {
		logger.WarnContext(ctx, "data export failed: no object store is configured")
		return false, fail(ctx, deps, queries, request)
	}
	if err != nil {
		return false, fmt.Errorf("resolve the object store: %w", err)
	}

	loc, err := archiveLocale(ctx, queries, tenant, userID)
	if err != nil {
		return false, err
	}
	archive, err := Build(ctx, queries, request.TenantID, userID, loc)
	if errors.Is(err, ErrAccountNotFound) {
		// The account went between the claim and the read. The purge takes
		// the request once the foreign key has let go of it.
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("build data export %s: %w", request.ID, err)
	}

	key := ObjectKey(tenant.PublicID, request.ID)
	if _, err := store.Upload(ctx, storage.UploadRequest{ObjectKey: key, ContentType: ContentType, Data: archive}); err != nil {
		return false, fmt.Errorf("store data export %s: %w", request.ID, err)
	}

	readyAt := deps.now()
	expiresAt := readyAt.Add(Retention)
	recorded, err := record(ctx, deps.DB, request, key, int64(len(archive)), readyAt, expiresAt)
	if err != nil {
		return false, err
	}
	if !recorded {
		// The account was deleted, or another worker took the request over,
		// while this one built it: no row will name the archive.
		logger.InfoContext(ctx, "data export built for a request no longer this pass's")
		deleteUnrecorded(ctx, deps, logger, key)
		return false, nil
	}
	logger.InfoContext(ctx, "data export built", "size_bytes", len(archive))
	return true, nil
}

// archiveLocale is the language the archive's titles are written in: the one
// the reader last read in, else the tenant's own.
func archiveLocale(ctx context.Context, queries *dbmodels.Queries, tenant dbmodels.Tenant, userID uuid.UUID) (string, error) {
	user, err := queries.GetUserForDataExport(ctx, dbmodels.GetUserForDataExportParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		UserID:   userID,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("read the locale of the account: %w", err)
	}
	if user.LastLocale.Valid {
		if resolved, err := locale.Resolve(user.LastLocale.String); err == nil {
			return resolved, nil
		}
	}
	resolved, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return "", fmt.Errorf("resolve the default locale of tenant %s: %w", tenant.ID, err)
	}
	return resolved, nil
}

// record marks the request ready and queues its notification, in one
// transaction, so a reader is told of an archive exactly when there is one.
func record(ctx context.Context, db *sql.DB, request dbmodels.UserDataExport, key string, size int64, readyAt, expiresAt time.Time) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin recording data export %s: %w", request.ID, err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	ready, err := queries.MarkUserDataExportReady(ctx, dbmodels.MarkUserDataExportReadyParams{
		ReadyAt:   sql.NullTime{Time: readyAt, Valid: true},
		ExpiresAt: sql.NullTime{Time: expiresAt, Valid: true},
		ObjectKey: sql.NullString{String: key, Valid: true},
		SizeBytes: sql.NullInt64{Int64: size, Valid: true},
		TenantID:  request.TenantID,
		ID:        request.ID,
		ClaimedAt: request.ClaimedAt,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("record data export %s: %w", request.ID, err)
	}
	if err := outbox.QueueDataExportReadyNotification(ctx, queries, outbox.DataExportReadyNotification{
		TenantID:     ready.TenantID,
		UserID:       ready.UserID.UUID,
		DataExportID: ready.ID,
		ExpiresAt:    expiresAt,
	}); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit data export %s: %w", request.ID, err)
	}
	return true, nil
}

// fail records that the request cannot be built, under the claim that tried.
func fail(ctx context.Context, deps Deps, queries *dbmodels.Queries, request dbmodels.UserDataExport) error {
	failedAt := deps.now()
	if _, err := queries.FailUserDataExport(ctx, dbmodels.FailUserDataExportParams{
		FailedAt:  sql.NullTime{Time: failedAt, Valid: true},
		ExpiresAt: sql.NullTime{Time: failedAt.Add(Retention), Valid: true},
		TenantID:  request.TenantID,
		ID:        request.ID,
		ClaimedAt: request.ClaimedAt,
	}); err != nil {
		return fmt.Errorf("record a failed data export %s: %w", request.ID, err)
	}
	return nil
}

// deleteUnrecorded removes an archive no row names. A delete that fails is
// left to the orphan sweep, which reaches every object under the tenant's
// prefix that no row names.
func deleteUnrecorded(ctx context.Context, deps Deps, logger *slog.Logger, key string) {
	if deps.Reclaimers == nil {
		return
	}
	reclaimer, _, err := deps.Reclaimers.Reclaimer(ctx)
	if err == nil {
		err = reclaimer.Delete(ctx, []string{key})
	}
	if err != nil {
		logger.WarnContext(ctx, "could not delete an unrecorded data export; the orphan sweep will", "object_key", key, "error", err)
	}
}
