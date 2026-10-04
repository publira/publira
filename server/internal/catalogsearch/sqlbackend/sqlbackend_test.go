package sqlbackend

import (
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
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
		name     string
		identity []string
		keys     []string
		want     error
	}{
		{name: "too few keys", identity: []string{"seed"}, keys: []string{"seed", "Beta Seed"}, want: catalogsearch.ErrInvalidToken},
		{name: "unknown fourth key", identity: []string{"seed"}, keys: []string{"seed", "Beta Seed", id, "exclusive"}, want: catalogsearch.ErrInvalidToken},
		{name: "id is not a UUID", identity: []string{"seed"}, keys: []string{"seed", "Beta Seed", "not-a-uuid"}, want: catalogsearch.ErrInvalidToken},
		{name: "another query", identity: []string{"seed"}, keys: []string{"zeta", "Beta Seed", id}, want: catalogsearch.ErrTokenForAnotherQuery},
		// A series token from before it named its list is one key short.
		{name: "series token without a list key", identity: []string{"seed", "title_asc"}, keys: []string{"seed", "Beta Seed", id}, want: catalogsearch.ErrInvalidToken},
		{name: "another order", identity: []string{"seed", "title_asc"}, keys: []string{"seed", "title_desc", "Beta Seed", id}, want: catalogsearch.ErrTokenForAnotherNarrowing},
		{name: "another filter", identity: []string{"seed", "title_asc"}, keys: []string{"seed", "title_asc+has_free_episodes", "Beta Seed", id}, want: catalogsearch.ErrTokenForAnotherNarrowing},
		// The query is compared first, so a token for another query and another
		// filter names the query.
		{name: "another query and another filter", identity: []string{"seed", "title_asc"}, keys: []string{"zeta", "title_asc+has_free_episodes", "Beta Seed", id}, want: catalogsearch.ErrTokenForAnotherQuery},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			_, err := decodeBoundary(pagination.Cursor{Direction: pagination.Forward, Keys: test.keys}, test.identity)
			if !errors.Is(err, test.want) {
				t.Fatalf("decodeBoundary error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestSeriesKeysRejectsAnInstantItCannotRead(t *testing.T) {
	t.Parallel()

	id := uuid.NullUUID{UUID: uuid.Must(uuid.NewV7()), Valid: true}
	at := boundary{sortKey: sql.NullString{String: "Beta Seed", Valid: true}, id: id}
	if _, err := seriesKeys(publishedseries.PublishedAtDesc, at); !errors.Is(err, catalogsearch.ErrInvalidToken) {
		t.Fatalf("seriesKeys with a title under a publication order = %v, want ErrInvalidToken", err)
	}
	keys, err := seriesKeys(publishedseries.TitleAsc, at)
	if err != nil || keys.Title.String != "Beta Seed" || keys.ID != id {
		t.Fatalf("seriesKeys under the title order = %+v, %v, want the title and the id", keys, err)
	}
}
