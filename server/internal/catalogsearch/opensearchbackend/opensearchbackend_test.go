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

func TestJapaneseIsAnyKanjiOrKana(t *testing.T) {
	t.Parallel()

	for query, want := range map[string]bool{
		"seed story": false,
		"café":       false,
		"話":          true,
		"はなし":        true,
		"シード":        true,
		"seed 物語":    true,
	} {
		if got := japanese(query); got != want {
			t.Errorf("japanese(%q) = %v, want %v", query, got, want)
		}
	}
}

func TestConfigFromEnv(t *testing.T) {
	for _, test := range []struct {
		name    string
		env     map[string]string
		want    Config
		wantErr string
	}{
		{
			name:    "no URL",
			env:     map[string]string{},
			wantErr: "PUBLIRA_OPENSEARCH_URL is required",
		},
		{
			name: "URL alone takes the default index",
			env:  map[string]string{"PUBLIRA_OPENSEARCH_URL": "http://opensearch:9200"},
			want: Config{URL: "http://opensearch:9200", Index: DefaultIndex},
		},
		{
			name: "credentials over https",
			env: map[string]string{
				"PUBLIRA_OPENSEARCH_URL":      "https://search.example.com",
				"PUBLIRA_OPENSEARCH_USERNAME": "publira",
				"PUBLIRA_OPENSEARCH_PASSWORD": "secret",
				"PUBLIRA_OPENSEARCH_INDEX":    "publira-staging",
			},
			want: Config{URL: "https://search.example.com", Username: "publira", Password: "secret", Index: "publira-staging"},
		},
		{
			name:    "not an http URL",
			env:     map[string]string{"PUBLIRA_OPENSEARCH_URL": "opensearch:9200"},
			wantErr: "is not an http:// or https:// URL",
		},
		{
			name:    "credentials in a URL that does not parse",
			env:     map[string]string{"PUBLIRA_OPENSEARCH_URL": "https://publira:secret@[search.example.com"},
			wantErr: "is not an http:// or https:// URL",
		},
		{
			name:    "credentials in a URL of another scheme",
			env:     map[string]string{"PUBLIRA_OPENSEARCH_URL": "opensearch://publira:secret@search.example.com"},
			wantErr: "is not an http:// or https:// URL",
		},
		{
			name:    "credentials in the URL",
			env:     map[string]string{"PUBLIRA_OPENSEARCH_URL": "https://publira:secret@search.example.com"},
			wantErr: "carries credentials",
		},
		{
			name: "a username without a password",
			env: map[string]string{
				"PUBLIRA_OPENSEARCH_URL":      "https://search.example.com",
				"PUBLIRA_OPENSEARCH_USERNAME": "publira",
			},
			wantErr: "set together or not at all",
		},
		{
			name: "credentials over http",
			env: map[string]string{
				"PUBLIRA_OPENSEARCH_URL":      "http://opensearch:9200",
				"PUBLIRA_OPENSEARCH_USERNAME": "publira",
				"PUBLIRA_OPENSEARCH_PASSWORD": "secret",
			},
			wantErr: "cleartext",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, name := range []string{"PUBLIRA_OPENSEARCH_URL", "PUBLIRA_OPENSEARCH_USERNAME", "PUBLIRA_OPENSEARCH_PASSWORD", "PUBLIRA_OPENSEARCH_INDEX"} {
				t.Setenv(name, test.env[name])
			}

			got, err := ConfigFromEnv()
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("ConfigFromEnv error = %v, want one containing %q", err, test.wantErr)
				}
				// The error reaches the startup log, so it must not repeat a
				// credential the value carried.
				if strings.Contains(err.Error(), "secret") {
					t.Fatalf("ConfigFromEnv error %q prints the password", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ConfigFromEnv: %v", err)
			}
			if got != test.want {
				t.Fatalf("ConfigFromEnv = %+v, want %+v", got, test.want)
			}
		})
	}
}
