// Package catalogindex keeps the OpenSearch catalog index in step with the
// catalog. A write to a series, a creator, or a label, or to an episode or a
// free window of a series, queues a catalog_index_sync outbox event in its own
// transaction (Queue), and so does a ticker job whose boundary changes what a
// series is narrowed or sorted by: a free window opening or closing, and a
// scheduled episode being published. The worker rewrites the named row's
// document from the row (Syncer), and publiractl rebuilds the whole index, or
// one tenant's documents, from the database (Rebuild, SyncTenant).
//
// Every document is written with the instant its row was read at as its
// version, and the engine refuses a write below the version a document holds.
// Two events for one row may drain in either order, and a rebuild reads a
// tenant while its events keep draining, so without the version the read that
// lands last would win rather than the read that saw the most.
package catalogindex

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
)

// Ref names one catalog row whose document a write leaves stale.
type Ref struct {
	Kind opensearchbackend.Kind
	ID   uuid.UUID
}

func SeriesRef(id uuid.UUID) Ref  { return Ref{Kind: opensearchbackend.KindSeries, ID: id} }
func CreatorRef(id uuid.UUID) Ref { return Ref{Kind: opensearchbackend.KindCreator, ID: id} }
func LabelRef(id uuid.UUID) Ref   { return Ref{Kind: opensearchbackend.KindLabel, ID: id} }

// OutboxInserter is the statement Queue runs, on the querier of the write it
// answers for.
type OutboxInserter interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// Queue records one catalog_index_sync event per row refs name, once each.
//
// A write queues an event for every row whose document it may have changed,
// whether or not the row is searchable before or after: a series that is
// unpublished has a document to delete, and a creator taken off a series may
// have lost the last one that published it. Whether the row ends up with a
// document is the handler's to decide from the row.
func Queue(ctx context.Context, q OutboxInserter, tenantID uuid.UUID, refs ...Ref) error {
	queued := make(map[Ref]bool, len(refs))
	for _, ref := range refs {
		if queued[ref] || ref.ID == uuid.Nil {
			continue
		}
		queued[ref] = true
		payload, err := json.Marshal(outbox.CatalogIndexSyncPayload{
			TenantID: tenantID.String(),
			Kind:     string(ref.Kind),
			ID:       ref.ID.String(),
		})
		if err != nil {
			return fmt.Errorf("encode catalog index sync payload: %w", err)
		}
		eventID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generate outbox event id: %w", err)
		}
		_, err = q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
			ID:             eventID,
			TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
			EventType:      outbox.EventTypeCatalogIndexSync,
			Payload:        payload,
			IdempotencyKey: outbox.CatalogIndexSyncIdempotencyKey(eventID),
			AvailableAt:    time.Now().UTC(),
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("queue catalog index sync for %s %s: %w", ref.Kind, ref.ID, err)
		}
	}
	return nil
}

// Writer is where documents go: the live index behind the alias
// (*opensearchbackend.Backend), or a rebuild being filled
// (*opensearchbackend.Rebuild).
type Writer interface {
	PutAll(ctx context.Context, docs []opensearchbackend.Document) error
}

// Writers writes every document into each of its writers in turn, and fails
// with the first that fails. A write is versioned, so writing the same
// documents again after a failure leaves each writer as one write would.
type Writers []Writer

// PutAll implements Writer.
func (w Writers) PutAll(ctx context.Context, docs []opensearchbackend.Document) error {
	for _, writer := range w {
		if err := writer.PutAll(ctx, docs); err != nil {
			return err
		}
	}
	return nil
}

// Syncer rewrites the document of one row from the row, for the outbox
// handler. It reads on the worker's pool, whose role sees every tenant.
type Syncer struct {
	db    *sql.DB
	index Writer
}

var _ outbox.CatalogIndexer = (*Syncer)(nil)

func NewSyncer(db *sql.DB, index Writer) *Syncer {
	return &Syncer{db: db, index: index}
}

// Sync reads the row and writes its document, or a tombstone in its place when
// the row is gone or no longer published anywhere.
func (s *Syncer) Sync(ctx context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) error {
	ref := Ref{Kind: opensearchbackend.Kind(kind), ID: id}
	var docs []opensearchbackend.Document
	err := inSnapshot(ctx, s.db, func(q *dbmodels.Queries, version int64) error {
		var err error
		docs, err = readDocuments(ctx, q, tenantID, &ref, version)
		return err
	})
	if err != nil {
		return err
	}
	return s.index.PutAll(ctx, docs)
}

// errUnknownKind is a payload naming no kind of document. No retry can fix it.
var errUnknownKind = errors.New("catalogindex: unknown document kind")

// inSnapshot runs read on one REPEATABLE READ snapshot and hands it the version
// every document read from that snapshot is written with: the instant the
// transaction started, which precedes the snapshot. A write the snapshot misses
// commits after that instant, so the event it queued is read under a higher
// version and its document replaces this one.
func inSnapshot(ctx context.Context, db *sql.DB, read func(q *dbmodels.Queries, version int64) error) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return fmt.Errorf("catalogindex: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	q := dbmodels.New(tx)
	snapshotAt, err := q.GetCatalogIndexSnapshotTime(ctx)
	if err != nil {
		return fmt.Errorf("catalogindex: read the snapshot time: %w", err)
	}
	if err := read(q, snapshotAt.UnixMicro()); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("catalogindex: commit: %w", err)
	}
	return nil
}

// readDocuments reads the documents of a tenant's rows, or of the one row only
// names. A row published on no surface comes back with none, which the writer
// stores as a tombstone, and so does a row only names that no longer exists.
func readDocuments(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, only *Ref, version int64) ([]opensearchbackend.Document, error) {
	var docs []opensearchbackend.Document
	filter := func(kind opensearchbackend.Kind) (uuid.NullUUID, bool) {
		if only == nil {
			return uuid.NullUUID{}, true
		}
		return uuid.NullUUID{UUID: only.ID, Valid: true}, only.Kind == kind
	}

	if id, ok := filter(opensearchbackend.KindSeries); ok {
		rows, err := q.ListCatalogIndexSeries(ctx, dbmodels.ListCatalogIndexSeriesParams{TenantID: tenantID, SeriesID: id})
		if err != nil {
			return nil, fmt.Errorf("catalogindex: list series: %w", err)
		}
		for _, row := range rows {
			var latestEpisodeAt map[string]time.Time
			if err := json.Unmarshal(row.LatestEpisodeAtBySurface, &latestEpisodeAt); err != nil {
				return nil, fmt.Errorf("catalogindex: decode the latest episode instants of series %s: %w", row.ID, err)
			}
			docs = append(docs, opensearchbackend.Document{
				Kind: opensearchbackend.KindSeries, TenantID: tenantID, ID: row.ID, Version: version,
				Title: row.Title, Synopsis: row.Synopsis, Surfaces: row.Surfaces, PublishedAt: row.PublishedAt,
				GenrePublicIDs: row.GenrePublicIds, TagSlugs: row.TagSlugs, Status: row.Status,
				ScheduleWeekdays: row.ScheduleWeekdays, FreeEpisodeSurfaces: row.FreeEpisodeSurfaces,
				LatestEpisodeAt: latestEpisodeAt,
			})
		}
	}
	if id, ok := filter(opensearchbackend.KindCreator); ok {
		rows, err := q.ListCatalogIndexCreators(ctx, dbmodels.ListCatalogIndexCreatorsParams{TenantID: tenantID, CreatorID: id})
		if err != nil {
			return nil, fmt.Errorf("catalogindex: list creators: %w", err)
		}
		for _, row := range rows {
			docs = append(docs, opensearchbackend.Document{
				Kind: opensearchbackend.KindCreator, TenantID: tenantID, ID: row.ID, Version: version,
				Name: row.Name, Surfaces: row.Surfaces, PublishedAt: row.PublishedAt,
			})
		}
	}
	if id, ok := filter(opensearchbackend.KindLabel); ok {
		rows, err := q.ListCatalogIndexLabels(ctx, dbmodels.ListCatalogIndexLabelsParams{TenantID: tenantID, LabelID: id})
		if err != nil {
			return nil, fmt.Errorf("catalogindex: list labels: %w", err)
		}
		for _, row := range rows {
			docs = append(docs, opensearchbackend.Document{
				Kind: opensearchbackend.KindLabel, TenantID: tenantID, ID: row.ID, Version: version,
				Name: row.Name, Surfaces: row.Surfaces, PublishedAt: row.PublishedAt,
			})
		}
	}

	if only != nil && len(docs) == 0 {
		switch only.Kind {
		case opensearchbackend.KindSeries, opensearchbackend.KindCreator, opensearchbackend.KindLabel:
			docs = append(docs, opensearchbackend.Document{Kind: only.Kind, TenantID: tenantID, ID: only.ID, Version: version})
		default:
			return nil, outbox.Permanent(fmt.Errorf("%w %q", errUnknownKind, only.Kind))
		}
	}
	return docs, nil
}

// SyncTenant rewrites every document of one tenant on w from one snapshot of
// its rows: those that are published are written, and the rest replaced with
// tombstones no search finds. It answers how many of each it wrote.
//
// It works on the live index: an event draining at the same time carries a
// later read of its row, and the version keeps that read in place.
func SyncTenant(ctx context.Context, db *sql.DB, w Writer, tenantID uuid.UUID) (written, deleted int, err error) {
	var docs []opensearchbackend.Document
	err = inSnapshot(ctx, db, func(q *dbmodels.Queries, version int64) error {
		var err error
		docs, err = readDocuments(ctx, q, tenantID, nil, version)
		return err
	})
	if err != nil {
		return 0, 0, err
	}
	if err := w.PutAll(ctx, docs); err != nil {
		return 0, 0, err
	}
	for _, doc := range docs {
		if len(doc.Surfaces) > 0 {
			written++
		} else {
			deleted++
		}
	}
	return written, deleted, nil
}

// Rebuild fills a new index from every tenant's rows and moves the alias onto
// it, which is how a change to the index definition reaches a running
// deployment. Searches answer from the old index until the move.
//
// Events keep draining into the old index while the new one is filled, so
// once the alias has moved every tenant is synced again on it: a write that
// committed after its tenant was read is read again there, and one that did
// not change is written again at a version that replaces it.
//
// It answers the name of the index the alias names once it is done.
func Rebuild(ctx context.Context, db *sql.DB, backend *opensearchbackend.Backend, logger *slog.Logger) (string, error) {
	tenantIDs, err := dbmodels.New(db).ListCatalogIndexTenantIDs(ctx)
	if err != nil {
		return "", fmt.Errorf("catalogindex: list tenants: %w", err)
	}

	rebuild, err := backend.StartRebuild(ctx)
	if err != nil {
		return "", err
	}
	logger.InfoContext(ctx, "catalog index rebuild started", "index", rebuild.Index(), "tenants", len(tenantIDs))
	if err := fill(ctx, db, rebuild, tenantIDs, logger); err != nil {
		if abortErr := rebuild.Abort(context.WithoutCancel(ctx)); abortErr != nil {
			return "", errors.Join(err, abortErr)
		}
		return "", err
	}
	if err := rebuild.Swap(ctx); err != nil {
		return "", err
	}
	logger.InfoContext(ctx, "catalog index alias moved", "index", rebuild.Index())

	for _, tenantID := range tenantIDs {
		if _, _, err := SyncTenant(ctx, db, backend, tenantID); err != nil {
			return "", fmt.Errorf("catalogindex: sync tenant %s after the swap: %w", tenantID, err)
		}
	}
	return rebuild.Index(), nil
}

func fill(ctx context.Context, db *sql.DB, rebuild *opensearchbackend.Rebuild, tenantIDs []uuid.UUID, logger *slog.Logger) error {
	for _, tenantID := range tenantIDs {
		written, _, err := SyncTenant(ctx, db, rebuild, tenantID)
		if err != nil {
			return fmt.Errorf("catalogindex: fill tenant %s: %w", tenantID, err)
		}
		logger.InfoContext(ctx, "catalog index tenant filled", "tenant_id", tenantID.String(), "documents", written)
	}
	return nil
}
