package opensearchbackend

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"
)

// indexDefinition is the settings and mappings of the catalog index. Every
// tenant shares the one index, and tenant_id is both the filter every search
// carries and the routing key every request is sent with, so a tenant's
// documents sit on one shard and a search reads only that shard.
//
// The configured name is an alias rather than the index itself, so a rebuild
// can fill a new index under a name of its own and move the alias onto it in
// one step.
//
// The title and the name are analyzed twice. ja_text keeps the written form:
// the kuromoji tokenizer in search mode splits a compound into its parts as
// well, icu_normalizer (NFKC with case folding) and cjk_width make full-width
// Latin and half-width kana the same token as their usual forms, and
// kuromoji_baseform lets an inflected verb match its dictionary form.
//
// ja_reading is what a query typed in kana meets a title written in kanji
// through, and it is also how an entered reading is analyzed. It replaces each
// token with its reading in katakana, turns the hiragana of a token the
// dictionary has no reading for into katakana, and indexes the result as
// overlapping pairs of characters. The pairs are taken across each two
// neighbouring tokens as well, because the dictionary splits a run of kana
// where it pleases: 「ぎんがてつどう」 comes out as ギン/ガ/テツ/ドウ where
// 「銀河鉄道」 comes out as ギンガ/テツドウ, and only the pairs of the joined
// reading are the same for both.
//
// The keyword sub-fields are the exact match and the sort key, normalized the
// way the text is so neither depends on case or width.
//
//go:embed index.json
var indexDefinition []byte

// Kind is the type of a catalog document.
type Kind string

const (
	KindSeries  Kind = "series"
	KindCreator Kind = "creator"
	KindLabel   Kind = "label"
)

// Document is one searchable row of a tenant's catalog.
type Document struct {
	Kind     Kind
	TenantID uuid.UUID
	ID       uuid.UUID
	// Title and Synopsis are a series' text. Name is a creator's or a label's.
	Title    string
	Synopsis string
	Name     string
	// Reading is the kana reading an administrator entered for the title or
	// the name, and empty where there is none.
	Reading string
	// Surfaces are the surfaces the row is published on, and PublishedAt the
	// instant from which it is; a search only finds it on one of those surfaces
	// once that instant has passed. A creator or a label is published through
	// its series, so it carries every surface one of its published series is
	// on, from the earliest of their instants. That may let a search find it
	// on a surface a moment early, never late, and the handlers drop any hit
	// they cannot show.
	//
	// A row published on no surface is one no search returns, so writing it
	// stores a tombstone in place of its document: the identity and the version
	// with no surface and no text, which every search's surface filter leaves
	// out. A delete would not do, because the engine keeps a deleted document's
	// version only for index.gc_deletes (60s by default), after which a write
	// read before the row was unpublished would bring the document back.
	Surfaces    []string
	PublishedAt time.Time
	// Version orders the writes of one document: a write is refused when the
	// document holds a higher version, so a row read before another write can
	// never overwrite what that write left. It is the instant the row was read
	// at, in microseconds, and equal versions replace each other.
	Version int64
}

type documentSource struct {
	Kind        Kind       `json:"kind"`
	TenantID    string     `json:"tenant_id"`
	EntityID    string     `json:"entity_id"`
	Surfaces    []string   `json:"surfaces"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	Title       string     `json:"title,omitempty"`
	Synopsis    string     `json:"synopsis,omitempty"`
	Name        string     `json:"name,omitempty"`
	Reading     string     `json:"reading,omitempty"`
}

func (k Kind) valid() bool {
	switch k {
	case KindSeries, KindCreator, KindLabel:
		return true
	default:
		return false
	}
}

// documentID keeps the three kinds apart in one index.
func documentID(kind Kind, id uuid.UUID) string {
	return string(kind) + ":" + id.String()
}

// initialIndexSuffix names the index a first start creates behind the alias. A
// fixed name is what keeps two processes starting at once from creating two.
const initialIndexSuffix = "-initial"

// EnsureIndex creates the catalog index behind its alias unless the alias, or
// an index of that name, already exists. What exists is left as it is,
// mappings included: changing them is a rebuild, not something a starting
// process does on its own.
func (b *Backend) EnsureIndex(ctx context.Context) error {
	exists, err := b.nameExists(ctx, b.index)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	body, err := definitionWithAlias(b.index)
	if err != nil {
		return err
	}
	if err := b.createIndex(ctx, b.index+initialIndexSuffix, body); err != nil && !alreadyExists(err) {
		return err
	}
	return nil
}

// nameExists reports whether name is an index or an alias.
func (b *Backend) nameExists(ctx context.Context, name string) (bool, error) {
	resp, err := b.client.Indices.Exists(ctx, &opensearchapi.IndicesExistsReq{Indices: []string{name}})
	if resp != nil && resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("opensearchbackend: look up %q: %w", name, err)
	}
	return true, nil
}

func definitionWithAlias(alias string) ([]byte, error) {
	var definition map[string]json.RawMessage
	if err := json.Unmarshal(indexDefinition, &definition); err != nil {
		return nil, fmt.Errorf("opensearchbackend: decode index definition: %w", err)
	}
	aliases, err := json.Marshal(map[string]any{alias: map[string]any{}})
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: encode alias: %w", err)
	}
	definition["aliases"] = aliases
	body, err := json.Marshal(definition)
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: encode index definition: %w", err)
	}
	return body, nil
}

func (b *Backend) createIndex(ctx context.Context, name string, body []byte) error {
	if _, err := b.client.Indices.Create(ctx, opensearchapi.IndicesCreateReq{
		Index:      name,
		BodyReader: bytes.NewReader(body),
	}); err != nil {
		return fmt.Errorf("opensearchbackend: create index %q: %w", name, err)
	}
	return nil
}

func alreadyExists(err error) bool {
	var structErr *opensearch.StructError
	return errors.As(err, &structErr) && structErr.Err.Type == "resource_already_exists_exception"
}

// Put writes doc, replacing the document of the same row, or a tombstone in
// its place when doc is published on no surface.
func (b *Backend) Put(ctx context.Context, doc Document) error {
	return b.write(ctx, b.index, []Document{doc})
}

// Delete replaces the document of a row with a tombstone, unless the document
// holds a version above the one given.
func (b *Backend) Delete(ctx context.Context, kind Kind, tenantID, id uuid.UUID, version int64) error {
	return b.Put(ctx, Document{Kind: kind, TenantID: tenantID, ID: id, Version: version})
}

// PutAll writes docs the way Put writes each of them.
func (b *Backend) PutAll(ctx context.Context, docs []Document) error {
	return b.write(ctx, b.index, docs)
}

// bulkBatchSize bounds the documents one bulk request carries, so a tenant's
// whole catalog is not one request body.
const bulkBatchSize = 500

// versionType makes a write of an equal version replace the document: two
// reads of one snapshot carry the same row, and either may land last.
const versionType = "external_gte"

type bulkAction struct {
	Index       string `json:"_index"`
	ID          string `json:"_id"`
	Routing     string `json:"routing"`
	Version     int64  `json:"version"`
	VersionType string `json:"version_type"`
}

func (b *Backend) write(ctx context.Context, index string, docs []Document) error {
	for start := 0; start < len(docs); start += bulkBatchSize {
		if err := b.bulk(ctx, index, docs[start:min(start+bulkBatchSize, len(docs))]); err != nil {
			return err
		}
	}
	return nil
}

func (b *Backend) bulk(ctx context.Context, index string, docs []Document) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, doc := range docs {
		if !doc.Kind.valid() {
			return fmt.Errorf("opensearchbackend: unknown document kind %q", doc.Kind)
		}
		action := bulkAction{
			Index:       index,
			ID:          documentID(doc.Kind, doc.ID),
			Routing:     doc.TenantID.String(),
			Version:     doc.Version,
			VersionType: versionType,
		}
		source := documentSource{
			Kind:     doc.Kind,
			TenantID: doc.TenantID.String(),
			EntityID: doc.ID.String(),
			Surfaces: []string{},
		}
		if len(doc.Surfaces) > 0 {
			source.Surfaces = doc.Surfaces
			source.Title = doc.Title
			source.Synopsis = doc.Synopsis
			source.Name = doc.Name
			source.Reading = doc.Reading
			if !doc.PublishedAt.IsZero() {
				at := doc.PublishedAt.UTC()
				source.PublishedAt = &at
			}
		}
		if err := encoder.Encode(map[string]bulkAction{"index": action}); err != nil {
			return fmt.Errorf("opensearchbackend: encode index: %w", err)
		}
		if err := encoder.Encode(source); err != nil {
			return fmt.Errorf("opensearchbackend: encode document: %w", err)
		}
	}

	// A document that refuses its write comes back as a partial failure, with
	// the response still read, so which items failed is taken from the
	// response rather than from the error.
	resp, err := b.client.Doc.Bulk(ctx, opensearchapi.BulkReq{Body: &body})
	var partial *opensearchapi.PartialBulkError
	if err != nil && !errors.As(err, &partial) {
		return fmt.Errorf("opensearchbackend: write to %q: %w", index, err)
	}
	failures := resp.BulkItemFailures()
	if failures == nil {
		return nil
	}
	for _, item := range failures.FailedItems {
		// The document holds a higher version, which is a later read of the
		// row than this one.
		if item.Status == http.StatusConflict {
			continue
		}
		id := ""
		if item.ID != nil {
			id = *item.ID
		}
		reason := item.Error.Type
		if item.Error.Reason != nil {
			reason += ": " + *item.Error.Reason
		}
		return fmt.Errorf("opensearchbackend: index %s in %q: status %d: %s", id, index, item.Status, reason)
	}
	return nil
}
