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
	"github.com/opensearch-project/opensearch-go/v4"
	"github.com/opensearch-project/opensearch-go/v4/opensearchapi"
)

// indexDefinition is the settings and mappings of the catalog index. Every
// tenant shares the one index, and tenant_id is both the filter every search
// carries and the routing key every request is sent with, so a tenant's
// documents sit on one shard and a search reads only that shard.
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
	Surfaces    []string
	PublishedAt time.Time
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

// EnsureIndex creates the catalog index unless it already exists. An index
// that exists is left as it is, mappings included: changing them is a
// reindex, not something a starting process does on its own.
func (b *Backend) EnsureIndex(ctx context.Context) error {
	_, err := b.client.Indices.Create(ctx, opensearchapi.IndicesCreateReq{
		Index: b.index,
		Body:  bytes.NewReader(indexDefinition),
	})
	var structErr *opensearch.StructError
	if errors.As(err, &structErr) && structErr.Err.Type == "resource_already_exists_exception" {
		return nil
	}
	if err != nil {
		return fmt.Errorf("opensearchbackend: create index %q: %w", b.index, err)
	}
	return nil
}

// Put indexes doc, replacing the document of the same row.
func (b *Backend) Put(ctx context.Context, doc Document) error {
	if !doc.Kind.valid() {
		return fmt.Errorf("opensearchbackend: unknown document kind %q", doc.Kind)
	}
	source := documentSource{
		Kind:     doc.Kind,
		TenantID: doc.TenantID.String(),
		EntityID: doc.ID.String(),
		Surfaces: doc.Surfaces,
		Title:    doc.Title,
		Synopsis: doc.Synopsis,
		Name:     doc.Name,
		Reading:  doc.Reading,
	}
	if !doc.PublishedAt.IsZero() {
		at := doc.PublishedAt.UTC()
		source.PublishedAt = &at
	}
	body, err := json.Marshal(source)
	if err != nil {
		return fmt.Errorf("opensearchbackend: encode document: %w", err)
	}
	if _, err := b.client.Index(ctx, opensearchapi.IndexReq{
		Index:      b.index,
		DocumentID: documentID(doc.Kind, doc.ID),
		Body:       bytes.NewReader(body),
		Params:     opensearchapi.IndexParams{Routing: doc.TenantID.String()},
	}); err != nil {
		return fmt.Errorf("opensearchbackend: index %s: %w", documentID(doc.Kind, doc.ID), err)
	}
	return nil
}

// Delete removes the document of a row. A row that has none is already gone.
func (b *Backend) Delete(ctx context.Context, kind Kind, tenantID, id uuid.UUID) error {
	if !kind.valid() {
		return fmt.Errorf("opensearchbackend: unknown document kind %q", kind)
	}
	resp, err := b.client.Document.Delete(ctx, opensearchapi.DocumentDeleteReq{
		Index:      b.index,
		DocumentID: documentID(kind, id),
		Params:     opensearchapi.DocumentDeleteParams{Routing: tenantID.String()},
	})
	if err != nil {
		if resp != nil && resp.Inspect().Response != nil && resp.Inspect().Response.StatusCode == http.StatusNotFound {
			return nil
		}
		return fmt.Errorf("opensearchbackend: delete %s: %w", documentID(kind, id), err)
	}
	return nil
}
