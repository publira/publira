// Package tenanterasure erases the tenants an operator asked to delete: every
// row a tenant holds, its objects in the bucket, its documents in the search
// engine's index, and its entries in the shared cache, and then the tenant row
// itself.
//
// Each step deletes whatever of the tenant is still there, so a pass that a
// crash, a timeout, or a failing service cut short is finished by a later one,
// which starts again from the first step and finds less to do. The tenant row
// goes last: it is what the next pass finds the tenant by, what names the
// tenant's prefix in the bucket, and what keeps every surface refusing the
// tenant's hosts until nothing of it is left to serve.
package tenanterasure

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/storage"
)

// DefaultBatchSize is how many rows one delete statement removes, which keeps
// each statement's locks and its write to the WAL short on a database that is
// serving every other tenant meanwhile.
const DefaultBatchSize = 1000

// The platform notifications the erasure files for every operator.
const (
	// NotificationTypeTenantDeleted is a tenant erased in full.
	NotificationTypeTenantDeleted = "tenant_deleted"
	// NotificationTypeTenantDeletionFailed is a pass that stopped on an
	// error. It is filed once per tenant, however many passes fail, and the
	// erasure is tried again on every later pass.
	NotificationTypeTenantDeletionFailed = "tenant_deletion_failed"
)

// passLockKey names the session advisory lock one pass holds, so the worker's
// pass and a publiractl run never erase the same tenant at once.
const passLockKey = "tenant_erasure"

// SearchEraser deletes a tenant's documents from the search engine's index.
type SearchEraser interface {
	EraseTenant(ctx context.Context, tenantID uuid.UUID) error
}

// CacheEraser deletes a tenant's entries from the cache the API processes
// share, answering how many it deleted.
type CacheEraser interface {
	EraseTenant(ctx context.Context, tenant dbmodels.Tenant) (int, error)
}

// Deps is what a pass runs on.
type Deps struct {
	// DB is the maintenance role's pool, which reaches every tenant's rows.
	DB *sql.DB
	// Images and Archives resolve the bucket the tenant's images and its
	// readers' archives are deleted from: the same bucket, held apart the
	// way the jobs that keep each are.
	Images   storage.ReclaimerSource
	Archives storage.ReclaimerSource
	// Search deletes the tenant's documents, nil for none to delete.
	Search SearchEraser
	// Cache deletes the tenant's shared cache entries, nil for an install
	// whose processes share none.
	Cache  CacheEraser
	Logger *slog.Logger
	// BatchSize is DefaultBatchSize when zero.
	BatchSize int
}

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}

func (d Deps) batchSize() int {
	if d.BatchSize <= 0 {
		return DefaultBatchSize
	}
	return d.BatchSize
}

// Summary is what a pass did.
type Summary struct {
	// Erased counts the tenants deleted in full, Failed those a step failed
	// for, and Deferred those left while a build of the search index runs,
	// all of which the next pass takes up again.
	Erased, Failed, Deferred int
	// Skipped reports a pass that found another holding the lock.
	Skipped bool
}

// RunPending erases every tenant marked for deletion, the longest waiting
// first. A tenant whose erasure fails is logged, told to the operators, and
// left marked for the next pass, and the others are erased all the same; the
// returned error joins every failure. A tenant whose index documents wait on a
// build is left marked as well, without a failure.
func RunPending(ctx context.Context, deps Deps) (Summary, error) {
	if deps.DB == nil {
		return Summary{}, errors.New("tenanterasure: db is nil")
	}
	if err := dbroles.RequireEveryTenant(ctx, deps.DB, "tenant erasure"); err != nil {
		return Summary{}, err
	}
	logger := deps.logger()
	tenants, err := dbmodels.New(deps.DB).ListTenantsMarkedForDeletion(ctx)
	if err != nil {
		return Summary{}, fmt.Errorf("list the tenants marked for deletion: %w", err)
	}
	if len(tenants) == 0 {
		return Summary{}, nil
	}

	unlock, locked, err := lockPass(ctx, deps.DB)
	if err != nil {
		return Summary{}, err
	}
	if !locked {
		logger.InfoContext(ctx, "tenant erasure skipped; another pass is running")
		return Summary{Skipped: true}, nil
	}
	defer unlock()
	tables, err := listTables(ctx, deps.DB)
	if err != nil {
		return Summary{}, err
	}

	var (
		summary Summary
		errs    []error
	)
	for _, tenant := range tenants {
		tenantLogger := logger.With("tenant_id", tenant.ID.String(), "tenant_public_id", tenant.PublicID)
		err := erase(ctx, deps, tenantLogger, tables, tenant)
		if err == nil {
			summary.Erased++
			tenantLogger.InfoContext(ctx, "tenant erased")
			continue
		}
		if ctx.Err() != nil {
			return summary, errors.Join(append(errs, err)...)
		}
		if errors.Is(err, platformsearch.ErrBuildRunning) {
			// Not a failure: the build holds the index the documents are
			// deleted from, and the next pass after it finds the lock free.
			summary.Deferred++
			tenantLogger.InfoContext(ctx, "tenant erasure deferred until the catalog index build completes")
			continue
		}
		summary.Failed++
		tenantLogger.ErrorContext(ctx, "tenant erasure failed", "error", err)
		notifyOperators(ctx, dbmodels.New(deps.DB), tenantLogger, NotificationTypeTenantDeletionFailed, tenant, notificationPayload{
			TenantID:   tenant.PublicID,
			TenantName: tenant.Name,
		})
		errs = append(errs, fmt.Errorf("tenant %s: %w", tenant.PublicID, err))
	}
	return summary, errors.Join(errs...)
}

// erase runs every step for one tenant, the tenant row last.
//
// The cache goes first: nothing writes to it for a suspended tenant, and its
// keys are found by the tenant's IDs alone. The rows follow, and the objects
// and the index documents after them, because the rows are what the worker
// writes both from: an archive a reader asked for, an index update a catalog
// change queued. Deleted first, those would be written again from rows still
// there.
func erase(ctx context.Context, deps Deps, logger *slog.Logger, tables []table, tenant dbmodels.Tenant) error {
	if deps.Cache != nil {
		n, err := deps.Cache.EraseTenant(ctx, tenant)
		if err != nil {
			return fmt.Errorf("erase the cache entries: %w", err)
		}
		if n > 0 {
			logger.InfoContext(ctx, "tenant cache entries erased", "entries", n)
		}
	}
	if err := eraseRows(ctx, deps.DB, logger, tables, tenant.ID, deps.batchSize()); err != nil {
		return err
	}
	if err := eraseObjects(ctx, deps.Images, logger, imagePrefix(tenant.PublicID)); err != nil {
		return err
	}
	if err := eraseObjects(ctx, deps.Archives, logger, archivePrefix(tenant.PublicID)); err != nil {
		return err
	}
	if deps.Search != nil {
		if err := deps.Search.EraseTenant(ctx, tenant.ID); err != nil {
			return fmt.Errorf("erase the search index documents: %w", err)
		}
	}
	return finish(ctx, deps.DB, logger, tenant)
}

// finish deletes the tenant row, files the entry of the deletion under the
// operator who asked for it, and tells every operator, in one transaction. A
// row another pass deleted first is left to that pass's entry.
func finish(ctx context.Context, db *sql.DB, logger *slog.Logger, tenant dbmodels.Tenant) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin the tenant row's delete: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	q := dbmodels.New(tx)

	actor, err := requester(ctx, q, tenant.ID)
	if err != nil {
		return err
	}
	deleted, err := q.DeleteTenantMarkedForDeletion(ctx, tenant.ID)
	if err != nil {
		return fmt.Errorf("delete the tenant row: %w", err)
	}
	if deleted == 0 {
		return nil
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		TenantID:   tenant.ID,
		Action:     "tenant_deleted",
		TargetType: "tenant",
		TargetID:   tenant.ID.String(),
		Outcome:    auditlog.OutcomeSuccess,
		Tenant:     platformtenants.Snapshot(tenant),
	})); err != nil {
		return fmt.Errorf("audit tenant_deleted: %w", err)
	}
	// A deleted tenant has no page to link to, so the notification names it
	// by its name and its domain alone.
	if err := fileNotifications(ctx, q, NotificationTypeTenantDeleted, tenant, notificationPayload{
		TenantName:   tenant.Name,
		TenantDomain: tenant.Domain,
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit the tenant row's delete: %w", err)
	}
	return nil
}

// requester is the operator the entry of the request names, or the command
// line's actor when it names none: a request made with publiractl, or one
// whose entry the platform audit log no longer has.
func requester(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID) (auditlog.PlatformActor, error) {
	row, err := q.GetTenantDeletionRequester(ctx, tenantID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return auditlog.SystemPlatformActor, nil
	case err != nil:
		return auditlog.PlatformActor{}, fmt.Errorf("read who asked for the deletion: %w", err)
	case !row.ActorPlatformUserID.Valid:
		return auditlog.SystemPlatformActor, nil
	}
	return auditlog.PlatformActor{UserID: row.ActorPlatformUserID.UUID, Role: row.ActorRole}, nil
}

// notificationPayload is what the Platform Console's inbox renders a
// notification from.
type notificationPayload struct {
	// TenantID is the tenant's public ID, which the inbox links the row to the
	// tenant's page by. A deleted tenant leaves it out.
	TenantID     string `json:"tenant_id,omitempty"`
	TenantName   string `json:"tenant_name"`
	TenantDomain string `json:"tenant_domain,omitempty"`
}

// fileNotifications files a notification for every operator, one per tenant
// and type: a notification already filed is left as it is.
func fileNotifications(ctx context.Context, q *dbmodels.Queries, notificationType string, tenant dbmodels.Tenant, payload notificationPayload) error {
	operators, err := q.ListPlatformOperatorIDs(ctx)
	if err != nil {
		return fmt.Errorf("list the operators to notify: %w", err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode the notification: %w", err)
	}
	for _, operator := range operators {
		id, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("allocate a notification id: %w", err)
		}
		if _, err := q.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
			ID:               id,
			PlatformUserID:   operator,
			NotificationType: notificationType,
			SubjectKey:       "tenant:" + tenant.PublicID,
			Payload:          body,
		}); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("file the %s notification: %w", notificationType, err)
		}
	}
	return nil
}

// notifyOperators is fileNotifications for a failure, which has nothing left
// to roll back and is only logged when it cannot be filed.
func notifyOperators(ctx context.Context, q *dbmodels.Queries, logger *slog.Logger, notificationType string, tenant dbmodels.Tenant, payload notificationPayload) {
	if err := fileNotifications(context.WithoutCancel(ctx), q, notificationType, tenant, payload); err != nil {
		logger.ErrorContext(ctx, "failed to notify the operators", "notification_type", notificationType, "error", err)
	}
}

// lockPass takes passLockKey on a connection of its own, which holds it until
// the returned function releases it or the connection is gone. locked is false
// when another pass holds it.
func lockPass(ctx context.Context, db *sql.DB) (unlock func(), locked bool, err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("connect for the tenant erasure lock: %w", err)
	}
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1, 0))", passLockKey).Scan(&locked); err != nil {
		_ = conn.Close()
		return nil, false, fmt.Errorf("take the tenant erasure lock: %w", err)
	}
	if !locked {
		_ = conn.Close()
		return nil, false, nil
	}
	return func() {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(hashtextextended($1, 0))", passLockKey)
		_ = conn.Close()
	}, true, nil
}
