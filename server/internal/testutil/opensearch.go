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

const defaultOpenSearchImage = "opensearchproject/opensearch:3.9.0"

// openSearchEntrypoint installs the two analysis plugins the catalog index's
// analyzers are built from before the image's own entrypoint starts the node.
// The published image ships neither, and a plugin can only be installed while
// the node is stopped.
const openSearchEntrypoint = "bin/opensearch-plugin install --batch analysis-kuromoji analysis-icu" +
	" && exec ./opensearch-docker-entrypoint.sh opensearch"

type OpenSearchEnv struct {
	Container testcontainers.Container
	URL       string
}

var (
	sharedOpenSearchMu  sync.Mutex
	sharedOpenSearchEnv *OpenSearchEnv
	sharedOpenSearchErr error
)

// StartOpenSearch starts or returns a shared single-node OpenSearch container
// with analysis-kuromoji and analysis-icu installed and the security plugin
// off, so it answers plain HTTP without credentials. Tests share the node and
// stay apart by each using an index of its own.
// Skips when -short is set or Docker is unavailable.
func StartOpenSearch(t *testing.T) *OpenSearchEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping OpenSearch integration test in short mode")
	}

	sharedOpenSearchMu.Lock()
	defer sharedOpenSearchMu.Unlock()

	if sharedOpenSearchEnv != nil || sharedOpenSearchErr != nil {
		if sharedOpenSearchErr != nil {
			if isDockerUnavailable(sharedOpenSearchErr) {
				t.Skipf("skipping OpenSearch integration test: Docker unavailable: %v", sharedOpenSearchErr)
			}
			t.Fatalf("opensearch testcontainer: %v", sharedOpenSearchErr)
		}
		return sharedOpenSearchEnv
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	env, err := startOpenSearch(ctx)
	if err != nil {
		sharedOpenSearchErr = err
		if isDockerUnavailable(err) {
			t.Skipf("skipping OpenSearch integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("opensearch testcontainer: %v", err)
	}
	sharedOpenSearchEnv = env
	return sharedOpenSearchEnv
}

func startOpenSearch(ctx context.Context) (*OpenSearchEnv, error) {
	req := testcontainers.ContainerRequest{
		Image:        defaultOpenSearchImage,
		Entrypoint:   []string{"sh", "-c", openSearchEntrypoint},
		ExposedPorts: []string{"9200/tcp"},
		Env: map[string]string{
			"discovery.type":              "single-node",
			"DISABLE_SECURITY_PLUGIN":     "true",
			"DISABLE_INSTALL_DEMO_CONFIG": "true",
			"OPENSEARCH_JAVA_OPTS":        "-Xms512m -Xmx512m",
		},
		WaitingFor: wait.ForHTTP("/").WithPort("9200/tcp").WithStartupTimeout(4 * time.Minute),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, fmt.Errorf("start opensearch container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("opensearch host: %w", err)
	}

	port, err := container.MappedPort(ctx, "9200/tcp")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("opensearch mapped port: %w", err)
	}

	return &OpenSearchEnv{
		Container: container,
		URL:       fmt.Sprintf("http://%s:%s", host, port.Port()),
	}, nil
}
