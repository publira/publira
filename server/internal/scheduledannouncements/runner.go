// Package scheduledannouncements delivers the announcements the console
// scheduled for a later time once that time has passed.
//
// Delivering one is what the console does in the request when an announcement
// goes out at once: it records the announcement as delivered, which is what
// every public read waits for, and queues the event the worker fans out to its
// readers. The runner hands each due announcement to the outbox and delivers
// nothing itself. Setting delivered_at is what makes an announcement stop being
// due, so a worker that was down over the time delivers it on its next pass.
package scheduledannouncements

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pinnedannouncements"
	"github.com/publira/publira/server/internal/revalidate"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/scheduledannouncements")

// Recorder records Next.js cache tags as owed, on the querier of the
// transaction that delivers the announcement. *revalidate.Requester satisfies
// it, and a nil requester of that type records nothing, so a deployment with
// revalidation turned off still delivers what is due. The job runs inside the
// worker, so the record is all it does: the drain that sends it is seconds
// away.
type Recorder interface {
	Record(ctx context.Context, q revalidate.OutboxQuerier, tenantID uuid.UUID, tags []string) (revalidate.Owed, error)
}

// Runner delivers every scheduled announcement whose time has passed.
type Runner struct {
	// db must bypass RLS: the listing spans every tenant, and each delivery is
	// a transaction of its own on it.
	db     *sql.DB
	reval  Recorder
	logger *slog.Logger
}

// New constructs a runner over db. reval may be nil.
func New(db *sql.DB, reval Recorder, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{db: db, reval: reval, logger: logger}
}

// RevalidateTags names what a tenant's site caches an announcement under once
// it is delivered: the readers' announcement inboxes, and the banner when it
// is pinned.
func RevalidateTags(tenantID uuid.UUID, pinned bool) []string {
	tags := []string{fmt.Sprintf("tenant:%s:announcements", tenantID.String())}
	if pinned {
		tags = append(tags, pinnedannouncements.RevalidateTags(tenantID)...)
	}
	return tags
}

// RunOnce delivers every announcement that is due, one at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "scheduledannouncements.RunOnce")
	defer span.End()

	rows, err := dbmodels.New(r.db).ListAnnouncementsDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list announcements due", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.scheduled_announcements.due", len(rows)))
	r.logger.InfoContext(ctx, "found scheduled announcements to deliver", "count", len(rows))

	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		delivered, err := r.deliver(ctx, row.ID)
		if err != nil {
			// Left undelivered, so the next pass tries it again.
			r.logger.ErrorContext(ctx, "failed to deliver a scheduled announcement",
				"tenant_id", row.TenantID.String(),
				"announcement_id", row.ID.String(),
				"error", err,
			)
			continue
		}
		if !delivered {
			continue
		}
		r.logger.InfoContext(ctx, "delivered a scheduled announcement",
			"tenant_id", row.TenantID.String(),
			"announcement_id", row.ID.String(),
		)
	}
}

// deliver marks one announcement delivered, queues its event, and records the
// drops it owes, in one transaction, so none of the three outlives the others.
// It reports false for an announcement the console deleted or delivered after
// the listing: the mark waits on the console's lock and then finds nothing to
// deliver.
func (r *Runner) deliver(ctx context.Context, announcementID uuid.UUID) (bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	row, err := txq.MarkAnnouncementDelivered(ctx, announcementID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("mark announcement delivered: %w", err)
	}
	if err := outbox.QueueAnnouncementNotification(ctx, txq, row.TenantID, row.ID, row.Audience != nil); err != nil {
		return false, err
	}
	if r.reval != nil {
		if _, err := r.reval.Record(ctx, txq, row.TenantID, RevalidateTags(row.TenantID, row.Pinned)); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
