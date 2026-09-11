package dbtest

import (
	"context"
	"database/sql"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// The imagined completed reads GetSeriesRating pulls a young series towards the
// tenant's mean with. The query holds the same number; a test that derived its
// expectations from a constant of its own would pass whatever the query did.
const seriesRatingPriorReads = 20.0

// seedSeriesDailyStats writes one day of a series' aggregates, which is where
// the figure a series is rated at comes from. Reaction points and completed
// reads are the only two columns it reads, so the rest of the row stays at
// zero.
func seedSeriesDailyStats(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, seriesID uuid.UUID,
	day string,
	points, completedReads int64,
) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_daily_stats (
			id, tenant_id, stat_date, entity_type, entity_id,
			complete_count, rating_count, rating_sum
		)
		VALUES ($1, $2, $3::date, 'series', $4, $5, $6, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, day, seriesID, completedReads, points, points); err != nil {
		t.Fatalf("seed daily stats for %s: %v", day, err)
	}
}

// seriesRatingCount reads the stored headcount, answering -1 for a series with
// no row so a missing tally cannot be mistaken for an empty one.
func seriesRatingCount(t *testing.T, ctx context.Context, db *sql.DB, tenantID, seriesID uuid.UUID) int64 {
	t.Helper()
	var count int64
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT count FROM series_rating_counts WHERE tenant_id = $1 AND series_id = $2
		), -1)
	`, tenantID, seriesID).Scan(&count); err != nil {
		t.Fatalf("read the series rating count: %v", err)
	}
	return count
}

// mustInsertEpisodeOfSeries adds one more episode to a series that already
// exists, which is what a reader works through when they react several times to
// the same work.
func mustInsertEpisodeOfSeries(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, seriesID uuid.UUID,
	publicID string,
	orderIndex int,
) uuid.UUID {
	t.Helper()
	episodeID := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, episodeID, seriesID, publicID, publicID, orderIndex, tenantID); err != nil {
		t.Fatalf("insert episode %s: %v", publicID, err)
	}
	return episodeID
}

// shrunkRating repeats the query's arithmetic, so a test states the figure it
// expects rather than accepting whichever number the query returned.
func shrunkRating(tenantPoints, tenantReads, seriesPoints, seriesReads float64) float64 {
	tenantMean := 0.0
	if tenantReads > 0 {
		tenantMean = tenantPoints / tenantReads
	}
	figure := (seriesRatingPriorReads*tenantMean + seriesPoints) / (seriesRatingPriorReads + seriesReads)
	return math.Round(math.Min(5, math.Max(1, figure))*10) / 10
}

func assertRatingAverage(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.0001 {
		t.Fatalf("rating average = %v, want %v", got, want)
	}
}

// A series is rated by the reaction points its episodes collected over the
// reads those episodes were finished on, so a series whose readers reacted
// warmly stands above one whose readers mostly finished in silence, however
// many of them there were.
func TestSeriesRatingIsReactionPointsOverCompletedReads(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRA", "series-rating-a.example.com", "admin-series-rating-a.example.com", "Tenant Series Rating A")
	belovedID, belovedEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SBELOVED001", "EBELOVED001")
	quietID, quietEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SQUIET00001", "EQUIET00001")

	// Two days each, so the figure is shown to come from the sum of the days
	// rather than from whichever row the query happened to read.
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, belovedID, "2026-09-01", 900, 200)
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, belovedID, "2026-09-02", 600, 200)
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, quietID, "2026-09-01", 300, 400)
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, quietID, "2026-09-02", 300, 400)

	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRA", "reader-a@example.com", "Reader A")
	seedRating(t, ctx, pg.DB, tenantID, reader, belovedEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, reader, quietEpisodeID, 5)

	queries := dbmodels.New(pg.DB)
	tenantPoints, tenantReads := 2100.0, 1200.0

	beloved, err := queries.GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: belovedID})
	if err != nil {
		t.Fatalf("get the beloved series rating: %v", err)
	}
	assertRatingAverage(t, beloved.RatingAverage, shrunkRating(tenantPoints, tenantReads, 1500, 400))

	quiet, err := queries.GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: quietID})
	if err != nil {
		t.Fatalf("get the quiet series rating: %v", err)
	}
	assertRatingAverage(t, quiet.RatingAverage, shrunkRating(tenantPoints, tenantReads, 600, 800))

	if beloved.RatingAverage <= quiet.RatingAverage {
		t.Fatalf("beloved series rating = %v, quiet = %v, want the beloved one higher", beloved.RatingAverage, quiet.RatingAverage)
	}
}

// The figure is pulled towards the tenant's own mean while few readers have
// finished anything, so two readers who both gave everything they could do not
// put a series above one thousands of readers rated just as warmly.
func TestSeriesRatingShrinksTowardsTheTenantMeanWhileFewReadersFinished(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRB", "series-rating-b.example.com", "admin-series-rating-b.example.com", "Tenant Series Rating B")
	newcomerID, newcomerEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SNEW000001", "ENEW000001")
	establishedID, establishedEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SESTAB0001", "EESTAB0001")

	// The same rate on both: every reader who finished an episode gave the
	// whole five. Only the number of readers behind it differs.
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, newcomerID, "2026-09-01", 10, 2)
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, establishedID, "2026-09-01", 20000, 4000)
	// The rest of the catalogue, where most readers finish an episode without
	// reacting. It is what the tenant's mean is mostly made of, so a series with
	// two readers behind it is pulled a long way down towards it and one with
	// four thousand is barely moved.
	quietID, _ := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SQUIET0001", "EQUIET0001")
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, quietID, "2026-09-01", 1000, 10000)

	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRB", "reader-b@example.com", "Reader B")
	seedRating(t, ctx, pg.DB, tenantID, reader, newcomerEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, reader, establishedEpisodeID, 5)

	queries := dbmodels.New(pg.DB)
	newcomer, err := queries.GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: newcomerID})
	if err != nil {
		t.Fatalf("get the newcomer series rating: %v", err)
	}
	established, err := queries.GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: establishedID})
	if err != nil {
		t.Fatalf("get the established series rating: %v", err)
	}

	tenantPoints, tenantReads := 21010.0, 14002.0
	assertRatingAverage(t, newcomer.RatingAverage, shrunkRating(tenantPoints, tenantReads, 10, 2))
	assertRatingAverage(t, established.RatingAverage, shrunkRating(tenantPoints, tenantReads, 20000, 4000))
	if newcomer.RatingAverage >= established.RatingAverage {
		t.Fatalf("two-reader series rating = %v, thousands-of-readers series rating = %v, want the second one higher",
			newcomer.RatingAverage, established.RatingAverage)
	}
	if newcomer.RatingAverage >= 5 {
		t.Fatalf("two-reader series rating = %v, want it held below the top of the scale", newcomer.RatingAverage)
	}
}

// The figure stays on the scale the reactions are given on. A reader who
// finishes an episode without reacting counts in the divisor and gives no
// points, so the rate on its own falls under the bottom of that scale.
func TestSeriesRatingStaysOnTheOneToFiveScale(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRC", "series-rating-c.example.com", "admin-series-rating-c.example.com", "Tenant Series Rating C")
	seriesID, episodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SSILENT001", "ESILENT001")

	// One reader in a thousand reacted, which is a rate far under the bottom of
	// the scale before it is held to one.
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, seriesID, "2026-09-01", 5, 1000)
	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRC", "reader-c@example.com", "Reader C")
	seedRating(t, ctx, pg.DB, tenantID, reader, episodeID, 5)

	rating, err := dbmodels.New(pg.DB).GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: seriesID})
	if err != nil {
		t.Fatalf("get the series rating: %v", err)
	}
	assertRatingAverage(t, rating.RatingAverage, 1)
}

// A series nobody has reacted to has no figure, which is not the same as the
// worst one. Both halves of the answer are withheld together, so a page never
// has a headcount to show beside a figure that is not there.
func TestSeriesWithNoReactionsHasNoRating(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRD", "series-rating-d.example.com", "admin-series-rating-d.example.com", "Tenant Series Rating D")
	seriesID, _ := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SUNRATED01", "EUNRATED01")
	seedSeriesDailyStats(t, ctx, pg.DB, tenantID, seriesID, "2026-09-01", 0, 400)

	rating, err := dbmodels.New(pg.DB).GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: tenantID, SeriesID: seriesID})
	if err != nil {
		t.Fatalf("get the series rating: %v", err)
	}
	assertRatingAverage(t, rating.RatingAverage, 0)
	if rating.RatingCount != 0 {
		t.Fatalf("rating count = %d, want 0", rating.RatingCount)
	}
}

// The headcount beside the figure counts readers, not reactions: a reader who
// works through a whole series says one thing about it however many episodes
// they pressed on.
func TestSeriesRatingCountsEachReaderOnce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRE", "series-rating-e.example.com", "admin-series-rating-e.example.com", "Tenant Series Rating E")
	seriesID, firstEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SMANY00001", "EMANY00001")
	secondEpisodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "EMANY00002", 2)
	thirdEpisodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "EMANY00003", 3)

	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != -1 {
		t.Fatalf("series rating count before any reaction = %d, want no row", got)
	}

	devoted := mustInsertUser(t, ctx, pg.DB, tenantID, "USRE", "reader-e@example.com", "Reader E")
	seedRating(t, ctx, pg.DB, tenantID, devoted, firstEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, devoted, secondEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, devoted, thirdEpisodeID, 5)
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 1 {
		t.Fatalf("series rating count after one reader reacted to three episodes = %d, want 1", got)
	}

	// Raising a score is an update, and the reader was already counted.
	if _, err := pg.DB.ExecContext(ctx,
		"UPDATE episode_ratings SET score = 5 WHERE tenant_id = $1 AND user_id = $2", tenantID, devoted); err != nil {
		t.Fatalf("raise the reader's scores: %v", err)
	}
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 1 {
		t.Fatalf("series rating count after raising the scores = %d, want 1", got)
	}

	passing := mustInsertUser(t, ctx, pg.DB, tenantID, "USRF", "reader-f@example.com", "Reader F")
	seedRating(t, ctx, pg.DB, tenantID, passing, firstEpisodeID, 3)
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 2 {
		t.Fatalf("series rating count after a second reader = %d, want 2", got)
	}
}

// A departing account takes every reaction it gave with it in one delete, and
// the series it read loses exactly one reader however many of its episodes that
// account had reacted to.
func TestSeriesRatingCountFallsByOneWhenAReaderLeaves(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRF", "series-rating-f.example.com", "admin-series-rating-f.example.com", "Tenant Series Rating F")
	seriesID, firstEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SLEAVE0001", "ELEAVE0001")
	secondEpisodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "ELEAVE0002", 2)

	leaving := mustInsertUser(t, ctx, pg.DB, tenantID, "USRG", "reader-g@example.com", "Reader G")
	staying := mustInsertUser(t, ctx, pg.DB, tenantID, "USRH", "reader-h@example.com", "Reader H")
	seedRating(t, ctx, pg.DB, tenantID, leaving, firstEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, leaving, secondEpisodeID, 4)
	seedRating(t, ctx, pg.DB, tenantID, staying, firstEpisodeID, 3)
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 2 {
		t.Fatalf("series rating count = %d, want 2", got)
	}

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", leaving); err != nil {
		t.Fatalf("delete the leaving reader: %v", err)
	}
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 1 {
		t.Fatalf("series rating count after the reader left = %d, want 1", got)
	}

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", staying); err != nil {
		t.Fatalf("delete the staying reader: %v", err)
	}
	if got := seriesRatingCount(t, ctx, pg.DB, tenantID, seriesID); got != 0 {
		t.Fatalf("series rating count after every reader left = %d, want 0", got)
	}
}

// The tally is derived, so a storefront connection may read it and may not
// write it: the number every reader of the series page sees would otherwise be
// one any request could set without a reaction behind it.
func TestSeriesRatingCountsAreReadOnlyToTheAPIRoles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRG", "series-rating-g.example.com", "admin-series-rating-g.example.com", "Tenant Series Rating G")
	seriesID, episodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SLOCKED001", "ELOCKED001")
	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRI", "reader-i@example.com", "Reader I")
	seedRating(t, ctx, pg.DB, tenantID, reader, episodeID, 5)

	withMemberConn(t, pg, tenantID, reader, func(ctx context.Context, conn *sql.Conn) {
		var count int64
		if err := conn.QueryRowContext(ctx,
			"SELECT count FROM series_rating_counts WHERE series_id = $1", seriesID).Scan(&count); err != nil {
			t.Fatalf("read the series tally as a member: %v", err)
		}
		if count != 1 {
			t.Fatalf("series rating count = %d, want 1", count)
		}
		for name, statement := range map[string]string{
			"update": "UPDATE series_rating_counts SET count = 9999 WHERE series_id = $1",
			"delete": "DELETE FROM series_rating_counts WHERE series_id = $1",
			"insert": "INSERT INTO series_rating_counts (tenant_id, series_id, count) SELECT $2, $1, 9999",
		} {
			if _, err := conn.ExecContext(ctx, statement, seriesID, tenantID); err == nil {
				t.Fatalf("%s on series_rating_counts succeeded, want it refused", name)
			}
		}
	})
}

// The reader's own figure is the mean of what they gave, over the episodes they
// reacted to and no others: the ones they finished in silence are not in it,
// and neither are another reader's.
func TestGetMySeriesRatingCoversOnlyTheEpisodesTheReaderReactedTo(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRH", "series-rating-h.example.com", "admin-series-rating-h.example.com", "Tenant Series Rating H")
	seriesID, firstEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SMINE00001", "EMINE00001")
	secondEpisodeID := mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "EMINE00002", 2)
	mustInsertEpisodeOfSeries(t, ctx, pg.DB, tenantID, seriesID, "EMINE00003", 3)
	otherSeriesID, otherEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SOTHER0001", "EOTHER0001")

	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRJ", "reader-j@example.com", "Reader J")
	stranger := mustInsertUser(t, ctx, pg.DB, tenantID, "USRK", "reader-k@example.com", "Reader K")
	seedRating(t, ctx, pg.DB, tenantID, reader, firstEpisodeID, 5)
	seedRating(t, ctx, pg.DB, tenantID, reader, secondEpisodeID, 2)
	seedRating(t, ctx, pg.DB, tenantID, reader, otherEpisodeID, 1)
	seedRating(t, ctx, pg.DB, tenantID, stranger, firstEpisodeID, 1)

	withMemberConn(t, pg, tenantID, reader, func(ctx context.Context, conn *sql.Conn) {
		queries := dbmodels.New(conn)
		mine, err := queries.GetMySeriesRating(ctx, dbmodels.GetMySeriesRatingParams{
			TenantID: tenantID,
			UserID:   reader,
			SeriesID: seriesID,
		})
		if err != nil {
			t.Fatalf("get the reader's series rating: %v", err)
		}
		assertRatingAverage(t, mine.RatingAverage, 3.5)
		if mine.RatedEpisodeCount != 2 {
			t.Fatalf("rated episode count = %d, want 2", mine.RatedEpisodeCount)
		}

		other, err := queries.GetMySeriesRating(ctx, dbmodels.GetMySeriesRatingParams{
			TenantID: tenantID,
			UserID:   reader,
			SeriesID: otherSeriesID,
		})
		if err != nil {
			t.Fatalf("get the reader's other series rating: %v", err)
		}
		assertRatingAverage(t, other.RatingAverage, 1)
	})

	withMemberConn(t, pg, tenantID, stranger, func(ctx context.Context, conn *sql.Conn) {
		theirs, err := dbmodels.New(conn).GetMySeriesRating(ctx, dbmodels.GetMySeriesRatingParams{
			TenantID: tenantID,
			UserID:   stranger,
			SeriesID: seriesID,
		})
		if err != nil {
			t.Fatalf("get the stranger's series rating: %v", err)
		}
		assertRatingAverage(t, theirs.RatingAverage, 1)
		if theirs.RatedEpisodeCount != 1 {
			t.Fatalf("stranger's rated episode count = %d, want 1", theirs.RatedEpisodeCount)
		}
	})
}

// A reader who has reacted to nothing of the series gets no figure rather than
// the bottom of the scale, so a page can tell a reader who said nothing apart
// from one who gave the series a single point.
func TestGetMySeriesRatingIsAbsentForAReaderWhoHasNotReacted(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TSRI", "series-rating-i.example.com", "admin-series-rating-i.example.com", "Tenant Series Rating I")
	seriesID, _ := mustInsertSeriesAndEpisode(t, ctx, pg.DB, tenantID, "SQUIETME01", "EQUIETME01")
	reader := mustInsertUser(t, ctx, pg.DB, tenantID, "USRL", "reader-l@example.com", "Reader L")

	withMemberConn(t, pg, tenantID, reader, func(ctx context.Context, conn *sql.Conn) {
		mine, err := dbmodels.New(conn).GetMySeriesRating(ctx, dbmodels.GetMySeriesRatingParams{
			TenantID: tenantID,
			UserID:   reader,
			SeriesID: seriesID,
		})
		if err != nil {
			t.Fatalf("get the reader's series rating: %v", err)
		}
		assertRatingAverage(t, mine.RatingAverage, 0)
		if mine.RatedEpisodeCount != 0 {
			t.Fatalf("rated episode count = %d, want 0", mine.RatedEpisodeCount)
		}
	})
}

// The figure is one tenant's own: a second tenant's reactions are neither in
// the series' totals nor in the mean a young series is pulled towards.
func TestSeriesRatingIsScopedToOneTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	first := mustInsertTenant(t, ctx, pg.DB, "TSRJ", "series-rating-j.example.com", "admin-series-rating-j.example.com", "Tenant Series Rating J")
	second := mustInsertTenant(t, ctx, pg.DB, "TSRK", "series-rating-k.example.com", "admin-series-rating-k.example.com", "Tenant Series Rating K")
	seriesID, episodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, first, "SSCOPED001", "ESCOPED001")
	otherSeriesID, otherEpisodeID := mustInsertSeriesAndEpisode(t, ctx, pg.DB, second, "SSCOPED002", "ESCOPED002")

	seedSeriesDailyStats(t, ctx, pg.DB, first, seriesID, "2026-09-01", 600, 200)
	// A tenant whose readers barely react at all, which would drag the first
	// tenant's figure down if the mean were taken across both.
	seedSeriesDailyStats(t, ctx, pg.DB, second, otherSeriesID, "2026-09-01", 10, 100000)

	reader := mustInsertUser(t, ctx, pg.DB, first, "USRM", "reader-m@example.com", "Reader M")
	otherReader := mustInsertUser(t, ctx, pg.DB, second, "USRN", "reader-n@example.com", "Reader N")
	seedRating(t, ctx, pg.DB, first, reader, episodeID, 5)
	seedRating(t, ctx, pg.DB, second, otherReader, otherEpisodeID, 5)

	rating, err := dbmodels.New(pg.DB).GetSeriesRating(ctx, dbmodels.GetSeriesRatingParams{TenantID: first, SeriesID: seriesID})
	if err != nil {
		t.Fatalf("get the series rating: %v", err)
	}
	assertRatingAverage(t, rating.RatingAverage, shrunkRating(600, 200, 600, 200))
	if rating.RatingCount != 1 {
		t.Fatalf("rating count = %d, want 1", rating.RatingCount)
	}
	if got := seriesRatingCount(t, ctx, pg.DB, first, otherSeriesID); got != -1 {
		t.Fatalf("the other tenant's series tally under this tenant = %d, want no row", got)
	}
}
