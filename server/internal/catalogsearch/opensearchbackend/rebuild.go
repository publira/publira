package opensearchbackend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"time"

	"github.com/opensearch-project/opensearch-go/v4/opensearchapi"
)

// Rebuild is a new catalog index being filled while searches and writes still
// go to the index the alias names.
type Rebuild struct {
	backend *Backend
	index   string
	// previous are the indices the alias named when the rebuild started.
	previous []string
	// concrete is set where the alias name is itself an index, created under
	// it before the name was an alias. The swap deletes that index in the same
	// step that gives its name to the alias.
	concrete bool
}

// rebuildIndexTime names a rebuilt index after the second it was started in.
const rebuildIndexTime = "20060102150405"

// StartRebuild creates an empty index beside the one the alias names, with the
// definition this build carries.
func (b *Backend) StartRebuild(ctx context.Context) (*Rebuild, error) {
	rebuild := &Rebuild{backend: b, index: b.index + "-" + time.Now().UTC().Format(rebuildIndexTime)}
	previous, err := b.aliasIndices(ctx)
	if err != nil {
		return nil, err
	}
	if len(previous) == 0 {
		concrete, err := b.nameExists(ctx, b.index)
		if err != nil {
			return nil, err
		}
		rebuild.concrete = concrete
	}
	rebuild.previous = previous
	if err := b.createIndex(ctx, rebuild.index, indexDefinition); err != nil {
		return nil, err
	}
	return rebuild, nil
}

// aliasIndices lists the indices the alias names, none where it names none.
func (b *Backend) aliasIndices(ctx context.Context) ([]string, error) {
	resp, err := b.client.Indices.Alias.Get(ctx, opensearchapi.AliasGetReq{Alias: []string{b.index}})
	if resp != nil && resp.Inspect().Response != nil && resp.Inspect().Response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: look up alias %q: %w", b.index, err)
	}
	return slices.Sorted(maps.Keys(resp.GetIndices())), nil
}

// Index is the name of the index being filled.
func (r *Rebuild) Index() string {
	return r.index
}

// PutAll writes docs into the index being filled, the way Backend.PutAll
// writes them into the live one.
func (r *Rebuild) PutAll(ctx context.Context, docs []Document) error {
	return r.backend.write(ctx, r.index, docs)
}

type aliasAction struct {
	Index string `json:"index"`
	Alias string `json:"alias,omitempty"`
}

// Swap moves the alias onto the new index in one request, so no search runs
// against both indices or neither, and then deletes the indices it named
// before. A failure after the move leaves those indices behind and says so;
// the alias is on the new index either way.
func (r *Rebuild) Swap(ctx context.Context) error {
	// A document is only found once the index has been refreshed, and the
	// first search through the alias must not find an empty catalog.
	if _, err := r.backend.client.Indices.Refresh(ctx, &opensearchapi.IndicesRefreshReq{Index: []string{r.index}}); err != nil {
		return fmt.Errorf("opensearchbackend: refresh %q: %w", r.index, err)
	}

	var actions []map[string]aliasAction
	if r.concrete {
		actions = append(actions, map[string]aliasAction{"remove_index": {Index: r.backend.index}})
	}
	for _, index := range r.previous {
		actions = append(actions, map[string]aliasAction{"remove": {Index: index, Alias: r.backend.index}})
	}
	actions = append(actions, map[string]aliasAction{"add": {Index: r.index, Alias: r.backend.index}})
	body, err := json.Marshal(map[string]any{"actions": actions})
	if err != nil {
		return fmt.Errorf("opensearchbackend: encode alias actions: %w", err)
	}
	if _, err := r.backend.client.Aliases(ctx, opensearchapi.AliasesReq{Body: bytes.NewReader(body)}); err != nil {
		return fmt.Errorf("opensearchbackend: move alias %q to %q: %w", r.backend.index, r.index, err)
	}

	if len(r.previous) == 0 {
		return nil
	}
	if _, err := r.backend.client.Indices.Delete(ctx, opensearchapi.IndicesDeleteReq{Indices: r.previous}); err != nil {
		return fmt.Errorf("opensearchbackend: alias %q now names %q, but deleting the indices it named before (%v) failed: %w", r.backend.index, r.index, r.previous, err)
	}
	return nil
}

// Abort deletes the index being filled and leaves the alias where it was.
func (r *Rebuild) Abort(ctx context.Context) error {
	if _, err := r.backend.client.Indices.Delete(ctx, opensearchapi.IndicesDeleteReq{Indices: []string{r.index}}); err != nil {
		return fmt.Errorf("opensearchbackend: delete %q: %w", r.index, err)
	}
	return nil
}
