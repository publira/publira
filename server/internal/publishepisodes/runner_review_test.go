package publishepisodes

import (
	"bytes"
	"context"
	"log/slog"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// requireEpisodeReview turns review on for the environment's tenant.
func (env publishTestEnv) requireEpisodeReview(t *testing.T) {
	t.Helper()
	if _, err := env.pg.DB.ExecContext(context.Background(),
		`INSERT INTO tenant_config (tenant_id, episode_review_required) VALUES ($1, true)
		 ON CONFLICT (tenant_id) DO UPDATE SET episode_review_required = true`,
		env.tenant.ID); err != nil {
		t.Fatalf("turn review on: %v", err)
	}
}

// approveEpisode records a Tenant admin's approval on the listing.
func (env publishTestEnv) approveEpisode(t *testing.T) {
	t.Helper()
	if _, err := env.pg.DB.ExecContext(context.Background(),
		`UPDATE episode_listings SET review_state = 'approved', review_approved_at = NOW() WHERE episode_id = $1`,
		env.episode.ID); err != nil {
		t.Fatalf("approve the episode: %v", err)
	}
}

// With review on, an episode no Tenant admin approved is not due however long
// ago its time passed: it is neither published nor reported as a failure, and
// is published on the first run after it is approved.
func TestPublishHoldsAnEpisodeUntilItIsApproved(t *testing.T) {
	for _, state := range []string{"", "in_review", "returned"} {
		t.Run("review state "+state, func(t *testing.T) {
			pg, env := newPublishTestEnv(t)
			env.requireEpisodeReview(t)
			if state != "" {
				if _, err := pg.DB.ExecContext(context.Background(),
					`UPDATE episode_listings SET review_state = $2 WHERE episode_id = $1`, env.episode.ID, state); err != nil {
					t.Fatalf("set the review state: %v", err)
				}
			}
			var logs bytes.Buffer
			r := New(pg.DB, dbmodels.New(pg.DB), nil, slog.New(slog.NewTextHandler(&logs, nil)), 0)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			r.RunOnce(ctx)

			if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusScheduled {
				t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusScheduled)
			}
			assertNotificationCounts(t, pg, notificationCounts{})
			if bytes.Contains(logs.Bytes(), []byte("level=ERROR")) || bytes.Contains(logs.Bytes(), []byte("level=WARN")) {
				t.Fatalf("an episode waiting for review was logged as a failure: %s", logs.String())
			}

			env.approveEpisode(t)
			r.RunOnce(ctx)

			if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
				t.Fatalf("listing status after approval = %q, want %s", got, testutil.EpisodeStatusPublished)
			}
		})
	}
}

// An episode listed as due and sent back to review before the job promotes it
// is left as the console saved it, as one taken back to a draft is.
func TestPublishLeavesAnEpisodeSentBackToReviewAfterItWasListed(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	env.requireEpisodeReview(t)
	env.approveEpisode(t)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rows, err := r.queries.ListEpisodesReadyToPublishWithTenantInfo(ctx)
	if err != nil {
		t.Fatalf("list due episodes: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("due episodes = %d, want the approved one", len(rows))
	}
	if _, err := pg.DB.ExecContext(ctx,
		`UPDATE episode_listings SET review_state = 'in_review', review_approved_at = NULL WHERE episode_id = $1`,
		env.episode.ID); err != nil {
		t.Fatalf("send the episode back to review: %v", err)
	}

	r.publishEpisodeWithRetry(ctx, rows[0])

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusScheduled {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusScheduled)
	}
	assertNotificationCounts(t, pg, notificationCounts{})
}

// With review off, an episode is published at its time whatever its review
// state says: a state left from when review was on holds nothing back.
func TestPublishIgnoresTheReviewStateWhileReviewIsOff(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	if _, err := pg.DB.ExecContext(context.Background(),
		`UPDATE episode_listings SET review_state = 'returned' WHERE episode_id = $1`, env.episode.ID); err != nil {
		t.Fatalf("set the review state: %v", err)
	}
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
}
