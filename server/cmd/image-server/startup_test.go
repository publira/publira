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
// The object store is read from the platform's settings when an image is
// requested, so the process starts before an operator has saved one.
func TestStartsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	addr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_IMAGE_DB_URL":       pg.PublicURL,
		"PUBLIRA_ADMIN_IMAGE_DB_URL": pg.AdminURL,
		"PUBLIRA_IMAGE_SERVER_ADDR":  addr,
	}))
	p.WaitReady(t, "http://"+addr+"/readyz")
}
