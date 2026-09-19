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

// A scheduled run sets bootstrap secrets and infrastructure connections and
// nothing else; tuning values and per-run controls have to fall back to defaults.
func TestEverySubcommandRunsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateBucket(t)
	env := testutil.Env(testutil.DeploymentSecrets(), s3.DeploymentEnv(), map[string]string{
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
	})

	for _, cmd := range subcommands {
		t.Run(cmd.name, func(t *testing.T) {
			if code, output := testutil.RunMain(t, env, cmd.name); code != 0 {
				t.Fatalf("exit code = %d, want 0\n%s", code, output)
			}
		})
	}
}
