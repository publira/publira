package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// A purchase of the rest of a series names its bundle and nothing else, and is
// sold as a volume is: for good, and never through a store.
func TestPurchaseBuysOneSeriesBundle(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Price: 500, Status: testutil.EpisodeStatusPublished})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	bundleID := uuid.New()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, price)
		VALUES ($1, $2, $3, $4, 'series-remainder-checkout:schema', 500)
	`, bundleID, tenant.ID, series.ID, reader.ID); err != nil {
		t.Fatalf("insert the bundle: %v", err)
	}
	insert := func(episodeID, bundleID uuid.NullUUID, kind string, expiresAt sql.NullTime, store sql.NullString) error {
		var transactionID sql.NullString
		if store.Valid {
			transactionID = sql.NullString{String: uuid.NewString(), Valid: true}
		}
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, series_bundle_id, price_at_purchase, currency, kind, expires_at, store, store_transaction_id)
			VALUES ($1, $2, $3, $4, $5, 500, 'JPY', $6, $7, $8, $9)
		`, uuid.New(), tenant.ID, reader.ID, episodeID, bundleID, kind, expiresAt, store, transactionID)
		return err
	}
	ofEpisode := uuid.NullUUID{UUID: episode.ID, Valid: true}
	ofBundle := uuid.NullUUID{UUID: bundleID, Valid: true}
	inADay := sql.NullTime{Time: time.Now().Add(24 * time.Hour), Valid: true}

	if err := insert(uuid.NullUUID{}, ofBundle, "purchase", sql.NullTime{}, sql.NullString{}); err != nil {
		t.Fatalf("a purchase of a bundle: %v", err)
	}
	for name, err := range map[string]error{
		"a purchase of an episode and a bundle": insert(ofEpisode, ofBundle, "purchase", sql.NullTime{}, sql.NullString{}),
		"a rental of a bundle":                  insert(uuid.NullUUID{}, ofBundle, "rental", inADay, sql.NullString{}),
		"a bundle bought from a store":          insert(uuid.NullUUID{}, ofBundle, "purchase", sql.NullTime{}, sql.NullString{String: "app_store", Valid: true}),
	} {
		if !isCheckViolation(err) || checkName(err) != "purchases_item_check" {
			t.Errorf("%s = %v, want purchases_item_check violated", name, err)
		}
	}
}

// A series takes a whole percent off its bundle, or nothing; never all of it.
func TestASeriesBundleDiscountIsAWholePercentBelowAHundred(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	set := func(percent sql.NullInt32) error {
		_, err := pg.DB.ExecContext(ctx, `
			UPDATE series_listings
			SET bundle_discount_percent = $2
			WHERE series_id = $1
		`, series.ID, percent)
		return err
	}
	for _, percent := range []sql.NullInt32{{}, {Int32: 1, Valid: true}, {Int32: 99, Valid: true}} {
		if err := set(percent); err != nil {
			t.Fatalf("a discount of %v: %v", percent, err)
		}
	}
	for _, percent := range []int32{0, 100} {
		if err := set(sql.NullInt32{Int32: percent, Valid: true}); !isCheckViolation(err) || checkName(err) != "series_listings_bundle_discount_percent_check" {
			t.Errorf("a discount of %d = %v, want series_listings_bundle_discount_percent_check violated", percent, err)
		}
	}
}
