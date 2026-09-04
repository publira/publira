// Package orphanimages holds the reclamation side of image storage. Uploading
// an image writes two things that no single transaction covers — rows in the
// database and objects in the S3 compatible bucket — so the two drift apart
// whenever a write fails halfway or a replacement supersedes what came before.
// Nothing breaks when they do; the bucket just grows with every upload that
// was ever undone. This package is what brings it back down.
package orphanimages

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

const (
	// DefaultPageSize bounds one listing page, and with it the number of keys
	// one reference lookup and one batch delete carry. It is S3's own page
	// ceiling: a smaller value only adds round trips.
	DefaultPageSize = 1000
	// DefaultPrefix is the only part of the bucket this repository writes
	// under. Sweeping from the root would put anything an operator stored
	// beside it in range of a delete.
	DefaultPrefix = "tenants/"
	// DefaultMinAge keeps a run away from the uploads around it. Nothing older
	// than this can still be mid-upload, so an object this old that no variant
	// row names is one no future write will claim either.
	DefaultMinAge = 24 * time.Hour
)

// Querier is the generated set of queries one reclamation run needs.
type Querier interface {
	ListReferencedObjectKeys(ctx context.Context, objectKeys []string) ([]string, error)
	DeleteUnreferencedCreatorImages(ctx context.Context, createdBefore time.Time) (int64, error)
	DeleteUnreferencedLabelImages(ctx context.Context, createdBefore time.Time) (int64, error)
	DeleteUnreferencedSeriesImages(ctx context.Context, createdBefore time.Time) (int64, error)
	DeleteUnreferencedTenantImages(ctx context.Context, createdBefore time.Time) (int64, error)
}

// Reclaimer deletes the image rows nothing points at and then the storage
// objects nothing names. Its database connection must use a role with
// BYPASSRLS (or be a superuser), because one run spans every tenant.
type Reclaimer struct {
	db      *sql.DB
	queries Querier
	storage storage.Reclaimer
}

// Options describes one reclamation run.
type Options struct {
	// Prefix limits the sweep to the part of the bucket this repository owns.
	// Empty means DefaultPrefix.
	Prefix string
	// Cutoff is exclusive and applies to both halves of a run: an image row
	// created at or after it, and an object last modified at or after it, are
	// left for the next run. It is what separates an upload still in flight
	// from one that will never be finished.
	Cutoff time.Time
	// PageSize is the object count of one listing page. Zero means
	// DefaultPageSize.
	PageSize int32
	// DryRun deletes nothing: it leaves the image rows alone and reports the
	// objects the sweep would remove. Because the row deletes are what strand
	// a replaced image's objects, that count covers the objects already
	// unreferenced and not the ones this run would have stranded first.
	DryRun bool
}

// Result describes what one reclamation run did.
type Result struct {
	// RowCount is the number of *_images rows deleted. It is zero in a dry run.
	RowCount int64
	// ScannedCount is the number of objects the listing returned, including
	// the ones too new to be candidates.
	ScannedCount int64
	// DeletedCount is the number of objects deleted, or — in a dry run — the
	// number that would have been.
	DeletedCount int64
	// PageCount is how many listing pages were read. It is at least one,
	// because a run always probes the bucket.
	PageCount int
	// DryRun repeats Options.DryRun so callers can log a single struct.
	DryRun bool
}

// New constructs a Reclaimer backed by db and store.
func New(db *sql.DB, store storage.Reclaimer) *Reclaimer {
	if db == nil {
		return &Reclaimer{storage: store}
	}
	return &Reclaimer{db: db, queries: dbmodels.New(db), storage: store}
}

// Run drops the unreferenced image rows and then sweeps the bucket, in that
// order: a row deleted in the first half takes its variants with it, so the
// objects it was the last thing naming become orphans the same run collects.
//
// The two halves are separately durable. Each row delete is its own statement
// and each page's delete its own request, so an interrupted run keeps what it
// finished and the next one resumes from a fresh listing.
//
// A run costs what the bucket holds, not what turns out to be garbage: every
// object is listed and every key checked whether or not anything is deleted,
// which is one ListObjectsV2 and one reference lookup per PageSize objects.
// The trigger to reconsider that shape — sweeping one tenant at a time, or
// staggering prefixes across days — is a run that stops fitting the cron
// interval, which the elapsed time in its completion log reports.
func (r *Reclaimer) Run(ctx context.Context, opts Options) (Result, error) {
	if r == nil || r.db == nil {
		return Result{}, errors.New("orphan image reclamation requires a database")
	}
	if r.storage == nil {
		return Result{}, errors.New("orphan image reclamation requires a storage backend")
	}
	if opts.Cutoff.IsZero() {
		return Result{}, errors.New("orphan image reclamation requires a cutoff")
	}
	prefix := opts.Prefix
	if prefix == "" {
		prefix = DefaultPrefix
	}
	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if err := r.requireBypassRLS(ctx); err != nil {
		return Result{}, err
	}

	result := Result{DryRun: opts.DryRun}
	if !opts.DryRun {
		rowCount, err := r.deleteUnreferencedImages(ctx, opts.Cutoff)
		result.RowCount = rowCount
		if err != nil {
			return result, err
		}
	}

	cursor := ""
	for {
		page, err := r.storage.List(ctx, storage.ListRequest{Prefix: prefix, Cursor: cursor, Limit: pageSize})
		if err != nil {
			return result, fmt.Errorf("list stored objects: %w", err)
		}
		result.ScannedCount += int64(len(page.Objects))
		result.PageCount++

		deleted, err := r.reclaimPage(ctx, page.Objects, opts)
		result.DeletedCount += deleted
		if err != nil {
			return result, err
		}

		if page.NextCursor == "" {
			return result, nil
		}
		cursor = page.NextCursor
		if err := ctx.Err(); err != nil {
			return result, err
		}
	}
}

// deleteUnreferencedImages drops the image rows no entity points at any more.
// Each table is its own statement, so a failure part-way still leaves the
// tables it finished cleaned up.
func (r *Reclaimer) deleteUnreferencedImages(ctx context.Context, cutoff time.Time) (int64, error) {
	tables := []struct {
		name string
		run  func(context.Context, time.Time) (int64, error)
	}{
		{"creator_images", r.queries.DeleteUnreferencedCreatorImages},
		{"label_images", r.queries.DeleteUnreferencedLabelImages},
		{"series_images", r.queries.DeleteUnreferencedSeriesImages},
		{"tenant_images", r.queries.DeleteUnreferencedTenantImages},
	}

	var total int64
	for _, table := range tables {
		rows, err := table.run(ctx, cutoff)
		total += rows
		if err != nil {
			return total, fmt.Errorf("delete unreferenced %s: %w", table.name, err)
		}
	}
	return total, nil
}

// reclaimPage deletes the objects on one listing page that are past the cutoff
// and that no image variant names, and returns how many that was.
//
// The database is read after the listing, never before. An object this run can
// see was written before the listing, and the cutoff puts it further back than
// any upload still running, so a variant row that would rescue it either
// exists by the time of this read or is never written at all.
func (r *Reclaimer) reclaimPage(ctx context.Context, objects []storage.Object, opts Options) (int64, error) {
	candidates := make([]string, 0, len(objects))
	for _, object := range objects {
		if object.LastModified.Before(opts.Cutoff) {
			candidates = append(candidates, object.ObjectKey)
		}
	}
	if len(candidates) == 0 {
		return 0, nil
	}

	referenced, err := r.queries.ListReferencedObjectKeys(ctx, candidates)
	if err != nil {
		return 0, fmt.Errorf("list referenced object keys: %w", err)
	}
	inUse := make(map[string]struct{}, len(referenced))
	for _, key := range referenced {
		inUse[key] = struct{}{}
	}

	orphans := make([]string, 0, len(candidates)-len(inUse))
	for _, key := range candidates {
		if _, ok := inUse[key]; !ok {
			orphans = append(orphans, key)
		}
	}
	if len(orphans) == 0 {
		return 0, nil
	}
	if opts.DryRun {
		return int64(len(orphans)), nil
	}
	if err := r.storage.Delete(ctx, orphans); err != nil {
		return 0, fmt.Errorf("delete orphan objects: %w", err)
	}
	return int64(len(orphans)), nil
}

func (r *Reclaimer) requireBypassRLS(ctx context.Context) error {
	var bypasses bool
	err := r.db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("orphan image reclamation requires a database role with BYPASSRLS")
	}
	return nil
}
