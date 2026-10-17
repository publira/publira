package testutil

import (
	"sync"
	"testing"

	"github.com/testcontainers/testcontainers-go"
)

// elasticsearch runs the image infra/docker/elasticsearch/Dockerfile names,
// the published one with no plugin added, so the tests that run on it find
// out what an engine started from the official image does with the default
// analysis.
var elasticsearch = searchEngine{
	name:     "elasticsearch",
	imageEnv: "PUBLIRA_TEST_ELASTICSEARCH_IMAGE",
	env: map[string]string{
		"discovery.type":         "single-node",
		"xpack.security.enabled": "false",
		"ES_JAVA_OPTS":           "-Xms512m -Xmx512m",
	},
}

type ElasticsearchEnv struct {
	Container testcontainers.Container
	URL       string
}

var (
	sharedElasticsearchMu  sync.Mutex
	sharedElasticsearchEnv *ElasticsearchEnv
	// sharedElasticsearchErr is kept only when Docker is unavailable, as
	// sharedOpenSearchErr is.
	sharedElasticsearchErr error
)

// StartElasticsearch starts or returns a shared single-node Elasticsearch
// container with no plugin installed and security off, so it answers plain
// HTTP without credentials, the way StartOpenSearch does for OpenSearch.
// Tests share the node and stay apart by each using an index of its own.
//
// The image is PUBLIRA_TEST_ELASTICSEARCH_IMAGE when that is set, and
// otherwise the one built here from infra/docker/elasticsearch/Dockerfile.
// Skips when -short is set or Docker is unavailable.
func StartElasticsearch(t *testing.T) *ElasticsearchEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping Elasticsearch integration test in short mode")
	}

	sharedElasticsearchMu.Lock()
	defer sharedElasticsearchMu.Unlock()

	if sharedElasticsearchEnv != nil {
		return sharedElasticsearchEnv
	}
	if sharedElasticsearchErr != nil {
		t.Skipf("skipping Elasticsearch integration test: Docker unavailable: %v", sharedElasticsearchErr)
	}

	container, url, err := elasticsearch.start()
	if err != nil {
		if isDockerUnavailable(err) {
			sharedElasticsearchErr = err
			t.Skipf("skipping Elasticsearch integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("elasticsearch testcontainer: %v", err)
	}
	sharedElasticsearchEnv = &ElasticsearchEnv{Container: container, URL: url}
	return sharedElasticsearchEnv
}

// SearchEngine is one engine the catalog search backend is tested against.
type SearchEngine struct {
	// Name is the stored engine name, which is also the subtest's name.
	Name string
	// URL is the node's address, without credentials.
	URL string
	// LanguagePlugins reports whether the node has analysis-kuromoji,
	// analysis-icu, analysis-nori, and analysis-smartcn installed. Without
	// them it is the engine as its official image ships it.
	LanguagePlugins bool
}

// searchEngineNode is one engine's shared node.
type searchEngineNode struct {
	name    string
	start   func(*testing.T) string
	plugins bool
}

var searchEngineNodes = []searchEngineNode{
	{name: "opensearch", start: func(t *testing.T) string { return StartOpenSearch(t).URL }, plugins: true},
	{name: "elasticsearch", start: func(t *testing.T) string { return StartElasticsearch(t).URL }},
}

// EachSearchEngine runs fn once per engine the catalog search backend runs
// on, as a subtest named for the engine, starting each node the first time a
// test asks for it.
func EachSearchEngine(t *testing.T, fn func(t *testing.T, engine SearchEngine)) {
	t.Helper()
	eachSearchEngine(t, false, fn)
}

// EachSearchEngineWithLanguagePlugins is EachSearchEngine on the engines whose
// node has the language plugins [SearchEngine.LanguagePlugins] names, for a
// test of a definition built on one of them.
func EachSearchEngineWithLanguagePlugins(t *testing.T, fn func(t *testing.T, engine SearchEngine)) {
	t.Helper()
	eachSearchEngine(t, true, fn)
}

func eachSearchEngine(t *testing.T, plugins bool, fn func(t *testing.T, engine SearchEngine)) {
	t.Helper()
	for _, engine := range searchEngineNodes {
		if plugins && !engine.plugins {
			continue
		}
		t.Run(engine.name, func(t *testing.T) {
			fn(t, SearchEngine{Name: engine.name, URL: engine.start(t), LanguagePlugins: engine.plugins})
		})
	}
}
