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
