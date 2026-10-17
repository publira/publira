package opensearchbackend

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

// engineServer answers GET / as OpenSearch does, and GET /_nodes/plugins with
// plugins, whose status is pluginsStatus, from two nodes and as many more
// that failed to answer as failedNodes.
func engineServer(t *testing.T, rootStatus, pluginsStatus, failedNodes int) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/":
			w.WriteHeader(rootStatus)
			_, _ = w.Write([]byte(`{"version":{"number":"3.9.0","distribution":"opensearch"}}`))
		case "/_nodes/plugins":
			w.WriteHeader(pluginsStatus)
			_, _ = fmt.Fprintf(w, `{"_nodes":{"total":%d,"successful":2,"failed":%d},"nodes":{"a":{"plugins":[{"name":"analysis-nori"},{"name":"analysis-icu"}]},"b":{"plugins":[{"name":"analysis-icu"}]}}}`, 2+failedNodes, failedNodes)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func TestProbeEngineListsThePluginsEveryNodeHas(t *testing.T) {
	t.Parallel()

	probe, err := ProbeEngine(context.Background(), Config{URL: engineServer(t, http.StatusOK, http.StatusOK, 0)})
	if err != nil {
		t.Fatalf("ProbeEngine: %v", err)
	}
	if probe.Product != ProductOpenSearch || probe.Version != "3.9.0" || !probe.PluginsListed || !slices.Equal(probe.Plugins, []string{"analysis-icu"}) {
		t.Fatalf("ProbeEngine = %+v, want OpenSearch 3.9.0 with analysis-icu, the one plugin both nodes have", probe)
	}
}

// A user that may build Publira's indices but not ask the cluster about its
// nodes still finds out what the engine is.
func TestProbeEngineAnswersWithoutPluginsTheEngineWillNotList(t *testing.T) {
	t.Parallel()

	for _, status := range []int{http.StatusForbidden, http.StatusUnauthorized, http.StatusNotFound} {
		probe, err := ProbeEngine(context.Background(), Config{URL: engineServer(t, http.StatusOK, status, 0)})
		if err != nil {
			t.Fatalf("ProbeEngine with plugins answering %d: %v", status, err)
		}
		if probe.Product != ProductOpenSearch || probe.PluginsListed || probe.Plugins != nil {
			t.Fatalf("ProbeEngine with plugins answering %d = %+v, want OpenSearch with no plugins listed", status, probe)
		}
	}
}

// A node that failed to answer may lack a plugin the others have, so a list
// without it is no list of what every node has.
func TestProbeEngineLeavesThePluginsUnlistedWhenANodeFailedToAnswer(t *testing.T) {
	t.Parallel()

	probe, err := ProbeEngine(context.Background(), Config{URL: engineServer(t, http.StatusOK, http.StatusOK, 1)})
	if err != nil {
		t.Fatalf("ProbeEngine: %v", err)
	}
	if probe.Product != ProductOpenSearch || probe.PluginsListed || probe.Plugins != nil {
		t.Fatalf("ProbeEngine = %+v, want OpenSearch with no plugins listed", probe)
	}
}

func TestProbeEngineRefusesCredentialsTheEngineRefuses(t *testing.T) {
	t.Parallel()

	if _, err := ProbeEngine(context.Background(), Config{URL: engineServer(t, http.StatusUnauthorized, http.StatusOK, 0)}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("ProbeEngine = %v, want ErrUnauthorized", err)
	}
}
