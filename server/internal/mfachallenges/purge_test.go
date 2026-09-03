package mfachallenges

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestRunRejectsIncompleteOptions(t *testing.T) {
	if _, err := New(nil).Run(context.Background(), Options{Cutoff: time.Now().UTC()}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The cutoff is checked before the connection is used, so an unopened
	// handle is enough to reach it.
	if _, err := New(&sql.DB{}).Run(context.Background(), Options{}); err == nil ||
		!strings.Contains(err.Error(), "requires a cutoff") {
		t.Fatalf("missing cutoff error = %v, want a cutoff requirement", err)
	}
}
