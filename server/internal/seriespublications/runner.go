// Package seriespublications applies the publication of scheduled series to
// what holds a copy of the catalog, and to the episodes published while the
// series was not public.
//
// A series saved with a publication instant in the future needs nothing in the
// database to change for the series itself when that instant passes: the
// catalog reads compare it against NOW(), so the API lists the series from
// that moment. What does not change on its own is what was copied out of it —
// a series list, a creator's page, or the series' own page cached while the
// series was still hidden keeps leaving it out until something drops the tags
// they are cached under.
//
// Nor does an episode published while the series was hidden: it still carries
// the date of a publication no reader could open, and its followers were not
// told about it then. The runner dates it from the series' instant and queues
// its announcement, the way the console does when it publishes a series at
// once, before it asks for the drop that carries the new dates to the site.
// It also owes the tenant's webhooks an episode.published for each episode
// published in the series, which a receiver that took them down when the
// series was hidden reads as their return. Each publication is recorded as
// applied once all of it is done, so a run that was down over one still
// catches up on its next pass.
//
// The search index needs no pass for the series: its document carries its
// published_at, and the search filters on it at the moment it is asked. The
// latest episode a document carries is another matter, so the runner queues
// the series' sync for the new dates.
package seriespublications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/publira/publira/server/internal/catalogindex"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/seriespublications")

// Queries is the part of the generated querier this runner uses. The
// connection behind it must bypass RLS: the listing spans every tenant.
type Queries interface {
	outbox.SeriesPublicationQuerier
	ListSeriesPublicationsDue(ctx context.Context) ([]dbmodels.ListSeriesPublicationsDueRow, error)
	MarkSeriesPublicationRevalidated(ctx context.Context, id uuid.UUID) error
}

// WebhookQueries is what the transaction that owes a publication's webhooks
// runs.
type WebhookQueries interface {
	tenantwebhooks.Queries
	LockSeriesPublicationDue(ctx context.Context, arg dbmodels.LockSeriesPublicationDueParams) (uuid.UUID, error)
}

// inTx runs fn in a transaction of its own, over the querier of that
// transaction, and commits it when fn succeeds.
type inTx func(ctx context.Context, fn func(WebhookQueries) error) error

// Revalidator records Next.js cache tags as owed. *revalidate.Requester
// satisfies it, and a nil requester of that type is a no-op, so a deployment
// with revalidation turned off still records the publications it passed
// instead of collecting them.
type Revalidator interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// Runner applies every series publication whose instant has passed.
type Runner struct {
	queries Queries
	inTx    inTx
	reval   Revalidator
	logger  *slog.Logger
}

// New constructs a runner over db, and over queries, the querier of db. reval
// may be nil.
func New(db *sql.DB, queries *dbmodels.Queries, reval Revalidator, logger *slog.Logger) *Runner {
	return newRunner(queries, func(ctx context.Context, fn func(WebhookQueries) error) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin transaction: %w", err)
		}
		defer tx.Rollback() //nolint:errcheck
		if err := fn(queries.WithTx(tx)); err != nil {
			return err
		}
		return tx.Commit()
	}, reval, logger)
}

func newRunner(queries Queries, inTx inTx, reval Revalidator, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{queries: queries, inTx: inTx, reval: reval, logger: logger}
}

// RevalidateTags names what a tenant's public site caches the answers a series
// publication changes under. Every cached series list — the top page's modules,
// the series list, a label's, a genre's and a tag's, the search, and the
// sitemap — carries the series list tag; every creator page carries the
// creators tag; and the series' own page, held while the series was not found,
// carries both the series detail tag and the series' own.
func RevalidateTags(tenantID uuid.UUID, seriesPublicIDs ...string) []string {
	tags := []string{
		fmt.Sprintf("tenant:%s:series:list", tenantID.String()),
		fmt.Sprintf("tenant:%s:series:detail", tenantID.String()),
		fmt.Sprintf("tenant:%s:creators", tenantID.String()),
	}
	for _, publicID := range seriesPublicIDs {
		tags = append(tags, fmt.Sprintf("tenant:%s:series:%s", tenantID.String(), publicID))
	}
	return tags
}

// RunOnce applies every publication that has passed, one tenant at a time.
//
// The cycle runs under one span so the queries it issues hang off a single
// trace instead of arriving as one root span per statement.
func (r *Runner) RunOnce(ctx context.Context) {
	ctx, span := tracer.Start(ctx, "seriespublications.RunOnce")
	defer span.End()

	rows, err := r.queries.ListSeriesPublicationsDue(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to list due series publications", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	span.SetAttributes(attribute.Int("publira.series_publications.due", len(rows)))
	r.logger.InfoContext(ctx, "found series publications to apply", "count", len(rows))

	byTenant := make(map[uuid.UUID][]dbmodels.ListSeriesPublicationsDueRow)
	tenants := make([]uuid.UUID, 0)
	for _, row := range rows {
		if _, seen := byTenant[row.TenantID]; !seen {
			tenants = append(tenants, row.TenantID)
		}
		byTenant[row.TenantID] = append(byTenant[row.TenantID], row)
	}

	for _, tenantID := range tenants {
		if ctx.Err() != nil {
			return
		}
		r.applyTenant(ctx, tenantID, byTenant[tenantID])
	}
}

// applyTenant announces the episodes each publication owes, records one
// tenant's drop, and then marks the publications it answers for. The order
// matters: a publication marked before its drop is owed would never be
// retried, and the site would keep leaving the series out; a drop recorded
// before the new dates are written could be sent while the old ones still
// stand.
func (r *Runner) applyTenant(ctx context.Context, tenantID uuid.UUID, rows []dbmodels.ListSeriesPublicationsDueRow) {
	announced := make([]dbmodels.ListSeriesPublicationsDueRow, 0, len(rows))
	for _, row := range rows {
		if err := r.announceEpisodes(ctx, tenantID, row); err != nil {
			// Left unmarked, so the next pass dates and queues what this one
			// could not.
			r.logger.ErrorContext(ctx, "failed to announce the episodes of a series publication",
				"tenant_id", tenantID.String(),
				"series_id", row.PublicID,
				"error", err,
			)
			continue
		}
		announced = append(announced, row)
	}
	rows = announced
	if len(rows) == 0 {
		return
	}

	if r.reval != nil {
		publicIDs := make([]string, 0, len(rows))
		for _, row := range rows {
			publicIDs = append(publicIDs, row.PublicID)
		}
		if err := r.reval.RevalidateTags(ctx, tenantID, RevalidateTags(tenantID, publicIDs...)); err != nil {
			r.logger.WarnContext(ctx, "failed to record a revalidation after a series publication",
				"tenant_id", tenantID.String(),
				"series", len(rows),
				"error", err,
			)
			return
		}
	}

	for _, row := range rows {
		if err := r.queries.MarkSeriesPublicationRevalidated(ctx, row.ID); err != nil {
			r.logger.ErrorContext(ctx, "failed to mark series publication applied",
				"tenant_id", tenantID.String(),
				"series_id", row.PublicID,
				"error", err,
			)
			continue
		}
		r.logger.InfoContext(ctx, "applied series publication",
			"tenant_id", tenantID.String(),
			"series_id", row.PublicID,
			"series_title", row.Title,
		)
	}
}

// announceEpisodes dates the episodes published while the series was not
// public from its instant and queues their announcements, then the webhooks of
// every episode published in it and the sync of the series' search document,
// both of which read the new dates. The sync is queued every time rather than
// only when an episode was dated: a pass that fails between the two leaves
// nothing for its retry to date once the announcements have drained, and the
// sync it owed would be lost with them.
//
// The webhooks are owed in a transaction that holds the series row and finds
// the publication still due, so a save that hides or reschedules the series
// after the listing read it is not followed by events announcing a return
// that did not happen. They name the publication by its instant, which a
// repeated pass reads the same, so it owes nothing twice. The instant names it
// apart from any other the job applies too: the job applies only an instant
// that was still ahead when it was saved, and a series given the same instant
// again once it has passed is made public by that save instead.
func (r *Runner) announceEpisodes(ctx context.Context, tenantID uuid.UUID, row dbmodels.ListSeriesPublicationsDueRow) error {
	if _, err := outbox.QueueSeriesPublicationAnnouncements(ctx, r.queries, tenantID, row.ID); err != nil {
		return err
	}
	if err := r.inTx(ctx, func(q WebhookQueries) error {
		if _, err := q.LockSeriesPublicationDue(ctx, dbmodels.LockSeriesPublicationDueParams{TenantID: tenantID, ID: row.ID, PublishedAt: row.PublishedAt.Time}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("lock the series publication: %w", err)
		}
		return tenantwebhooks.QueueSeriesPublished(ctx, q, tenantID, row.ID, row.PublishedAt.Time)
	}); err != nil {
		return err
	}
	if err := catalogindex.Queue(ctx, r.queries, tenantID, catalogindex.SeriesRef(row.ID)); err != nil {
		return err
	}
	return nil
}
