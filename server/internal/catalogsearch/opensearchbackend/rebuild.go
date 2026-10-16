package opensearchbackend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"
)

// Rebuild is a new catalog index for each language being filled while
// searches and writes still go to the indices the aliases name.
type Rebuild struct {
	backend *Backend
	// indices name the index being filled behind each alias.
	indices map[string]string
	// previous are the indices each alias named when the rebuild started.
	previous map[string][]string
	// concrete holds the aliases whose name is itself an index, created under
	// it before the name was an alias. The swap deletes that index in the same
	// step that gives its name to the alias.
	concrete map[string]bool
}

// rebuildIndexTime names a rebuilt index after the millisecond it was started
// in, digits alone. A second would let a rebuild that follows another closely,
// such as the build of a saved analysis and a reindex run right after it, ask
// for the name the first one took.
const rebuildIndexTime = "20060102150405.000"

// StartRebuild creates an empty index beside the one each alias names, with
// the mapping this build carries and the analysis the backend was configured
// with for its language. An alias that names nothing yet, such as that of a
// language the catalog had no index for, gets one too, and the swap gives it
// its first.
func (b *Backend) StartRebuild(ctx context.Context) (*Rebuild, error) {
	suffix := "-" + strings.Replace(time.Now().UTC().Format(rebuildIndexTime), ".", "", 1)
	rebuild := &Rebuild{backend: b, indices: map[string]string{}, previous: map[string][]string{}, concrete: map[string]bool{}}
	for _, t := range b.targets() {
		body, err := indexDefinition(b.analysisOf(t), "")
		if err != nil {
			return nil, rebuild.abortAfter(ctx, err)
		}
		previous, err := b.aliasIndices(ctx, t.alias)
		if err != nil {
			return nil, rebuild.abortAfter(ctx, err)
		}
		if len(previous) == 0 {
			concrete, err := b.nameExists(ctx, t.alias)
			if err != nil {
				return nil, rebuild.abortAfter(ctx, err)
			}
			rebuild.concrete[t.alias] = concrete
		}
		rebuild.previous[t.alias] = previous
		index := t.alias + suffix
		if err := b.createIndex(ctx, index, body); err != nil {
			return nil, rebuild.abortAfter(ctx, err)
		}
		rebuild.indices[t.alias] = index
	}
	return rebuild, nil
}

// abortAfter deletes the indices a start that failed with err had created.
func (r *Rebuild) abortAfter(ctx context.Context, err error) error {
	if len(r.indices) == 0 {
		return err
	}
	if abortErr := r.Abort(context.WithoutCancel(ctx)); abortErr != nil {
		return errors.Join(err, abortErr)
	}
	return err
}

// aliasIndices lists the indices alias names, none where it names none.
func (b *Backend) aliasIndices(ctx context.Context, alias string) ([]string, error) {
	resp, err := b.client.Indices.GetAlias(ctx, &opensearchapi.IndicesGetAliasReq{Name: []string{alias}})
	if resp != nil && resp.Inspect().Response != nil && resp.Inspect().Response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: look up alias %q: %w", alias, err)
	}
	return slices.Sorted(maps.Keys(resp.Entries)), nil
}

// Indices are the names of the indices being filled, in name order.
func (r *Rebuild) Indices() []string {
	return slices.Sorted(maps.Values(r.indices))
}

// PutAll writes docs into the indices being filled, the way Backend.PutAll
// writes them into the live ones.
func (r *Rebuild) PutAll(ctx context.Context, docs []Document) error {
	return r.backend.write(ctx, func(t target) string { return r.indices[t.alias] }, docs, "")
}

type aliasAction struct {
	Index string `json:"index"`
	Alias string `json:"alias,omitempty"`
}

// Swap moves every alias onto its new index in one request, so no search runs
// against an old index of one language and a new one of another, or against
// none, and then deletes the indices the aliases named before. A failure after
// the move leaves those indices behind and says so; the aliases are on the new
// indices either way.
func (r *Rebuild) Swap(ctx context.Context) error {
	indices := r.Indices()
	// A document is only found once the index has been refreshed, and the
	// first search through an alias must not find an empty catalog.
	if _, err := r.backend.client.Indices.Refresh(ctx, &opensearchapi.IndicesRefreshReq{Indices: indices}); err != nil {
		return fmt.Errorf("opensearchbackend: refresh %v: %w", indices, err)
	}

	var actions []map[string]aliasAction
	var previous []string
	for _, t := range r.backend.targets() {
		if r.concrete[t.alias] {
			actions = append(actions, map[string]aliasAction{"remove_index": {Index: t.alias}})
		}
		for _, index := range r.previous[t.alias] {
			actions = append(actions, map[string]aliasAction{"remove": {Index: index, Alias: t.alias}})
		}
		actions = append(actions, map[string]aliasAction{"add": {Index: r.indices[t.alias], Alias: t.alias}})
		previous = append(previous, r.previous[t.alias]...)
	}
	body, err := json.Marshal(map[string]any{"actions": actions})
	if err != nil {
		return fmt.Errorf("opensearchbackend: encode alias actions: %w", err)
	}
	if _, err := r.backend.client.Indices.UpdateAliases(ctx, &opensearchapi.IndicesUpdateAliasesReq{BodyReader: bytes.NewReader(body)}); err != nil {
		return fmt.Errorf("opensearchbackend: move the aliases behind %q to %v: %w", r.backend.index, indices, err)
	}

	if len(previous) == 0 {
		return nil
	}
	if _, err := r.backend.client.Indices.Delete(ctx, &opensearchapi.IndicesDeleteReq{Indices: previous}); err != nil {
		return fmt.Errorf("opensearchbackend: the aliases behind %q now name %v, but deleting the indices they named before (%v) failed: %w", r.backend.index, indices, previous, err)
	}
	return nil
}

// Abort deletes the indices being filled and leaves the aliases where they
// were.
func (r *Rebuild) Abort(ctx context.Context) error {
	indices := r.Indices()
	if _, err := r.backend.client.Indices.Delete(ctx, &opensearchapi.IndicesDeleteReq{Indices: indices}); err != nil {
		return fmt.Errorf("opensearchbackend: delete %v: %w", indices, err)
	}
	return nil
}
