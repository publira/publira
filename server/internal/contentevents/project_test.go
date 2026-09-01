package contentevents

import (
	"context"
	"strings"
	"testing"
)

func TestProjectorRequiresDatabase(t *testing.T) {
	if _, err := NewProjector(nil).Run(context.Background(), ProjectionOptions{}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}
}
