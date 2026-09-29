package orphanimages

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/storage"
)

var cutoff = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

// stubQuerier answers the reference lookup from a fixed set of keys.
type stubQuerier struct {
	Querier
	referenced []string
	asked      [][]string
}

func (q *stubQuerier) ListReferencedObjectKeys(_ context.Context, objectKeys []string) ([]string, error) {
	q.asked = append(q.asked, slices.Clone(objectKeys))
	found := make([]string, 0, len(objectKeys))
	for _, key := range objectKeys {
		if slices.Contains(q.referenced, key) {
			found = append(found, key)
		}
	}
	return found, nil
}

// stubStorage records the keys it was asked to delete.
type stubStorage struct {
	storage.Reclaimer
	deleted []string
}

func (s *stubStorage) Delete(_ context.Context, objectKeys []string) error {
	s.deleted = append(s.deleted, objectKeys...)
	return nil
}

func TestRunRejectsIncompleteOptions(t *testing.T) {
	if _, err := New(nil, &stubStorage{}).Run(t.Context(), Options{Cutoff: cutoff}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The storage backend and the cutoff are checked before the connection is
	// used, so an unopened handle is enough to reach them.
	if _, err := New(&sql.DB{}, nil).Run(t.Context(), Options{Cutoff: cutoff}); err == nil ||
		!strings.Contains(err.Error(), "requires a storage backend") {
		t.Fatalf("missing storage error = %v, want a storage requirement", err)
	}

	if _, err := New(&sql.DB{}, &stubStorage{}).Run(t.Context(), Options{}); err == nil ||
		!strings.Contains(err.Error(), "requires a cutoff") {
		t.Fatalf("missing cutoff error = %v, want a cutoff requirement", err)
	}
}

func TestReclaimPageDeletesOnlyUnreferencedObjects(t *testing.T) {
	queries := &stubQuerier{referenced: []string{"tenants/t1/icons/kept.webp"}}
	store := &stubStorage{}
	reclaimer := &Reclaimer{queries: queries, storage: store}

	deleted, err := reclaimer.reclaimPage(t.Context(), []storage.Object{
		{ObjectKey: "tenants/t1/icons/kept.webp", LastModified: cutoff.Add(-time.Hour)},
		{ObjectKey: "tenants/t1/icons/orphan.webp", LastModified: cutoff.Add(-time.Hour)},
	}, Options{Cutoff: cutoff})
	if err != nil {
		t.Fatalf("reclaimPage: %v", err)
	}

	if deleted != 1 {
		t.Fatalf("deleted count = %d, want 1", deleted)
	}
	if want := []string{"tenants/t1/icons/orphan.webp"}; !slices.Equal(store.deleted, want) {
		t.Fatalf("deleted keys = %v, want %v", store.deleted, want)
	}
}

// TestReclaimPageLeavesObjectsNewerThanCutoff covers the guard that keeps an
// upload still in flight out of a sweep: its object exists before the variant
// row that names it does, and only the cutoff tells the two apart.
func TestReclaimPageLeavesObjectsNewerThanCutoff(t *testing.T) {
	queries := &stubQuerier{}
	store := &stubStorage{}
	reclaimer := &Reclaimer{queries: queries, storage: store}

	deleted, err := reclaimer.reclaimPage(t.Context(), []storage.Object{
		{ObjectKey: "tenants/t1/icons/in-flight.webp", LastModified: cutoff},
		{ObjectKey: "tenants/t1/icons/newer.webp", LastModified: cutoff.Add(time.Hour)},
	}, Options{Cutoff: cutoff})
	if err != nil {
		t.Fatalf("reclaimPage: %v", err)
	}

	if deleted != 0 {
		t.Fatalf("deleted count = %d, want 0", deleted)
	}
	if len(store.deleted) != 0 {
		t.Fatalf("deleted keys = %v, want none", store.deleted)
	}
	// Nothing was old enough to be a candidate, so the database was never asked.
	if len(queries.asked) != 0 {
		t.Fatalf("reference lookups = %v, want none", queries.asked)
	}
}

func TestReclaimPageDryRunCountsWithoutDeleting(t *testing.T) {
	queries := &stubQuerier{referenced: []string{"tenants/t1/icons/kept.webp"}}
	store := &stubStorage{}
	reclaimer := &Reclaimer{queries: queries, storage: store}

	deleted, err := reclaimer.reclaimPage(t.Context(), []storage.Object{
		{ObjectKey: "tenants/t1/icons/kept.webp", LastModified: cutoff.Add(-time.Hour)},
		{ObjectKey: "tenants/t1/icons/orphan.webp", LastModified: cutoff.Add(-time.Hour)},
	}, Options{Cutoff: cutoff, DryRun: true})
	if err != nil {
		t.Fatalf("reclaimPage: %v", err)
	}

	if deleted != 1 {
		t.Fatalf("counted count = %d, want 1", deleted)
	}
	if len(store.deleted) != 0 {
		t.Fatalf("deleted keys = %v, want none in a dry run", store.deleted)
	}
}
