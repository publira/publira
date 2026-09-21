package main

import (
	"os"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/storage"
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
// The bucket purge-orphan-images sweeps comes from the platform's settings.
func TestEverySubcommandRunsWithOnlySecretsAndInfrastructure(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateBucket(t)
	s3.SavePlatformStorage(t, pg.DB, s3.Bucket)
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

// A platform with no object store saved has no bucket to sweep, and the run
// says so and fails rather than succeeding over nothing.
func TestPurgeOrphanImagesFailsWithoutPlatformStorage(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	env := testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
	})

	code, output := testutil.RunMain(t, env, "purge-orphan-images")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure\n%s", output)
	}
	if !strings.Contains(output, storage.ErrNotConfigured.Error()) {
		t.Fatalf("output does not name the missing configuration:\n%s", output)
	}
}
