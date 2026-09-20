package main

import (
	"os"
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
func TestStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL": pg.OutboxURL,
		"PUBLIRA_TICKER_DB_URL": pg.TickerURL,
		"PUBLIRA_WORKER_ADDR":   addr,
	}))
	p.WaitReady(t, "http://"+addr+"/readyz")
}
