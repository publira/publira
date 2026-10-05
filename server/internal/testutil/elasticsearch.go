package testutil

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// defaultElasticsearchImage is the one Elasticsearch major the catalog search
// backend is tested against.
const defaultElasticsearchImage = "elasticsearch:9.1.5"

// elasticsearchEntrypoint installs the two analysis plugins the catalog index's
// analyzers are built from before the image's own entrypoint starts the node.
// Like OpenSearch's, the published image ships neither, and a plugin can only
// be installed while the node is stopped.
const elasticsearchEntrypoint = "bin/elasticsearch-plugin install --batch analysis-kuromoji analysis-icu" +
	" && exec /bin/tini -- /usr/local/bin/docker-entrypoint.sh eswrapper"

type ElasticsearchEnv struct {
	Container testcontainers.Container
	URL       string
}

var (
	sharedElasticsearchMu  sync.Mutex
	sharedElasticsearchEnv *ElasticsearchEnv
	sharedElasticsearchErr error
)

// StartElasticsearch starts or returns a shared single-node Elasticsearch
// container with analysis-kuromoji and analysis-icu installed and security off,
// so it answers plain HTTP without credentials, the way StartOpenSearch does
// for OpenSearch. Tests share the node and stay apart by each using an index of
// its own.
// Skips when -short is set or Docker is unavailable.
func StartElasticsearch(t *testing.T) *ElasticsearchEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping Elasticsearch integration test in short mode")
	}

	sharedElasticsearchMu.Lock()
	defer sharedElasticsearchMu.Unlock()

	if sharedElasticsearchEnv != nil || sharedElasticsearchErr != nil {
		if sharedElasticsearchErr != nil {
			if isDockerUnavailable(sharedElasticsearchErr) {
				t.Skipf("skipping Elasticsearch integration test: Docker unavailable: %v", sharedElasticsearchErr)
			}
			t.Fatalf("elasticsearch testcontainer: %v", sharedElasticsearchErr)
		}
		return sharedElasticsearchEnv
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	env, err := startElasticsearch(ctx)
	if err != nil {
		sharedElasticsearchErr = err
		if isDockerUnavailable(err) {
			t.Skipf("skipping Elasticsearch integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("elasticsearch testcontainer: %v", err)
	}
	sharedElasticsearchEnv = env
	return sharedElasticsearchEnv
}

func startElasticsearch(ctx context.Context) (*ElasticsearchEnv, error) {
	req := testcontainers.ContainerRequest{
		Image:        defaultElasticsearchImage,
		Entrypoint:   []string{"sh", "-c", elasticsearchEntrypoint},
		ExposedPorts: []string{"9200/tcp"},
		Env: map[string]string{
			"discovery.type":         "single-node",
			"xpack.security.enabled": "false",
			"ES_JAVA_OPTS":           "-Xms512m -Xmx512m",
		},
		WaitingFor: wait.ForHTTP("/").WithPort("9200/tcp").WithStartupTimeout(4 * time.Minute),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, fmt.Errorf("start elasticsearch container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("elasticsearch host: %w", err)
	}

	port, err := container.MappedPort(ctx, "9200/tcp")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("elasticsearch mapped port: %w", err)
	}

	return &ElasticsearchEnv{
		Container: container,
		URL:       fmt.Sprintf("http://%s:%s", host, port.Port()),
	}, nil
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
