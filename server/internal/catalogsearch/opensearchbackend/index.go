package opensearchbackend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v5"
	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"
)

// The catalog index is the mapping in mappings.json with the analysis the
// platform saved, the default one where it saved none (analysis.go). Every
// tenant shares the one index, and tenant_id is both the filter every search
// carries and the routing key every request is sent with, so a tenant's
// documents sit on one shard and a search reads only that shard.
//
// The configured name is an alias rather than the index itself, so a rebuild
// can fill a new index under a name of its own and move the alias onto it in
// one step.
//
// The title and the name are analyzed twice: as they are written, and in the
// alternate form a query may be typed in, which the reading an administrator
// entered is analyzed in as well. The keyword sub-fields are the exact match
// and the sort key of a ranked search, normalized by the exact-match
// normalizer.
//
// A series also carries what the published series list narrows and sorts by.
// title.sort is the title as it is written, which an explicit title order
// sorts by: the list orders the stored title, so two titles the normalizer
// would fold together are still two places in it. The engine compares it
// code point by code point, the order PostgreSQL gives the list under a C
// collation and under the en_US.utf8 locale the Alpine images run on; a
// database on a linguistic collation orders the list its own way, which the
// engine cannot follow. The instants are date_nanos rather than date because
// the list compares them at PostgreSQL's microsecond precision, and two series
// a millisecond would make equal are two places in it as well.
// latest_episode_at is an object with one instant per surface, mapped by a
// dynamic template under an otherwise strict mapping, so the index names no
// surface of its own: a surface the catalog gains is a key the first document
// on it adds.

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
	// The rest is a series' alone: the facts the published series list narrows
	// and sorts by, in the shape its filters name them. FreeEpisodeSurfaces are
	// the surfaces a free episode of the series is open on, and LatestEpisodeAt
	// the instant of the newest episode published on each surface the series
	// is, its own PublishedAt where there is none. Both change when a free
	// window or a scheduled episode passes its instant, which is why a ticker
	// job queues a sync for the series at each such boundary.
	GenrePublicIDs      []string
	TagSlugs            []string
	Status              string
	ScheduleWeekdays    []int32
	FreeEpisodeSurfaces []string
	LatestEpisodeAt     map[string]time.Time
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

	GenrePublicIDs      []string             `json:"genre_public_ids,omitempty"`
	TagSlugs            []string             `json:"tag_slugs,omitempty"`
	Status              string               `json:"status,omitempty"`
	ScheduleWeekdays    []int32              `json:"schedule_weekdays,omitempty"`
	FreeEpisodeSurfaces []string             `json:"free_episode_surfaces,omitempty"`
	LatestEpisodeAt     map[string]time.Time `json:"latest_episode_at,omitempty"`
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

// EnsureIndex creates the catalog index behind its alias, with the analysis
// the backend was configured with, unless the alias, or an index of that name,
// already exists. What exists is left as it is, its analysis and mappings
// included: changing them is a rebuild, not something a starting process does
// on its own.
func (b *Backend) EnsureIndex(ctx context.Context) error {
	exists, err := b.nameExists(ctx, b.index)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	body, err := indexDefinition(b.analysis, b.index)
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
			source.GenrePublicIDs = doc.GenrePublicIDs
			source.TagSlugs = doc.TagSlugs
			source.Status = doc.Status
			source.ScheduleWeekdays = doc.ScheduleWeekdays
			source.FreeEpisodeSurfaces = doc.FreeEpisodeSurfaces
			if len(doc.LatestEpisodeAt) > 0 {
				source.LatestEpisodeAt = make(map[string]time.Time, len(doc.LatestEpisodeAt))
				for surface, at := range doc.LatestEpisodeAt {
					source.LatestEpisodeAt[surface] = at.UTC()
				}
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
