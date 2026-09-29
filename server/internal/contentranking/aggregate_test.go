package contentranking

import (
	"context"
	"strings"
	"testing"
)

func TestRunRequiresADatabase(t *testing.T) {
	// A zero reference date is not an incomplete option: it means every
	// tenant's own yesterday, which only the run itself can resolve.
	if _, err := New(nil).Run(context.Background(), Options{}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
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
