package opensearchbackend

import (
	"context"
	"errors"
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
	for _, test := range []struct {
		name string
		keys []string
		want error
	}{
		{name: "the SQL backend's shape", keys: []string{"seed", "beta seed", id}, want: catalogsearch.ErrInvalidToken},
		{name: "unknown fifth key", keys: []string{"seed", "1.5", "beta seed", id, "exclusive"}, want: catalogsearch.ErrInvalidToken},
		{name: "score is not a number", keys: []string{"seed", "high", "beta seed", id}, want: catalogsearch.ErrInvalidToken},
		{name: "id is not a UUID", keys: []string{"seed", "1.5", "beta seed", "not-a-uuid"}, want: catalogsearch.ErrInvalidToken},
		{name: "another query", keys: []string{"zeta", "1.5", "beta seed", id}, want: catalogsearch.ErrTokenForAnotherQuery},
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

// A document carries none of the facts a filter or another order reads, so a
// request asking for either is refused before the engine is asked anything,
// rather than answered with hits the reader filtered out.
func TestSearchSeriesRefusesANarrowedRequest(t *testing.T) {
	t.Parallel()

	backend := &Backend{}
	for name, req := range map[string]catalogsearch.SeriesRequest{
		"an order": {Order: publishedseries.TitleAsc},
		"a filter": {Filter: publishedseries.Filter{HasFreeEpisodes: true}},
	} {
		req.Query = "seed"
		if _, err := backend.SearchSeries(context.Background(), req); !errors.Is(err, catalogsearch.ErrNarrowingUnsupported) {
			t.Fatalf("SearchSeries with %s: error = %v, want %v", name, err, catalogsearch.ErrNarrowingUnsupported)
		}
	}
}

func TestBoundaryRoundTripsThroughAToken(t *testing.T) {
	t.Parallel()

	want := boundary{valid: true, score: 3.1415927410125732, sortKey: "beta seed", id: uuid.Must(uuid.NewV7()), inclusive: true}
	cursor, err := pagination.Decode(encodeBoundary(pagination.Backward, queryKey("Seed"), want, true))
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeBoundary(cursor, "SEED")
	if err != nil {
		t.Fatalf("decodeBoundary: %v", err)
	}
	if got != want {
		t.Fatalf("boundary = %+v, want %+v", got, want)
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
