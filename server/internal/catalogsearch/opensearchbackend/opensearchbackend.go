// Package opensearchbackend is the catalog search backend for a tenant with a
// catalog the SQL backend's substring match no longer serves: OpenSearch with
// the analysis-kuromoji and analysis-icu plugins, which ranks its hits,
// tolerates a typo in Latin text, and matches a title by its reading.
//
// It answers searches and keeps documents; what writes those documents when
// the catalog changes is not here.
package opensearchbackend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/tracing"
)

// inclusiveKey marks a recovery token, which includes its boundary hit once.
const inclusiveKey = "inclusive"

// searchTimeout bounds one search, so a node that stops answering fails it
// instead of holding the RPC until its deadline. It is the searches' alone:
// creating the index loads the analyzers' dictionaries and can take longer on
// a busy node, and its caller sets its own deadline.
const searchTimeout = 10 * time.Second

// Backend searches one index of an OpenSearch cluster.
type Backend struct {
	client *opensearchapi.Client
	index  string
}

var _ catalogsearch.Backend = (*Backend)(nil)

// New connects to the engine cfg names and creates the catalog index when it
// does not exist yet. An engine that does not answer is an error here rather
// than on the first search, so a process configured for it does not start
// without it.
func New(ctx context.Context, cfg Config) (*Backend, error) {
	client, err := opensearchapi.NewClient(opensearchapi.Config{
		Client: opensearch.Config{
			Addresses: []string{cfg.URL},
			Username:  cfg.Username,
			Password:  cfg.Password,
			Transport: tracing.Transport(nil),
			// The configured URL is the only address the client sends to.
			// Discovery would replace it with each node's publish address,
			// which a managed service or a proxy in front of the cluster does
			// not let the client reach.
			DiscoverNodesOnStart: new(false),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: %w", err)
	}
	if _, err := client.Info(ctx, nil); err != nil {
		return nil, fmt.Errorf("opensearchbackend: OpenSearch at %s does not answer: %w", cfg.URL, err)
	}
	backend := &Backend{client: client, index: cfg.Index}
	if err := backend.EnsureIndex(ctx); err != nil {
		return nil, err
	}
	return backend, nil
}

// queryKey is the identity of a search for both the token and the query the
// engine is sent. A token issued for "Seed" works with "seed" because both are
// sent as "seed" and score the same, which a token's boundary depends on.
func queryKey(query string) string {
	return strings.ToLower(query)
}

// japanese reports whether a query has kanji or kana in it, which decides
// how it is matched. A Japanese query is matched by reading as well, so kana
// finds a title written in kanji. It is never matched fuzzily: one edit turns
// a Japanese word into another word rather than into a typo of it, and a kanji
// or kana token is often one character, which one edit matches against every
// other single character.
func japanese(query string) bool {
	for _, r := range query {
		if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana) {
			return true
		}
	}
	return false
}

// latinFuzziness allows one edit in a term of three characters or more, and
// none below that, where one edit matches most other words of the same
// length. The upper bound is past the longest query the API accepts, so no
// term is ever given two.
const latinFuzziness = "AUTO:3,128"

// field is a searched text field and the weight of a match on it.
type field struct {
	name  string
	boost float64
}

// kindSearch is what one kind of document is searched by and ordered by.
type kindSearch struct {
	kind Kind
	// sortField is the keyword sub-field of the title or the name: the exact
	// match, and the order of the hits of one score.
	sortField string
	// readingField is the reading sub-field of the title or the name, which
	// the analyzer derives from the text where no reading was entered.
	readingField string
	fields       []field
}

var (
	seriesSearch = kindSearch{
		kind:         KindSeries,
		sortField:    "title.keyword",
		readingField: "title.reading",
		fields:       []field{{name: "title", boost: 3}, {name: "synopsis", boost: 1}},
	}
	// A creator is matched by the name alone: profile_text would answer a
	// creator-name search with everyone whose biography mentions that name.
	creatorSearch = kindSearch{
		kind:         KindCreator,
		sortField:    "name.keyword",
		readingField: "name.reading",
		fields:       []field{{name: "name", boost: 3}},
	}
	labelSearch = kindSearch{
		kind:         KindLabel,
		sortField:    "name.keyword",
		readingField: "name.reading",
		fields:       []field{{name: "name", boost: 3}},
	}
)

// SearchSeries matches the title, its reading, and the synopsis.
func (b *Backend) SearchSeries(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, seriesSearch)
}

// SearchCreators matches the name and its reading.
func (b *Backend) SearchCreators(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, creatorSearch)
}

// SearchLabels matches the name and its reading.
func (b *Backend) SearchLabels(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, labelSearch)
}

// boundary is the hit a token names: its score, its sort key, and its id, the
// three values the engine orders by. Its zero value is the first page.
type boundary struct {
	valid     bool
	score     float64
	sortKey   string
	id        uuid.UUID
	inclusive bool
}

// Every token carries the query it was issued for, then the score, the sort
// key, and the id, the way the SQL backend's carry the query and its sort
// keys. A token from another query is rejected rather than reinterpreted.
// Token rules: proto/README.md.
func decodeBoundary(cursor pagination.Cursor, query string) (boundary, error) {
	if len(cursor.Keys) != 4 && len(cursor.Keys) != 5 {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	inclusive := len(cursor.Keys) == 5
	if inclusive && cursor.Keys[4] != inclusiveKey {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	if cursor.Keys[0] != queryKey(query) {
		return boundary{}, catalogsearch.ErrTokenForAnotherQuery
	}
	score, err := strconv.ParseFloat(cursor.Keys[1], 64)
	if err != nil {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	id, err := uuid.Parse(cursor.Keys[3])
	if err != nil {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	return boundary{valid: true, score: score, sortKey: cursor.Keys[2], id: id, inclusive: inclusive}, nil
}

func encodeBoundary(direction pagination.Direction, key string, at boundary, recovery bool) string {
	keys := []string{key, strconv.FormatFloat(at.score, 'g', -1, 64), at.sortKey, at.id.String()}
	if recovery {
		keys = append(keys, inclusiveKey)
	}
	return pagination.Encode(direction, keys...)
}

// searchAfterID is the id search_after is given for a boundary. search_after
// is exclusive, so a recovery token, which has to include its boundary hit,
// names the id just before it in the order of the scan instead. Every
// entity_id is a canonical UUID, whose text sorts the way its 128-bit value
// does, so no other document's id lies between the two.
func searchAfterID(at boundary, descending bool) string {
	if !at.inclusive {
		return at.id.String()
	}
	value := new(big.Int).SetBytes(at.id[:])
	if descending {
		value.Add(value, big.NewInt(1))
		if value.BitLen() > 128 {
			// Past the largest UUID: "g" sorts after every hex digit.
			return "g"
		}
	} else {
		if value.Sign() == 0 {
			// Before the smallest UUID: the empty string sorts first.
			return ""
		}
		value.Sub(value, big.NewInt(1))
	}
	var adjacent uuid.UUID
	value.FillBytes(adjacent[:])
	return adjacent.String()
}

// searchBody asks for the ids alone: the sort values carry them, and the
// handlers read what they show from the database.
type searchBody struct {
	Size           int32 `json:"size"`
	TrackTotalHits bool  `json:"track_total_hits"`
	Source         bool  `json:"_source"`
	Query          any   `json:"query"`
	Sort           []any `json:"sort"`
	SearchAfter    []any `json:"search_after,omitempty"`
}

// queryFor builds the bool query of one search: the tenant, the kind, the
// surface, and the publication instant as filters, which do not score, and the
// text clauses as should, of which at least one has to match. Every text
// clause needs all of the query's terms.
func queryFor(search kindSearch, req catalogsearch.Request, query string) map[string]any {
	ja := japanese(query)
	match := func(field string, boost float64, fuzzy bool) map[string]any {
		clause := map[string]any{"query": query, "operator": "and", "boost": boost}
		if fuzzy {
			clause["fuzziness"] = latinFuzziness
		}
		return map[string]any{"match": map[string]any{field: clause}}
	}

	should := []any{
		// The whole title or name typed as it is written outranks any partial
		// match on it.
		map[string]any{"term": map[string]any{search.sortField: map[string]any{"value": query, "boost": 10}}},
	}
	for _, f := range search.fields {
		should = append(should, match(f.name, f.boost, !ja))
	}
	if ja {
		should = append(should, match(search.readingField, 2, false), match("reading", 2, false))
	}

	return map[string]any{
		"bool": map[string]any{
			"filter": []any{
				map[string]any{"term": map[string]any{"tenant_id": req.TenantID.String()}},
				map[string]any{"term": map[string]any{"kind": string(search.kind)}},
				map[string]any{"term": map[string]any{"surfaces": req.Surface}},
				map[string]any{"range": map[string]any{"published_at": map[string]any{"lte": "now"}}},
			},
			"should":               should,
			"minimum_should_match": 1,
		},
	}
}

// sortFor orders by score, then by the sort key, then by id, which no two
// documents share. A backward page scans the same order reversed.
//
// A score is recomputed on every request, so a token stays exact for as long
// as the index does not change under it. A write between two pages can move a
// hit across the boundary, and the reader sees it twice or not at all, which
// is the price of ranking a page that is not kept open between requests.
func sortFor(search kindSearch, descending bool) []any {
	scoreOrder, keyOrder := "desc", "asc"
	if descending {
		scoreOrder, keyOrder = "asc", "desc"
	}
	return []any{
		map[string]any{"_score": map[string]any{"order": scoreOrder}},
		map[string]any{search.sortField: map[string]any{"order": keyOrder}},
		map[string]any{"entity_id": map[string]any{"order": keyOrder}},
	}
}

func (b *Backend) search(ctx context.Context, req catalogsearch.Request, search kindSearch) (catalogsearch.Page, error) {
	key := queryKey(req.Query)
	var keys boundary
	if !req.Cursor.IsZero() {
		var err error
		keys, err = decodeBoundary(req.Cursor, req.Query)
		if err != nil {
			return catalogsearch.Page{}, err
		}
	}
	descending := req.Cursor.Direction == pagination.Backward

	body := searchBody{
		Size:  req.Limit + 1,
		Query: queryFor(search, req, key),
		Sort:  sortFor(search, descending),
	}
	if keys.valid {
		body.SearchAfter = []any{keys.score, keys.sortKey, searchAfterID(keys, descending)}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return catalogsearch.Page{}, fmt.Errorf("opensearchbackend: encode search: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	resp, err := b.client.Search(ctx, &opensearchapi.SearchReq{
		Indices:    []string{b.index},
		BodyReader: bytes.NewReader(encoded),
		Params:     &opensearchapi.SearchParams{Routing: []string{req.TenantID.String()}},
	})
	if err != nil {
		return catalogsearch.Page{}, fmt.Errorf("opensearchbackend: search %s: %w", search.kind, err)
	}

	hits := make([]boundary, 0, len(resp.Hits.Hits))
	for _, raw := range resp.Hits.Hits {
		hit, err := hitBoundary(raw.Sort)
		if err != nil {
			id := ""
			if raw.ID != nil {
				id = *raw.ID
			}
			return catalogsearch.Page{}, fmt.Errorf("opensearchbackend: search %s: hit %s: %w", search.kind, id, err)
		}
		hits = append(hits, hit)
	}
	hits, hasMore := pagination.Page(hits, req.Limit, req.Cursor.Direction)

	page := catalogsearch.Page{IDs: make([]uuid.UUID, 0, len(hits))}
	for _, hit := range hits {
		page.IDs = append(page.IDs, hit.id)
	}
	switch {
	case len(hits) > 0:
		hasPrevious, hasNext := pagination.Neighbors(req.Cursor, hasMore)
		if hasPrevious {
			page.PreviousToken = encodeBoundary(pagination.Backward, key, hits[0], false)
		}
		if hasNext {
			page.NextToken = encodeBoundary(pagination.Forward, key, hits[len(hits)-1], false)
		}
	// An empty page past the boundary still hands back a token that includes
	// the boundary hit, so the reader has a way back to where they came from.
	case req.Cursor.Direction == pagination.Forward && !keys.inclusive:
		page.PreviousToken = encodeBoundary(pagination.Backward, key, keys, true)
	case req.Cursor.Direction == pagination.Backward && !keys.inclusive:
		page.NextToken = encodeBoundary(pagination.Forward, key, keys, true)
	}
	return page, nil
}

// hitBoundary reads the sort values the engine returned with a hit, which are
// the values of the order sortFor asked for.
func hitBoundary(values []opensearchapi.FieldValue) (boundary, error) {
	if len(values) != 3 {
		return boundary{}, fmt.Errorf("%d sort values, want 3", len(values))
	}
	score, err := values[0].Float64()
	if err != nil {
		return boundary{}, fmt.Errorf("score sort value %s is not a number", values[0].RawJSON())
	}
	sortKey, err := values[1].String()
	if err != nil {
		return boundary{}, fmt.Errorf("sort key %s is not a string", values[1].RawJSON())
	}
	rawID, err := values[2].String()
	if err != nil {
		return boundary{}, fmt.Errorf("id sort value %s is not a string", values[2].RawJSON())
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		return boundary{}, fmt.Errorf("id sort value: %w", err)
	}
	return boundary{valid: true, score: score, sortKey: sortKey, id: id}, nil
}
