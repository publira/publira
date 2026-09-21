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
//
// Object storage is not among them. The orphan image sweep is the only job that
// needs a bucket, and refusing to start without one would take the outbox drain
// and the ticker jobs down with a sweep that has nothing to sweep.
func TestStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          addr,
	}))
	p.WaitReady(t, "http://"+addr+"/readyz")

	// One check per pool: with three logins behind one process, a single "db"
	// could not say which of them stopped answering.
	assertReadyChecks(t, "http://"+addr+"/readyz", "db.outbox", "db.ticker", "db.content_stats")

	if out := p.Output(); !strings.Contains(out, "orphan image reclamation is disabled") {
		t.Fatalf("startup log does not report the sweep as disabled:\n%s", out)
	}
}

// With a bucket configured the sweep joins the other maintenance jobs, which is
// what makes object storage a capability of this process rather than of a
// deployment someone schedules separately.
func TestStartsWithObjectStorage(t *testing.T) {
	pg := testutil.StartPostgres(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateBucket(t)
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), s3.DeploymentEnv(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL":        pg.TickerURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          addr,
	}))
	p.WaitReady(t, "http://"+addr+"/readyz")

	if out := p.Output(); !strings.Contains(out, "orphan image reclamation is enabled") {
		t.Fatalf("startup log does not report the sweep as enabled:\n%s", out)
	}
}

// assertReadyChecks fails unless /readyz names exactly the given checks, so a
// pool this process opens without registering a check of its own is caught
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
