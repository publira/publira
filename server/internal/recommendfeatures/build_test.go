package recommendfeatures

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestRunRejectsIncompleteOptions(t *testing.T) {
	if _, err := New(nil).Run(context.Background(), Options{ReferenceDate: time.Now().UTC()}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The reference date is checked before the connection is used, so an
	// unopened handle is enough to reach it.
	if _, err := New(&sql.DB{}).Run(context.Background(), Options{}); err == nil ||
		!strings.Contains(err.Error(), "requires a reference date") {
		t.Fatalf("missing reference date error = %v, want a reference date requirement", err)
	}
}
