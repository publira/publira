package sqlbackend

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
)

func TestQueryKeyAndIlikePatternShareIdentity(t *testing.T) {
	t.Parallel()

	if queryKey("SEED") != queryKey("Seed") {
		t.Fatal("ASCII case changes must share a token key")
	}
	if got, want := ilikeContainsPattern(queryKey("SEED")), "%seed%"; got != want {
		t.Fatalf("ILIKE pattern = %q, want the same lowercased pattern as the token key", got)
	}
	if queryKey("シード") != "シード" {
		t.Fatal("Japanese queries must stay as-is; the API does not restrict to ASCII")
	}
}

func TestIlikeContainsPatternEscapesMetacharacters(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"Seed":     "%Seed%",
		"100%":     "%100!%%",
		"a_b":      "%a!_b%",
		"wow!":     "%wow!!%",
		"%_!":      "%!%!_!!%",
		"Seed 001": "%Seed 001%",
	}
	for input, want := range cases {
		if got := ilikeContainsPattern(input); got != want {
			t.Errorf("ilikeContainsPattern(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDecodeBoundaryRejectsATokenItDidNotIssue(t *testing.T) {
	t.Parallel()

	id := uuid.Must(uuid.NewV7()).String()
	for _, test := range []struct {
		name string
		keys []string
		want error
	}{
		{name: "too few keys", keys: []string{"seed", "Beta Seed"}, want: catalogsearch.ErrInvalidToken},
		{name: "unknown fourth key", keys: []string{"seed", "Beta Seed", id, "exclusive"}, want: catalogsearch.ErrInvalidToken},
		{name: "id is not a UUID", keys: []string{"seed", "Beta Seed", "not-a-uuid"}, want: catalogsearch.ErrInvalidToken},
		{name: "another query", keys: []string{"zeta", "Beta Seed", id}, want: catalogsearch.ErrTokenForAnotherQuery},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			_, err := decodeBoundary(pagination.Cursor{Direction: pagination.Forward, Keys: test.keys}, "Seed")
			if !errors.Is(err, test.want) {
				t.Fatalf("decodeBoundary error = %v, want %v", err, test.want)
			}
		})
	}
}
