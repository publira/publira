package main

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// A worker hosting the maintenance queue opens the replica it is given as a
// pool of its own and names it in readiness. One hosting only the search index
// queue, the other job on publira_content_stats, reads nothing on a replica and
// never looks at the variable, so a URL nothing answers on does not stop it.
// Which reads the replica makes is internal/maintenance's to decide; this is
// the wiring between it and the variable.
func TestWorkerOpensTheMaintenanceReplica(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)

	maintenance := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		contentStatsDBReplicaURLEnv:    pg.StandbyContentStatsURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "worker", "--queue", "maintenance")
	base := listenerURL(t, maintenance, "worker")
	maintenance.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.outbox", "db.content_stats", "db.content_stats.replica")

	searchIndex := testutil.StartMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		contentStatsDBReplicaURLEnv:    unreachableDBURL("publira_content_stats"),
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "worker", "--queue", "search_index")
	base = listenerURL(t, searchIndex, "worker")
	searchIndex.WaitReady(t, base+"/readyz")
	assertReadyChecks(t, base+"/readyz", "db.outbox", "db.content_stats")
}

// A replica URL naming another login would read content_events with that
// login's reach, so the worker refuses to start on one.
func TestWorkerRefusesAReplicaSignedInAsAnotherLogin(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)

	code, output := testutil.RunMain(t, testutil.Env(testutil.DeploymentSecrets(), map[string]string{
		"PUBLIRA_WORKER_DB_URL":        pg.OutboxURL,
		"PUBLIRA_CONTENT_STATS_DB_URL": pg.ContentStatsURL,
		contentStatsDBReplicaURLEnv:    pg.StandbyPublicURL,
		"PUBLIRA_WORKER_ADDR":          anyLoopbackPort,
	}, revalidationWithoutPlatformConsole()), "worker", "--queue", "maintenance")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure; output:\n%s", output)
	}
	if !strings.Contains(output, contentStatsDBReplicaURLEnv) || !strings.Contains(output, "publira_public") {
		t.Fatalf("output does not name %s and the login it signs in as:\n%s", contentStatsDBReplicaURLEnv, output)
	}
}
