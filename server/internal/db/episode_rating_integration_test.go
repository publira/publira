package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// seedRating stores one reader's rating directly, the way the trigger and
// the policies see it, without going through the handler.
func seedRating(t *testing.T, ctx context.Context, db *sql.DB, tenantID, userID, episodeID uuid.UUID, score int) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score)
		VALUES ($1, $2, $3, $4)
	`, tenantID, userID, episodeID, score); err != nil {
		t.Fatalf("seed rating: %v", err)
	}
}

// ratingCount reads the stored tally, answering -1 for an episode with no row so
// a missing count cannot be mistaken for a zero one.
func ratingCount(t *testing.T, ctx context.Context, db *sql.DB, tenantID, episodeID uuid.UUID) int64 {
	t.Helper()
	var count int64
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT count FROM episode_rating_counts WHERE tenant_id = $1 AND episode_id = $2
		), -1)
	`, tenantID, episodeID).Scan(&count); err != nil {
		t.Fatalf("read the rating count: %v", err)
	}
	return count
}

// A rating is the reader's own row: another member of the same tenant can
// neither see it nor write one in their name, which is what keeps the public
// tally in episode_rating_counts the only number anybody reads off someone
// else's ratings.
func TestEpisodeRatingsEnforceTenantAndMemberIsolation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TRTA", "rating-a.example.com", "admin-rating-a.example.com", "Tenant Rating A")
	member := mustInsertUser(t, ctx, pg.DB, tenantID, "URTA", "member-rating-a@example.com", "Member A")
	other := mustInsertUser(t, ctx, pg.DB, tenantID, "URTB", "member-rating-b@example.com", "Member B")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "ERTA", "Episode A")
	seedRating(t, ctx, pg.DB, tenantID, member, episodeID, 3)

	withMemberConn(t, pg, tenantID, other, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM episode_ratings").Scan(&visible); err != nil {
			t.Fatalf("count ratings as the other member: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other member visible ratings = %d, want 0", visible)
		}
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score)
			VALUES ($1, $2, $3, 1)
		`, tenantID, member, episodeID); err == nil {
			t.Fatal("inserted a rating in another member's name")
		}
		raised, err := conn.ExecContext(ctx,
			"UPDATE episode_ratings SET score = 5 WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3",
			tenantID, member, episodeID)
		if err != nil {
			t.Fatalf("attempt to raise another member's rating: %v", err)
		}
		affected, err := raised.RowsAffected()
		if err != nil {
			t.Fatalf("rows affected: %v", err)
		}
		if affected != 0 {
			t.Fatalf("raised another member's ratings = %d, want 0", affected)
		}
	})

	withMemberConn(t, pg, tenantID, member, func(ctx context.Context, conn *sql.Conn) {
		var score int
		if err := conn.QueryRowContext(ctx, "SELECT score FROM episode_ratings").Scan(&score); err != nil {
			t.Fatalf("read own rating: %v", err)
		}
		if score != 3 {
			t.Fatalf("own score = %d, want 3", score)
		}
	})
}

// The tally is not a member's own row, so it answers every connection scoped to
// the tenant that owns it and none scoped to another.
func TestEpisodeRatingCountsAreTenantScoped(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TRTC", "rating-c.example.com", "admin-rating-c.example.com", "Tenant Rating C")
	rating := mustInsertUser(t, ctx, pg.DB, tenantID, "URTC", "member-rating-c@example.com", "Member C")
	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "URTD", "member-rating-d@example.com", "Member D")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "ERTC", "Episode C")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "TRTD", "rating-d.example.com", "admin-rating-d.example.com", "Tenant Rating D")
	otherMember := mustInsertUser(t, ctx, pg.DB, otherTenantID, "URTE", "member-rating-e@example.com", "Member E")
	seedRating(t, ctx, pg.DB, tenantID, rating, episodeID, 5)

	// A member who rated nothing still reads the tally, and cannot see the
	// rating it was built from.
	withMemberConn(t, pg, tenantID, reader, func(ctx context.Context, conn *sql.Conn) {
		var count int64
		if err := conn.QueryRowContext(ctx,
			"SELECT count FROM episode_rating_counts WHERE episode_id = $1", episodeID).Scan(&count); err != nil {
			t.Fatalf("read the tally as a member who rated nothing: %v", err)
		}
		if count != 1 {
			t.Fatalf("count = %d, want 1", count)
		}
		var visibleRatings int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM episode_ratings").Scan(&visibleRatings); err != nil {
			t.Fatalf("count visible ratings: %v", err)
		}
		if visibleRatings != 0 {
			t.Fatalf("another member's visible ratings = %d, want 0", visibleRatings)
		}
	})

	withMemberConn(t, pg, otherTenantID, otherMember, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM episode_rating_counts").Scan(&visible); err != nil {
			t.Fatalf("count another tenant's tallies: %v", err)
		}
		if visible != 0 {
			t.Fatalf("another tenant's visible tallies = %d, want 0", visible)
		}
	})

	// The tally belongs to the episode, so it goes when the episode does.
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM episodes WHERE id = $1", episodeID); err != nil {
		t.Fatalf("delete the episode: %v", err)
	}
	var remaining int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM episode_rating_counts WHERE tenant_id = $1", tenantID).Scan(&remaining); err != nil {
		t.Fatalf("count remaining tallies: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("tallies left after the episode was deleted = %d, want 0", remaining)
	}
}

// The tally counts readers, not points: raising a score leaves it alone, and a
// deleted account lowers it. The second half is why it is kept by a trigger —
// that delete is the cascade's, with no handler of ours on the path.
func TestEpisodeRatingCountsCountReadersAndFollowEveryDelete(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TRTE", "rating-e.example.com", "admin-rating-e.example.com", "Tenant Rating E")
	leaving := mustInsertUser(t, ctx, pg.DB, tenantID, "URTF", "member-rating-f@example.com", "Member F")
	staying := mustInsertUser(t, ctx, pg.DB, tenantID, "URTG", "member-rating-g@example.com", "Member G")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "ERTE", "Episode E")

	seedRating(t, ctx, pg.DB, tenantID, leaving, episodeID, 1)
	seedRating(t, ctx, pg.DB, tenantID, staying, episodeID, 1)
	if got := ratingCount(t, ctx, pg.DB, tenantID, episodeID); got != 2 {
		t.Fatalf("count after two readers rated = %d, want 2", got)
	}

	// One of them presses their way up. They are still one reader.
	if _, err := pg.DB.ExecContext(ctx,
		"UPDATE episode_ratings SET score = 5 WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3",
		tenantID, staying, episodeID); err != nil {
		t.Fatalf("raise the score: %v", err)
	}
	if got := ratingCount(t, ctx, pg.DB, tenantID, episodeID); got != 2 {
		t.Fatalf("count after a score was raised = %d, want 2", got)
	}

	// The other deletes their account. DeleteMe hard-deletes the row, so the
	// rating goes with it and the tally has to go with the rating.
	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", leaving); err != nil {
		t.Fatalf("delete the account: %v", err)
	}
	if got := ratingCount(t, ctx, pg.DB, tenantID, episodeID); got != 1 {
		t.Fatalf("count after the account was deleted = %d, want 1", got)
	}
}

// Every press files its own event carrying the points it added, so a day's
// aggregate sums what readers gave rather than counting how often they pressed.
// The event type is the one content_events has always had for a 1-5 score.
func TestInsertRatingEventCarriesThePressPoints(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "RTE00001")
	queries := dbmodels.New(pg.DB)
	pressedAt := time.Date(2026, time.September, 4, 5, 6, 7, 0, time.UTC)

	event, err := queries.InsertRatingEvent(ctx, dbmodels.InsertRatingEventParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    seed.tenantID,
		UserID:      seed.userID,
		SeriesID:    seed.seriesID,
		EpisodeID:   nullUUID(seed.episodeID),
		RatingScore: 5,
		OccurredAt:  pressedAt,
	})
	if err != nil {
		t.Fatalf("insert the rating event: %v", err)
	}
	if event.EventType != "rating" {
		t.Fatalf("event_type = %q, want rating", event.EventType)
	}
	if !event.EpisodeID.Valid || event.EpisodeID.UUID != seed.episodeID {
		t.Fatalf("episode_id = %v, want %s", event.EpisodeID, seed.episodeID)
	}
	if !event.RatingScore.Valid || event.RatingScore.Int16 != 5 {
		t.Fatalf("points = %v, want 5", event.RatingScore)
	}
	if !event.OccurredAt.Equal(pressedAt) {
		t.Fatalf("occurred_at = %s, want %s", event.OccurredAt, pressedAt)
	}

	// Append-only: a second press files a second event rather than replacing
	// the first, and the day holds the sum of both.
	if _, err := queries.InsertRatingEvent(ctx, dbmodels.InsertRatingEventParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    seed.tenantID,
		UserID:      seed.userID,
		SeriesID:    seed.seriesID,
		EpisodeID:   nullUUID(seed.episodeID),
		RatingScore: 1,
		OccurredAt:  pressedAt.Add(time.Minute),
	}); err != nil {
		t.Fatalf("insert the second rating event: %v", err)
	}
	var points int64
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT COALESCE(sum(rating_score), 0) FROM content_events
		WHERE tenant_id = $1 AND event_type = 'rating' AND episode_id = $2
	`, seed.tenantID, seed.episodeID).Scan(&points); err != nil {
		t.Fatalf("sum the rating points: %v", err)
	}
	if points != 6 {
		t.Fatalf("rating points = %d, want 6", points)
	}
}

// The press mode is the series' answer when it has one, and the tenant's
// otherwise. Neither row existing is not a statement either way.
func TestGetEpisodeRatingModeFallsBackFromSeriesToTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "LKM00001")
	queries := dbmodels.New(pg.DB)
	params := dbmodels.GetEpisodeRatingModeParams{TenantID: seed.tenantID, EpisodeID: seed.episodeID}

	mode, err := queries.GetEpisodeRatingMode(ctx, params)
	if err != nil {
		t.Fatalf("read the mode with no rows to read: %v", err)
	}
	if mode != "single" {
		t.Fatalf("mode with neither row = %q, want single", mode)
	}

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, episode_rating_mode) VALUES ($1, 'multiple')
		ON CONFLICT (tenant_id) DO UPDATE SET episode_rating_mode = 'multiple'
	`, seed.tenantID); err != nil {
		t.Fatalf("set the tenant mode: %v", err)
	}
	mode, err = queries.GetEpisodeRatingMode(ctx, params)
	if err != nil {
		t.Fatalf("read the tenant mode: %v", err)
	}
	if mode != "multiple" {
		t.Fatalf("mode from the tenant = %q, want multiple", mode)
	}

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_listings (series_id, tenant_id, episode_rating_mode) VALUES ($1, $2, 'single')
		ON CONFLICT (series_id) DO UPDATE SET episode_rating_mode = 'single'
	`, seed.seriesID, seed.tenantID); err != nil {
		t.Fatalf("set the series mode: %v", err)
	}
	mode, err = queries.GetEpisodeRatingMode(ctx, params)
	if err != nil {
		t.Fatalf("read the series mode: %v", err)
	}
	if mode != "single" {
		t.Fatalf("mode from the series = %q, want single (the series overrides its tenant)", mode)
	}
}
