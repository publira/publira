package contentranking

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRunRejectsIncompleteOptions(t *testing.T) {
	if _, err := New(nil).Run(context.Background(), Options{ReferenceDate: time.Now().UTC()}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The reference date is checked before the connection is used. The mock
	// expects nothing, so a run that reached the database would fail on the
	// unexpected query rather than pass on a handle that was never touched.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("open mock database: %v", err)
	}
	defer db.Close() //nolint:errcheck
	if _, err := New(db).Run(context.Background(), Options{}); err == nil ||
		!strings.Contains(err.Error(), "requires a reference date") {
		t.Fatalf("missing reference date error = %v, want a reference date requirement", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database use: %v", err)
	}
}

func TestWeightsOrderTheSignalsTheyRank(t *testing.T) {
	// The score formula only behaves as documented while every weight is
	// positive and a purchase outweighs a follow, a follow a distinct viewer,
	// and a distinct viewer a repeat view. The empty-ranking guard leans on
	// the same positivity: it counts a row as rankable from the signals alone.
	if viewWeight <= 0 || uniqueViewerWeight <= 0 || purchaseWeight <= 0 || favoriteWeight <= 0 || ratingWeight <= 0 {
		t.Fatal("every score weight must be positive")
	}
	if purchaseWeight <= favoriteWeight || favoriteWeight <= uniqueViewerWeight || uniqueViewerWeight <= viewWeight {
		t.Fatalf("weights are out of order: purchase=%d favorite=%d unique viewer=%d view=%d",
			purchaseWeight, favoriteWeight, uniqueViewerWeight, viewWeight)
	}
}
