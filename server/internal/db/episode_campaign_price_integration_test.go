package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/testutil"
)

// insertCampaignPrice writes one campaign directly, so a test can assert on the
// error the database answers with rather than on a handler's translation of it.
func insertCampaignPrice(
	ctx context.Context,
	pg *testutil.PostgresEnv,
	tenantID, episodeID uuid.UUID,
	publicID string,
	price int32,
	startsAt, endsAt time.Time,
) error {
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO episode_campaign_prices (id, tenant_id, public_id, episode_id, price, starts_at, ends_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, publicID, episodeID, price, startsAt, endsAt)
	return err
}

// A checkout charges the one campaign covering the moment it starts, so two
// campaigns on one episode may never cover the same instant, and the database
// refuses them whichever handler writes the row.
func TestEpisodeCampaignPricesCannotOverlapOnOneEpisode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	first := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEONE01", Title: "One", Status: testutil.EpisodeStatusPublished, Price: 500})
	second := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODETWO01", Title: "Two", Status: testutil.EpisodeStatusPublished, Price: 500})

	base := time.Now().UTC().Truncate(time.Hour)
	if err := insertCampaignPrice(ctx, pg, tenant.ID, first.ID, "CAMPAIGN0001", 300, base, base.Add(2*time.Hour)); err != nil {
		t.Fatalf("insert the first campaign: %v", err)
	}
	if err := insertCampaignPrice(ctx, pg, tenant.ID, first.ID, "CAMPAIGN0002", 250, base.Add(time.Hour), base.Add(3*time.Hour)); !dberr.IsExclusionViolation(err) {
		t.Fatalf("insert of an overlapping campaign = %v, want an exclusion violation", err)
	}
	// The period is half-open, so a campaign may start where another ends.
	if err := insertCampaignPrice(ctx, pg, tenant.ID, first.ID, "CAMPAIGN0003", 250, base.Add(2*time.Hour), base.Add(3*time.Hour)); err != nil {
		t.Fatalf("insert a campaign starting where the first ends: %v", err)
	}
	// The rule is per episode.
	if err := insertCampaignPrice(ctx, pg, tenant.ID, second.ID, "CAMPAIGN0004", 300, base, base.Add(2*time.Hour)); err != nil {
		t.Fatalf("insert the same period on another episode: %v", err)
	}
	if err := insertCampaignPrice(ctx, pg, tenant.ID, second.ID, "CAMPAIGN0005", 300, base.Add(5*time.Hour), base.Add(5*time.Hour)); err == nil {
		t.Fatal("insert of a campaign that ends when it starts succeeded, want a check violation")
	}
	if err := insertCampaignPrice(ctx, pg, tenant.ID, second.ID, "CAMPAIGN0006", 0, base.Add(6*time.Hour), base.Add(7*time.Hour)); err == nil {
		t.Fatal("insert of a campaign at no price succeeded, want a check violation")
	}
}

// open_episode_campaign_prices is the one rule the checkout and the catalog
// both read: a campaign counts while it covers the moment of the read and
// still undercuts the episode's own price.
func TestOpenEpisodeCampaignPricesAnswersTheCampaignInForce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	newEpisode := func(publicID string) testutil.Episode {
		return pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: publicID, Status: testutil.EpisodeStatusPublished, Price: 500})
	}
	now := time.Now().UTC().Truncate(time.Second)
	open := newEpisode("EPISODEOPN01")
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, open.ID, 300, now.Add(-time.Hour), now.Add(time.Hour))
	upcoming := newEpisode("EPISODEUPC01")
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, upcoming.ID, 300, now.Add(time.Hour), now.Add(2*time.Hour))
	over := newEpisode("EPISODEOVR01")
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, over.ID, 300, now.Add(-2*time.Hour), now.Add(-time.Hour))
	overtaken := newEpisode("EPISODEOVT01")
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, overtaken.ID, 300, now.Add(-time.Hour), now.Add(time.Hour))
	if _, err := pg.DB.ExecContext(ctx, "UPDATE episode_listings SET price = 300 WHERE episode_id = $1", overtaken.ID); err != nil {
		t.Fatalf("price the episode at its campaign: %v", err)
	}

	rows, err := pg.DB.QueryContext(ctx, "SELECT episode_id, campaign_price, campaign_ends_at FROM open_episode_campaign_prices")
	if err != nil {
		t.Fatalf("read open_episode_campaign_prices: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var found []uuid.UUID
	for rows.Next() {
		var (
			episodeID uuid.UUID
			price     int32
			endsAt    time.Time
		)
		if err := rows.Scan(&episodeID, &price, &endsAt); err != nil {
			t.Fatalf("scan: %v", err)
		}
		found = append(found, episodeID)
		if episodeID == open.ID && (price != 300 || !endsAt.Equal(now.Add(time.Hour))) {
			t.Fatalf("open campaign = %d until %v, want 300 until %v", price, endsAt, now.Add(time.Hour))
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if len(found) != 1 || found[0] != open.ID {
		t.Fatalf("open campaigns on %v, want the one on %s alone", found, open.ID)
	}
}

func TestListEpisodeCampaignPriceBoundariesDue(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	newEpisode := func(publicID string) testutil.Episode {
		return pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: publicID, Status: testutil.EpisodeStatusPublished, Price: 500})
	}

	now := time.Now().UTC()
	upcoming := newEpisode("EPISODEUPC01")
	pg.SeedEpisodeCampaignPrice(t, tenant.ID, upcoming.ID, 300, now.Add(time.Hour), now.Add(2*time.Hour))
	open := newEpisode("EPISODEOPN01")
	openID := pg.SeedEpisodeCampaignPrice(t, tenant.ID, open.ID, 300, now.Add(-time.Hour), now.Add(time.Hour))
	over := newEpisode("EPISODEOVR01")
	overID := pg.SeedEpisodeCampaignPrice(t, tenant.ID, over.ID, 300, now.Add(-2*time.Hour), now.Add(-time.Hour))

	due := func() map[uuid.UUID]dbmodels.ListEpisodeCampaignPriceBoundariesDueRow {
		t.Helper()
		rows, err := q.ListEpisodeCampaignPriceBoundariesDue(ctx)
		if err != nil {
			t.Fatalf("ListEpisodeCampaignPriceBoundariesDue: %v", err)
		}
		byID := make(map[uuid.UUID]dbmodels.ListEpisodeCampaignPriceBoundariesDueRow, len(rows))
		for _, row := range rows {
			byID[row.ID] = row
		}
		return byID
	}

	first := due()
	if len(first) != 2 {
		t.Fatalf("due campaigns = %d, want the open one and the one that ended", len(first))
	}
	if row := first[openID]; !row.StartDue.Bool || row.EndDue.Bool || row.TenantID != tenant.ID || row.EpisodePublicID != "EPISODEOPN01" {
		t.Fatalf("open campaign = %+v, want its start due alone, on its tenant and episode", row)
	}
	// A campaign that started and ended while the batch was down has both
	// boundaries due at once.
	if row := first[overID]; !row.StartDue.Bool || !row.EndDue.Bool {
		t.Fatalf("ended campaign = %+v, want both boundaries due", row)
	}

	if err := q.MarkEpisodeCampaignPriceStartRevalidated(ctx, openID); err != nil {
		t.Fatalf("MarkEpisodeCampaignPriceStartRevalidated: %v", err)
	}
	if err := q.MarkEpisodeCampaignPriceStartRevalidated(ctx, overID); err != nil {
		t.Fatalf("MarkEpisodeCampaignPriceStartRevalidated: %v", err)
	}
	if err := q.MarkEpisodeCampaignPriceEndRevalidated(ctx, overID); err != nil {
		t.Fatalf("MarkEpisodeCampaignPriceEndRevalidated: %v", err)
	}
	if rest := due(); len(rest) != 0 {
		t.Fatalf("due campaigns after both were applied = %v, want none", rest)
	}
}
