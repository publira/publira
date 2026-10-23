package main

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// The two jobs that read content_events take the replica publira worker takes
// for them, and refuse one signed in as another login rather than reading with
// that login's reach. Which of their reads it makes is internal/maintenance's
// to decide; this is the wiring between it and the variable.
func TestRebuildJobsReadTheContentStatsReplica(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)

	for _, job := range []string{"aggregate-content-stats", "build-recommend-features"} {
		t.Run(job, func(t *testing.T) {
			env := func(replicaURL string) []string {
				return testutil.Env(testutil.DeploymentSecrets(), map[string]string{
					"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
					contentStatsDBReplicaURLEnv:    replicaURL,
				})
			}
			if code, output := testutil.RunMain(t, env(pg.StandbyContentStatsURL), "job", job); code != 0 {
				t.Fatalf("exit code = %d, want 0\n%s", code, output)
			}

			code, output := testutil.RunMain(t, env(pg.StandbyPublicURL), "job", job)
			if code == 0 {
				t.Fatalf("exit code = 0 with a replica signed in as publira_public, want a failure\n%s", output)
			}
			if !strings.Contains(output, contentStatsDBReplicaURLEnv) || !strings.Contains(output, "publira_public") {
				t.Fatalf("output does not name %s and the login it signs in as:\n%s", contentStatsDBReplicaURLEnv, output)
			}
		})
	}
}
