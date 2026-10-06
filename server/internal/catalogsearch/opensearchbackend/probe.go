package opensearchbackend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
)

// The products an engine can report itself as.
const (
	ProductOpenSearch    = "OpenSearch"
	ProductElasticsearch = "Elasticsearch"
)

// The analysis plugins every node needs for the default analysis of the
// catalog index.
const (
	PluginAnalysisKuromoji = "analysis-kuromoji"
	PluginAnalysisICU      = "analysis-icu"
)

var (
	// ErrUnreachable is an engine that did not answer at all.
	ErrUnreachable = errors.New("opensearchbackend: the engine does not answer")
	// ErrUnauthorized is an engine that refused the credentials, or asked for
	// some where none were sent.
	ErrUnauthorized = errors.New("opensearchbackend: the engine refused the credentials")
	// ErrUnexpectedAnswer is an answer no search engine gives.
	ErrUnexpectedAnswer = errors.New("opensearchbackend: the answer is not a search engine's")
)

// Probe is what an engine says about itself.
type Probe struct {
	// Product is ProductOpenSearch, ProductElasticsearch, or empty for an
	// engine that names neither.
	Product string
	Version string
	// Plugins holds the plugins installed on every node.
	Plugins []string
}

// HasPlugin reports whether every node has the plugin installed.
func (p Probe) HasPlugin(name string) bool {
	return slices.Contains(p.Plugins, name)
}

// ProbeEngine asks the engine cfg names what it is and which plugins its nodes
// have, without touching any index. A failure wraps ErrUnreachable,
// ErrUnauthorized, or ErrUnexpectedAnswer.
func ProbeEngine(ctx context.Context, cfg Config) (Probe, error) {
	client, err := newClient(cfg)
	if err != nil {
		return Probe{}, err
	}
	request := func(path string, into any) (http.Header, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		if err != nil {
			return nil, fmt.Errorf("opensearchbackend: %w", err)
		}
		resp, err := client.Client.Request(req)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
		}
		defer resp.Body.Close() //nolint:errcheck
		switch {
		case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
			return nil, fmt.Errorf("%w: GET %s answered %d", ErrUnauthorized, path, resp.StatusCode)
		case resp.StatusCode/100 != 2:
			return nil, fmt.Errorf("%w: GET %s answered %d", ErrUnexpectedAnswer, path, resp.StatusCode)
		}
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
		}
		if err := json.Unmarshal(body, into); err != nil {
			return nil, fmt.Errorf("%w: GET %s: %w", ErrUnexpectedAnswer, path, err)
		}
		return resp.Header, nil
	}

	var info struct {
		Version struct {
			Number       string `json:"number"`
			Distribution string `json:"distribution"`
		} `json:"version"`
	}
	header, err := request("/", &info)
	if err != nil {
		return Probe{}, err
	}
	if info.Version.Number == "" {
		return Probe{}, fmt.Errorf("%w: GET / names no version", ErrUnexpectedAnswer)
	}
	probe := Probe{Version: info.Version.Number}
	switch {
	case info.Version.Distribution == "opensearch":
		probe.Product = ProductOpenSearch
	// Elasticsearch names itself in a header rather than in the body, which
	// it shares with the OpenSearch it was forked into.
	case header.Get("X-Elastic-Product") == "Elasticsearch":
		probe.Product = ProductElasticsearch
	}

	var nodes struct {
		Nodes map[string]struct {
			Plugins []struct {
				Name string `json:"name"`
			} `json:"plugins"`
		} `json:"nodes"`
	}
	if _, err := request("/_nodes/plugins", &nodes); err != nil {
		return Probe{}, err
	}
	// A plugin counts once every node has it: an index is created across the
	// cluster, and one node without the analyzer refuses it.
	counts := map[string]int{}
	for _, node := range nodes.Nodes {
		for _, plugin := range node.Plugins {
			counts[plugin.Name]++
		}
	}
	for name, count := range counts {
		if count == len(nodes.Nodes) {
			probe.Plugins = append(probe.Plugins, name)
		}
	}
	slices.Sort(probe.Plugins)
	return probe, nil
}
