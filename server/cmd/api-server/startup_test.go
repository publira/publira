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
	s3 := testutil.StartRustFS(t)
	s3.CreateBucket(t)
	edgeAddr := testutil.FreeAddr(t)

	p := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), s3.DeploymentEnv(), map[string]string{
		"PUBLIRA_PUBLIC_DB_URL":        pg.PublicURL,
		"PUBLIRA_ADMIN_DB_URL":         pg.AdminURL,
		"PUBLIRA_PLATFORM_DB_URL":      pg.PlatformURL,
		"PUBLIRA_PUBLIC_API_ADDR":      edgeAddr,
		"PUBLIRA_PUBLIC_API_GRPC_ADDR": testutil.FreeAddr(t),
	}))
	p.WaitReady(t, "http://"+edgeAddr+"/readyz")
}
