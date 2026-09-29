package main

import "testing"

// Each job resolves its own variables in order and ends at the shared
// connection. PUBLIRA_WORKER_DB_URL is set throughout every case and must never
// be picked up: it names publira_outbox, the role that owns River's schema, so
// a job has to fall through it rather than adopt it.
func TestEveryDBURLChainResolvesItsOwnVariablesInOrder(t *testing.T) {
	for _, tc := range []struct {
		job     string
		resolve func(string) string
		chain   []string
	}{
		{
			job:     "project-episode-reads",
			resolve: resolveEpisodeReadProjectionDBURL,
			chain: []string{
				"PUBLIRA_EPISODE_READ_PROJECTION_DB_URL",
				"PUBLIRA_CONTENT_EVENTS_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "aggregate-content-stats",
			resolve: resolveContentStatsDBURL,
			chain:   []string{"PUBLIRA_CONTENT_STATS_DB_URL"},
		},
		{
			job:     "aggregate-rankings",
			resolve: resolveRankingDBURL,
			chain: []string{
				"PUBLIRA_CONTENT_RANKING_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "purge-content-events",
			resolve: resolveContentEventsDBURL,
			chain: []string{
				"PUBLIRA_CONTENT_EVENTS_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "purge-mfa-challenges",
			resolve: resolveMfaChallengeDBURL,
			chain: []string{
				"PUBLIRA_MFA_CHALLENGE_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "purge-withdrawn-comments",
			resolve: resolveCommentPurgeDBURL,
			chain: []string{
				"PUBLIRA_COMMENT_PURGE_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "purge-orphan-images",
			resolve: resolveOrphanImagesDBURL,
			chain: []string{
				"PUBLIRA_ORPHAN_IMAGES_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
		{
			job:     "build-recommend-features",
			resolve: resolveRecommendFeaturesDBURL,
			chain: []string{
				"PUBLIRA_RECOMMEND_FEATURES_DB_URL",
				"PUBLIRA_CONTENT_STATS_DB_URL",
			},
		},
	} {
		t.Run(tc.job, func(t *testing.T) {
			t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
			for _, name := range tc.chain {
				t.Setenv(name, "  "+name+"-value  ")
			}
			// Emptying one variable at a time walks the chain, so a link read
			// out of order fails on the step that skipped it.
			for _, name := range tc.chain {
				if got, want := tc.resolve("fallback-url"), name+"-value"; got != want {
					t.Fatalf("URL = %q, want %q", got, want)
				}
				t.Setenv(name, "")
			}
			if got := tc.resolve("fallback-url"); got != "fallback-url" {
				t.Fatalf("URL with the whole chain unset = %q, want fallback-url", got)
			}
		})
	}
}
