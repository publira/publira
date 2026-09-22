package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

func TestMain(m *testing.M) {
	if testutil.RunMainIfChild(main) {
		return
	}
	os.Exit(m.Run())
}

// A standard deployment sets bootstrap secrets and infrastructure connections
// and nothing else; every runtime tuning value has to fall back to a default.
// Object storage is not among them: it is saved from the Platform Console this
// process serves, so the process has to start before there is one, and the
// image routes read it when an image is requested.
func TestServerStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	edgeAddr := testutil.FreeAddr(t)
	internalAddr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      edgeAddr,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": internalAddr,
	}), "server")
	p.WaitReady(t, "http://"+edgeAddr+"/readyz")
	p.WaitReady(t, "http://"+internalAddr+"/readyz")

	// The edge names the public pool alone, under the one name an outsider may
	// read; the internal listener names every login it serves.
	assertReadyChecks(t, "http://"+edgeAddr+"/readyz", "db")
	assertReadyChecks(t, "http://"+internalAddr+"/readyz", "db.public", "db.admin", "db.platform")
}

// A password in a redis:// URL would cross the network in cleartext, so the
// process refuses to start rather than falling back to in-process state.
func TestServerRefusesAPasswordOverPlaintextRedis(t *testing.T) {
	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_REDIS_URL": "redis://:secret@redis:6379",
	}), "server")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, "PUBLIRA_REDIS_URL") || !strings.Contains(output, "rediss://") {
		t.Fatalf("output does not name PUBLIRA_REDIS_URL and rediss://:\n%s", output)
	}
}

// The worker starts on the same footing. Object storage is not among what it
// needs either: the orphan image sweep is the only job that needs a bucket,
// and it resolves one from the platform's settings when a run starts.
func TestWorkerStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          addr,
	}), "worker")
	p.WaitReady(t, "http://"+addr+"/readyz")

	// One check per pool: with three logins behind one process, a single "db"
	// could not say which of them stopped answering.
	assertReadyChecks(t, "http://"+addr+"/readyz", "db.outbox", "db.ticker", "db.content_stats")
}

// Without a command the binary is nothing a deployment can run, and it says
// so rather than picking one.
func TestRefusesToStartWithoutACommand(t *testing.T) {
	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets()))
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, "Usage: publira <command>") {
		t.Fatalf("output does not carry the usage text:\n%s", output)
	}
}

// assertReadyChecks fails unless /readyz names exactly the given checks, so a
// pool a listener serves without registering a check of its own is caught
// here rather than by an operator reading an unexplained 503.
func assertReadyChecks(t *testing.T, url string, want ...string) {
	t.Helper()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("readiness request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("readiness request: %v", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	var body struct {
		Checks map[string]struct {
			Status string `json:"status"`
		} `json:"checks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode /readyz: %v", err)
	}
	if len(body.Checks) != len(want) {
		t.Fatalf("checks = %v, want exactly %v", body.Checks, want)
	}
	for _, name := range want {
		check, ok := body.Checks[name]
		if !ok {
			t.Fatalf("checks = %v, want one named %q", body.Checks, name)
		}
		if check.Status != "ok" {
			t.Fatalf("%s status = %q, want ok", name, check.Status)
		}
	}
}
