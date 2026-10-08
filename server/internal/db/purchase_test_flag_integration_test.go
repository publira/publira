package dbtest

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// A purchase paid in a store's sandbox or a payment provider's test mode is a
// test one, and royalty statements and the daily stats leave it out. An
// admin-issued grant was paid through neither and has no test mode to come
// from, so the constraint refuses the flag on one.
func TestPurchaseTestFlagNeedsAStoreOrAProvider(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tests := []struct {
		name    string
		columns string
		values  string
		wantErr bool
	}{
		{name: "a provider purchase", columns: ", provider, provider_checkout_id", values: ", 'stripe', 'cs_test_flag'"},
		{name: "a store purchase", columns: ", store, store_transaction_id", values: ", 'app_store', '2000000000000001'"},
		{name: "an admin-issued grant", wantErr: true},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
				PublicID: fmt.Sprintf("EPISODEA%04d", i+1),
				Title:    tt.name,
				Status:   testutil.EpisodeStatusPublished,
			})
			_, err := pg.DB.ExecContext(ctx, `
				INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, is_test`+tt.columns+`)
				VALUES ($1, $2, $3, $4, 500, true`+tt.values+`)
			`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, episode.ID)
			if tt.wantErr {
				if !isCheckViolation(err) || checkName(err) != "purchases_store_transaction_check" {
					t.Fatalf("insert error = %v, want purchases_store_transaction_check violated", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("insert: %v", err)
			}
		})
	}
}

// The version just before provider purchases could be test ones.
const beforeProviderTestPurchasesVersion = 20261008124941

// Rolling the flag back leaves the schema a test provider purchase cannot be
// in, so such a purchase becomes the sale it was recorded as before. Keeping
// the flag behind a constraint that does not hold for the row would fail every
// later update of it, a refund among them.
func TestProviderTestPurchasesBecomeSalesOnRollback(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Cleanup(func() { pg.MigrateUp(t) })

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Status: testutil.EpisodeStatusPublished})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	purchaseID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, provider, provider_checkout_id, is_test)
		VALUES ($1, $2, $3, $4, 500, 'stripe', 'cs_test_rollback', true)
	`, purchaseID, tenant.ID, reader.ID, episode.ID); err != nil {
		t.Fatalf("insert test provider purchase: %v", err)
	}

	pg.MigrateTo(t, beforeProviderTestPurchasesVersion)

	var isTest, validated bool
	if err := pg.DB.QueryRowContext(ctx, `SELECT is_test FROM purchases WHERE id = $1`, purchaseID).Scan(&isTest); err != nil {
		t.Fatalf("read purchase: %v", err)
	}
	if isTest {
		t.Fatal("the purchase is still a test one after the rollback")
	}
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT convalidated FROM pg_constraint WHERE conname = 'purchases_store_transaction_check'
	`).Scan(&validated); err != nil {
		t.Fatalf("read constraint: %v", err)
	}
	if !validated {
		t.Fatal("purchases_store_transaction_check is not validated after the rollback")
	}
	if _, err := pg.DB.ExecContext(ctx, `UPDATE purchases SET refunded_amount = 500, refunded_at = now() WHERE id = $1`, purchaseID); err != nil {
		t.Fatalf("refund the purchase after the rollback: %v", err)
	}
}
