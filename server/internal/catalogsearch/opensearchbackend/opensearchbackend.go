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
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"

	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
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

// relevanceOrder names the order of a series search that asks for none in the
// list key its tokens carry, beside the names of the orders the list has.
const relevanceOrder = "relevance"

// SearchSeries matches the title, its reading, and the synopsis, keeps the
// hits the published series list would keep under the request's filters, and
// orders them the way that list orders under the request's order, or by
// relevance where it asks for none.
func (b *Backend) SearchSeries(ctx context.Context, req catalogsearch.SeriesRequest) (catalogsearch.Page, error) {
	order := orderFor(seriesSearch)
	name := relevanceOrder
	if req.Order != (publishedseries.Order{}) {
		var err error
		order, err = seriesOrder(req.Order, req.Surface)
		if err != nil {
			return catalogsearch.Page{}, err
		}
		name = req.Order.Name
	}
	identity := []string{queryKey(req.Query), publishedseries.ListKey(publishedseries.Order{Name: name}, req.Filter)}
	return b.search(ctx, req.Request, seriesSearch, identity, order, seriesFilters(req))
}

// SearchCreators matches the name and its reading.
func (b *Backend) SearchCreators(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, creatorSearch, []string{queryKey(req.Query)}, orderFor(creatorSearch), nil)
}

// SearchLabels matches the name and its reading.
func (b *Backend) SearchLabels(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, labelSearch, []string{queryKey(req.Query)}, orderFor(labelSearch), nil)
}

// valueType is how a sort value is read from a hit, written into a token, and
// handed back to search_after.
type valueType int

const (
	// A score, a float.
	scoreValue valueType = iota
	// A keyword, a string.
	keywordValue
	// An instant, a date_nanos field the engine sorts and answers as epoch
	// nanoseconds.
	dateValue
)

// sortKey is one value the hits are ordered by ahead of the id.
type sortKey struct {
	field      string
	typ        valueType
	descending bool
}

// ordering is the order of a search: its sort keys, then the id, which no two
// documents share, in the direction the last key runs.
type ordering struct {
	keys         []sortKey
	idDescending bool
}

// orderFor ranks the hits of a search, breaking a tie of scores by the title or
// the name and then by the id.
//
// A score is recomputed on every request, so a token stays exact for as long
// as the index does not change under it. A write between two pages can move a
// hit across the boundary, and the reader sees it twice or not at all, which
// is the price of ranking a page that is not kept open between requests.
func orderFor(search kindSearch) ordering {
	return ordering{keys: []sortKey{
		{field: "_score", typ: scoreValue, descending: true},
		{field: search.sortField, typ: keywordValue},
	}}
}

// seriesOrder is the order of the published series list, on the document's
// copy of the column the list sorts by and then the id, both in the order's
// direction, as the list's scans run.
func seriesOrder(order publishedseries.Order, surface string) (ordering, error) {
	var key sortKey
	switch order.Column {
	case publishedseries.ColumnTitle:
		key = sortKey{field: "title.sort", typ: keywordValue}
	case publishedseries.ColumnPublishedAt:
		key = sortKey{field: "published_at", typ: dateValue}
	case publishedseries.ColumnLatestEpisodeAt:
		key = sortKey{field: "latest_episode_at." + surface, typ: dateValue}
	default:
		return ordering{}, fmt.Errorf("opensearchbackend: no sort for the column %q", order.Column)
	}
	key.descending = order.Descending
	return ordering{keys: []sortKey{key}, idDescending: order.Descending}, nil
}

// seriesFilters are the request's filters as clauses on the document's copy of
// what the list's scans read. A free episode counts only where it is open on
// the surface asking, as it does in the list.
func seriesFilters(req catalogsearch.SeriesRequest) []any {
	term := func(field string, value any) any {
		return map[string]any{"term": map[string]any{field: value}}
	}
	var filters []any
	if req.Filter.HasFreeEpisodes {
		filters = append(filters, term("free_episode_surfaces", req.Surface))
	}
	if req.Filter.GenrePublicID.Valid {
		filters = append(filters, term("genre_public_ids", req.Filter.GenrePublicID.String))
	}
	if req.Filter.TagSlug.Valid {
		filters = append(filters, term("tag_slugs", req.Filter.TagSlug.String))
	}
	if req.Filter.Status.Valid {
		filters = append(filters, term("status", req.Filter.Status.String))
	}
	if req.Filter.Weekday.Valid {
		filters = append(filters, term("schedule_weekdays", req.Filter.Weekday.Int16))
	}
	return filters
}

// boundary is the hit a token names: the values of the order's sort keys, in
// the types search_after takes back, and its id. Its zero value is the first
// page.
type boundary struct {
	valid     bool
	values    []any
	id        uuid.UUID
	inclusive bool
}

// Every token carries the identity of the search it was issued for, then the
// values of the order's sort keys and the id, the way the SQL backend's carry
// the query and its sort keys. The identity is the query key, and for a series
// search the list key of its order and filters after it. A token from another
// query or another narrowing is rejected rather than reinterpreted. Token
// rules: proto/README.md.
func decodeBoundary(cursor pagination.Cursor, identity []string, order ordering) (boundary, error) {
	n := len(identity)
	if len(cursor.Keys) < n {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	if cursor.Keys[0] != identity[0] {
		return boundary{}, catalogsearch.ErrTokenForAnotherQuery
	}
	for index := 1; index < n; index++ {
		if cursor.Keys[index] != identity[index] {
			return boundary{}, catalogsearch.ErrTokenForAnotherNarrowing
		}
	}
	rest := cursor.Keys[n:]
	if len(rest) != len(order.keys)+1 && len(rest) != len(order.keys)+2 {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	inclusive := len(rest) == len(order.keys)+2
	if inclusive && rest[len(rest)-1] != inclusiveKey {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	at := boundary{valid: true, values: make([]any, len(order.keys)), inclusive: inclusive}
	for index, key := range order.keys {
		value, err := parseValue(key.typ, rest[index])
		if err != nil {
			return boundary{}, catalogsearch.ErrInvalidToken
		}
		at.values[index] = value
	}
	id, err := uuid.Parse(rest[len(order.keys)])
	if err != nil {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	at.id = id
	return at, nil
}

func parseValue(typ valueType, text string) (any, error) {
	switch typ {
	case scoreValue:
		return strconv.ParseFloat(text, 64)
	case dateValue:
		return strconv.ParseInt(text, 10, 64)
	default:
		return text, nil
	}
}

func formatValue(value any) string {
	switch value := value.(type) {
	case float64:
		return strconv.FormatFloat(value, 'g', -1, 64)
	case int64:
		return strconv.FormatInt(value, 10)
	default:
		return fmt.Sprint(value)
	}
}

func encodeBoundary(direction pagination.Direction, identity []string, at boundary, recovery bool) string {
	keys := make([]string, 0, len(identity)+len(at.values)+2)
	keys = append(keys, identity...)
	for _, value := range at.values {
		keys = append(keys, formatValue(value))
	}
	keys = append(keys, at.id.String())
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
// surface, the publication instant, and the request's own filters as filters,
// which do not score, and the text clauses as should, of which at least one
// has to match. Every text clause needs all of the query's terms.
func queryFor(search kindSearch, req catalogsearch.Request, query string, filters []any) map[string]any {
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
			"filter": append([]any{
				map[string]any{"term": map[string]any{"tenant_id": req.TenantID.String()}},
				map[string]any{"term": map[string]any{"kind": string(search.kind)}},
				map[string]any{"term": map[string]any{"surfaces": req.Surface}},
				map[string]any{"range": map[string]any{"published_at": map[string]any{"lte": "now"}}},
			}, filters...),
			"should":               should,
			"minimum_should_match": 1,
		},
	}
}

// sortFor writes the order out for the engine. A backward page scans the same
// order reversed.
//
// A date key names its type for the case where no document of the index has
// the field yet, which the engine otherwise refuses to sort by: a surface's
// latest_episode_at is mapped by the first document that carries one.
func sortFor(order ordering, backward bool) []any {
	direction := func(descending bool) string {
		if descending != backward {
			return "desc"
		}
		return "asc"
	}
	sort := make([]any, 0, len(order.keys)+1)
	for _, key := range order.keys {
		spec := map[string]any{"order": direction(key.descending)}
		if key.typ == dateValue {
			spec["unmapped_type"] = "date_nanos"
		}
		sort = append(sort, map[string]any{key.field: spec})
	}
	return append(sort, map[string]any{"entity_id": map[string]any{"order": direction(order.idDescending)}})
}

func (b *Backend) search(ctx context.Context, req catalogsearch.Request, search kindSearch, identity []string, order ordering, filters []any) (catalogsearch.Page, error) {
	var keys boundary
	if !req.Cursor.IsZero() {
		var err error
		keys, err = decodeBoundary(req.Cursor, identity, order)
		if err != nil {
			return catalogsearch.Page{}, err
		}
	}
	backward := req.Cursor.Direction == pagination.Backward

	body := searchBody{
		Size:  req.Limit + 1,
		Query: queryFor(search, req, queryKey(req.Query), filters),
		Sort:  sortFor(order, backward),
	}
	if keys.valid {
		body.SearchAfter = append(slices.Clone(keys.values), searchAfterID(keys, order.idDescending != backward))
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
		hit, err := hitBoundary(order, raw.Sort)
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
			page.PreviousToken = encodeBoundary(pagination.Backward, identity, hits[0], false)
		}
		if hasNext {
			page.NextToken = encodeBoundary(pagination.Forward, identity, hits[len(hits)-1], false)
		}
	// An empty page past the boundary still hands back a token that includes
	// the boundary hit, so the reader has a way back to where they came from.
	case req.Cursor.Direction == pagination.Forward && !keys.inclusive:
		page.PreviousToken = encodeBoundary(pagination.Backward, identity, keys, true)
	case req.Cursor.Direction == pagination.Backward && !keys.inclusive:
		page.NextToken = encodeBoundary(pagination.Forward, identity, keys, true)
	}
	return page, nil
}

// hitBoundary reads the sort values the engine returned with a hit, which are
// the values of the order sortFor asked for, the id last.
func hitBoundary(order ordering, values []opensearchapi.FieldValue) (boundary, error) {
	if len(values) != len(order.keys)+1 {
		return boundary{}, fmt.Errorf("%d sort values, want %d", len(values), len(order.keys)+1)
	}
	hit := boundary{valid: true, values: make([]any, len(order.keys))}
	for index, key := range order.keys {
		value, err := sortValue(key.typ, values[index])
		if err != nil {
			return boundary{}, fmt.Errorf("sort value %s of %s: %w", values[index].RawJSON(), key.field, err)
		}
		hit.values[index] = value
	}
	rawID, err := values[len(order.keys)].String()
	if err != nil {
		return boundary{}, fmt.Errorf("id sort value %s is not a string", values[len(order.keys)].RawJSON())
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		return boundary{}, fmt.Errorf("id sort value: %w", err)
	}
	hit.id = id
	return hit, nil
}

// sortValue reads one sort value. An instant is read from the JSON as it came,
// an integer of nanoseconds, rather than through a float, which carries
// neither that integer nor the largest or the smallest int64 the engine gives
// a document missing the field back exactly.
func sortValue(typ valueType, value opensearchapi.FieldValue) (any, error) {
	switch typ {
	case scoreValue:
		return value.Float64()
	case dateValue:
		return strconv.ParseInt(string(value.RawJSON()), 10, 64)
	default:
		return value.String()
	}
}
