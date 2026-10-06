package opensearchbackend

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
)

func TestDecodeBoundaryRejectsATokenItDidNotIssue(t *testing.T) {
	t.Parallel()

	id := uuid.Must(uuid.NewV7()).String()
	relevance := orderFor(seriesSearch)
	byTitle, err := seriesOrder(publishedseries.TitleAsc, testSurface)
	if err != nil {
		t.Fatal(err)
	}
	byDate, err := seriesOrder(publishedseries.PublishedAtDesc, testSurface)
	if err != nil {
		t.Fatal(err)
	}
	identity := []string{"seed", "relevance"}
	for _, test := range []struct {
		name     string
		keys     []string
		identity []string
		order    ordering
		want     error
	}{
		{name: "the SQL backend's shape", keys: []string{"seed", "title_asc", "beta seed", id}, identity: identity, order: relevance, want: catalogsearch.ErrTokenForAnotherNarrowing},
		{name: "too few keys", keys: []string{"seed", "relevance", "beta seed", id}, identity: identity, order: relevance, want: catalogsearch.ErrInvalidToken},
		{name: "no list key", keys: []string{"seed"}, identity: identity, order: relevance, want: catalogsearch.ErrInvalidToken},
		{name: "unknown last key", keys: []string{"seed", "relevance", "1.5", "beta seed", id, "exclusive"}, identity: identity, order: relevance, want: catalogsearch.ErrInvalidToken},
		{name: "score is not a number", keys: []string{"seed", "relevance", "high", "beta seed", id}, identity: identity, order: relevance, want: catalogsearch.ErrInvalidToken},
		{name: "instant is not nanoseconds", keys: []string{"seed", "published_at_desc", "2026-10-05T00:00:00Z", id}, identity: []string{"seed", "published_at_desc"}, order: byDate, want: catalogsearch.ErrInvalidToken},
		{name: "id is not a UUID", keys: []string{"seed", "relevance", "1.5", "beta seed", "not-a-uuid"}, identity: identity, order: relevance, want: catalogsearch.ErrInvalidToken},
		{name: "another query", keys: []string{"zeta", "relevance", "1.5", "beta seed", id}, identity: identity, order: relevance, want: catalogsearch.ErrTokenForAnotherQuery},
		{name: "another order", keys: []string{"seed", "title_asc", "beta seed", id}, identity: []string{"seed", "title_desc"}, order: byTitle, want: catalogsearch.ErrTokenForAnotherNarrowing},
		{name: "another filter", keys: []string{"seed", "title_asc", "beta seed", id}, identity: []string{"seed", "title_asc+has_free_episodes"}, order: byTitle, want: catalogsearch.ErrTokenForAnotherNarrowing},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			_, err := decodeBoundary(pagination.Cursor{Direction: pagination.Forward, Keys: test.keys}, test.identity, test.order)
			if !errors.Is(err, test.want) {
				t.Fatalf("decodeBoundary error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestBoundaryRoundTripsThroughAToken(t *testing.T) {
	t.Parallel()

	byDate, err := seriesOrder(publishedseries.LatestEpisodeAtDesc, testSurface)
	if err != nil {
		t.Fatal(err)
	}
	for name, test := range map[string]struct {
		order ordering
		want  boundary
	}{
		"relevance": {order: orderFor(seriesSearch), want: boundary{valid: true, values: []any{3.1415927410125732, "beta seed"}, id: uuid.Must(uuid.NewV7()), inclusive: true}},
		"a date":    {order: byDate, want: boundary{valid: true, values: []any{int64(1759622400123456000)}, id: uuid.Must(uuid.NewV7())}},
	} {
		identity := []string{queryKey("Seed"), "some list"}
		cursor, err := pagination.Decode(encodeBoundary(pagination.Backward, identity, test.want, test.want.inclusive))
		if err != nil {
			t.Fatal(err)
		}
		got, err := decodeBoundary(cursor, []string{queryKey("SEED"), "some list"}, test.order)
		if err != nil {
			t.Fatalf("%s: decodeBoundary: %v", name, err)
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%s: boundary = %+v, want %+v", name, got, test.want)
		}
	}
}

// Every order of the list sorts by its column and then by the id, both in the
// order's direction, and a backward page reverses the two.
func TestSortForFollowsTheListOrder(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		order    publishedseries.Order
		backward bool
		want     string
	}{
		{order: publishedseries.TitleAsc, want: `[{"title.sort":{"order":"asc"}},{"entity_id":{"order":"asc"}}]`},
		{order: publishedseries.TitleDesc, want: `[{"title.sort":{"order":"desc"}},{"entity_id":{"order":"desc"}}]`},
		{order: publishedseries.TitleDesc, backward: true, want: `[{"title.sort":{"order":"asc"}},{"entity_id":{"order":"asc"}}]`},
		{order: publishedseries.PublishedAtDesc, want: `[{"published_at":{"order":"desc","unmapped_type":"date_nanos"}},{"entity_id":{"order":"desc"}}]`},
		{order: publishedseries.PublishedAtAsc, want: `[{"published_at":{"order":"asc","unmapped_type":"date_nanos"}},{"entity_id":{"order":"asc"}}]`},
		{order: publishedseries.LatestEpisodeAtDesc, want: `[{"latest_episode_at.web":{"order":"desc","unmapped_type":"date_nanos"}},{"entity_id":{"order":"desc"}}]`},
	} {
		order, err := seriesOrder(test.order, testSurface)
		if err != nil {
			t.Fatalf("seriesOrder(%s): %v", test.order.Name, err)
		}
		got, err := json.Marshal(sortFor(order, test.backward))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != test.want {
			t.Errorf("sortFor(%s, backward=%v) = %s, want %s", test.order.Name, test.backward, got, test.want)
		}
	}
}

func TestSearchAfterIDIncludesTheBoundary(t *testing.T) {
	t.Parallel()

	id := uuid.MustParse("019d008d-184d-7d31-a78a-89728a746e38")
	for _, test := range []struct {
		name       string
		at         boundary
		descending bool
		want       string
	}{
		{name: "an exclusive boundary is its own id", at: boundary{id: id}, want: id.String()},
		{name: "ascending steps back one", at: boundary{id: id, inclusive: true}, want: "019d008d-184d-7d31-a78a-89728a746e37"},
		{name: "descending steps forward one", at: boundary{id: id, inclusive: true}, descending: true, want: "019d008d-184d-7d31-a78a-89728a746e39"},
		{name: "a borrow crosses bytes", at: boundary{id: uuid.MustParse("00000000-0000-0000-0001-000000000000"), inclusive: true}, want: "00000000-0000-0000-0000-ffffffffffff"},
		{name: "before the smallest id", at: boundary{id: uuid.Nil, inclusive: true}, want: ""},
		{name: "after the largest id", at: boundary{id: uuid.Max, inclusive: true}, descending: true, want: "g"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			got := searchAfterID(test.at, test.descending)
			if got != test.want {
				t.Fatalf("searchAfterID = %q, want %q", got, test.want)
			}
			if !test.at.inclusive {
				return
			}
			// No canonical id may sort between the adjacent value and the
			// boundary, or a recovery token would skip it.
			boundaryText := test.at.id.String()
			if test.descending && strings.Compare(got, boundaryText) <= 0 {
				t.Fatalf("%q does not sort after %q", got, boundaryText)
			}
			if !test.descending && strings.Compare(got, boundaryText) >= 0 {
				t.Fatalf("%q does not sort before %q", got, boundaryText)
			}
		})
	}
}

func TestWholeWordScriptIsAnyHanKanaOrHangul(t *testing.T) {
	t.Parallel()

	for query, want := range map[string]bool{
		"seed story": false,
		"café":       false,
		"話":          true,
		"はなし":        true,
		"シード":        true,
		"seed 物語":    true,
		"바다":         true,
		"seed 바다":    true,
	} {
		if got := wholeWordScript(query); got != want {
			t.Errorf("wholeWordScript(%q) = %v, want %v", query, got, want)
		}
	}
}

// fuzzyAndReadingClauses lists the fields a query matches fuzzily, and the
// alternate-form fields it matches at all.
func fuzzyAndReadingClauses(t *testing.T, query map[string]any) (fuzzy, reading []string) {
	t.Helper()
	encoded, err := json.Marshal(query)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Bool struct {
			Should []map[string]map[string]map[string]any `json:"should"`
		} `json:"bool"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, clause := range decoded.Bool.Should {
		for field, spec := range clause["match"] {
			if _, ok := spec["fuzziness"]; ok {
				fuzzy = append(fuzzy, field)
			}
			if field == "reading" || strings.HasSuffix(field, ".reading") {
				reading = append(reading, field)
			}
		}
	}
	return fuzzy, reading
}

func TestAHangulQueryIsNeverMatchedFuzzily(t *testing.T) {
	t.Parallel()

	for query, want := range map[string]struct {
		fuzzy   bool
		reading bool
	}{
		"seed":    {fuzzy: true},
		"바다":      {reading: true},
		"seed 바다": {reading: true},
		"ぎんが":     {reading: true},
	} {
		fuzzy, reading := fuzzyAndReadingClauses(t, queryFor(seriesSearch, catalogsearch.Request{Surface: testSurface}, query, nil))
		if got := len(fuzzy) > 0; got != want.fuzzy {
			t.Errorf("query %q matches %v fuzzily, want fuzzy = %v", query, fuzzy, want.fuzzy)
		}
		if got := len(reading) > 0; got != want.reading {
			t.Errorf("query %q matches the alternate form on %v, want it matched = %v", query, reading, want.reading)
		}
	}
}
