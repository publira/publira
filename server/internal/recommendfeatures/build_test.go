package recommendfeatures

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
