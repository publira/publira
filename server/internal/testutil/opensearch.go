package testutil

import (
	"sync"
	"testing"

	"github.com/testcontainers/testcontainers-go"
)

// openSearch runs the image infra/docker/opensearch/Dockerfile builds, which
// adds to the published image the two analysis plugins the catalog index's
// default analysis is built from, and the Korean and Chinese ones the tests of
// a replaced analysis are.
var openSearch = searchEngine{
	name:     "opensearch",
	imageEnv: "PUBLIRA_TEST_OPENSEARCH_IMAGE",
	env: map[string]string{
		"discovery.type":              "single-node",
		"DISABLE_SECURITY_PLUGIN":     "true",
		"DISABLE_INSTALL_DEMO_CONFIG": "true",
		"OPENSEARCH_JAVA_OPTS":        "-Xms512m -Xmx512m",
	},
}

type OpenSearchEnv struct {
	Container testcontainers.Container
	URL       string
}

var (
	sharedOpenSearchMu  sync.Mutex
	sharedOpenSearchEnv *OpenSearchEnv
	// sharedOpenSearchErr is kept only when Docker is unavailable. Any other
	// failure fails the test that started the node, and the next test that
	// asks for one starts it again.
	sharedOpenSearchErr error
)

// StartOpenSearch starts or returns a shared single-node OpenSearch container
// with analysis-kuromoji, analysis-icu, analysis-nori, and analysis-smartcn
// installed and the security plugin off, so it answers plain HTTP without
// credentials. Tests share the node and stay apart by each using an index of
// its own.
//
// The image is PUBLIRA_TEST_OPENSEARCH_IMAGE when that is set, and otherwise
// the one built here from infra/docker/opensearch/Dockerfile.
// Skips when -short is set or Docker is unavailable.
func StartOpenSearch(t *testing.T) *OpenSearchEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping OpenSearch integration test in short mode")
	}

	sharedOpenSearchMu.Lock()
	defer sharedOpenSearchMu.Unlock()

	if sharedOpenSearchEnv != nil {
		return sharedOpenSearchEnv
	}
	if sharedOpenSearchErr != nil {
		t.Skipf("skipping OpenSearch integration test: Docker unavailable: %v", sharedOpenSearchErr)
	}

	container, url, err := openSearch.start()
	if err != nil {
		if isDockerUnavailable(err) {
			sharedOpenSearchErr = err
			t.Skipf("skipping OpenSearch integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("opensearch testcontainer: %v", err)
	}
	sharedOpenSearchEnv = &OpenSearchEnv{Container: container, URL: url}
	return sharedOpenSearchEnv
}
