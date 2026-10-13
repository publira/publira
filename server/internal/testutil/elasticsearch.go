package testutil

import (
	"sync"
	"testing"

	"github.com/testcontainers/testcontainers-go"
)

// elasticsearch runs the image infra/docker/elasticsearch/Dockerfile builds,
// which adds the analysis plugins openSearch has to the published image.
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
// container with the analysis plugins StartOpenSearch installs and security
// off, so it answers plain HTTP without credentials, the way StartOpenSearch
// does for OpenSearch. Tests share the node and stay apart by each using an
// index of its own.
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
}

// EachSearchEngine runs fn once per engine the catalog search backend runs
// on, as a subtest named for the engine, starting each node the first time a
// test asks for it.
func EachSearchEngine(t *testing.T, fn func(t *testing.T, engine SearchEngine)) {
	t.Helper()
	engines := []struct {
		name  string
		start func(*testing.T) string
	}{
		{name: "opensearch", start: func(t *testing.T) string { return StartOpenSearch(t).URL }},
		{name: "elasticsearch", start: func(t *testing.T) string { return StartElasticsearch(t).URL }},
	}
	for _, engine := range engines {
		t.Run(engine.name, func(t *testing.T) {
			fn(t, SearchEngine{Name: engine.name, URL: engine.start(t)})
		})
	}
}
