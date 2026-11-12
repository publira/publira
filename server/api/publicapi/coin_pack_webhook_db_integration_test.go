package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

// subscribeToCoinPackPurchases saves an endpoint on the tenant that subscribed
// to coin_pack.purchased, and one beside it that subscribed to
// purchase.completed alone.
func subscribeToCoinPackPurchases(t *testing.T, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()

	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $3, 'https://ledger.example.com/publira', 'sealed', 'whsec_••••', ARRAY['coin_pack.purchased']),
			($2, $3, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', ARRAY['purchase.completed'])
	`, uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), tenantID); err != nil {
		t.Fatalf("insert webhook endpoints: %v", err)
	}
}

// coinPackPurchaseDeliveries answers the data of every coin_pack.purchased
// delivery owed on the tenant, oldest first, each to the endpoint that
// subscribed to it.
func coinPackPurchaseDeliveries(t *testing.T, db *sql.DB, tenantID uuid.UUID) []tenantwebhooks.CoinPackPurchase {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), `
		SELECT e.url, d.payload->'data'
		FROM webhook_deliveries d
			JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id
		WHERE d.tenant_id = $1 AND d.event_type = 'coin_pack.purchased'
		ORDER BY d.created_at, d.id
	`, tenantID)
	if err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []tenantwebhooks.CoinPackPurchase
	for rows.Next() {
		var url string
		var raw []byte
		if err := rows.Scan(&url, &raw); err != nil {
			t.Fatalf("scan webhook delivery: %v", err)
		}
		if url != "https://ledger.example.com/publira" {
			t.Errorf("a delivery is owed to %s, which did not subscribe to it", url)
		}
		var data tenantwebhooks.CoinPackPurchase
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("decode webhook delivery: %v", err)
		}
		got = append(got, data)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	return got
}

// purchaseCompletedDeliveries answers the purchase_id of every
// purchase.completed delivery owed on the tenant, oldest first.
func purchaseCompletedDeliveries(t *testing.T, db *sql.DB, tenantID uuid.UUID) []string {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), `
		SELECT d.payload->'data'->>'purchase_id'
		FROM webhook_deliveries d
		WHERE d.tenant_id = $1 AND d.event_type = 'purchase.completed'
		ORDER BY d.created_at, d.id
	`, tenantID)
	if err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []string
	for rows.Next() {
		var purchaseID string
		if err := rows.Scan(&purchaseID); err != nil {
			t.Fatalf("scan webhook delivery: %v", err)
		}
		got = append(got, purchaseID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	return got
}

// A pack bought on the web owes coin_pack.purchased once however often the
// provider reports the payment, carrying the coins the reader was shown when
// the checkout started, and still owes purchase.completed beside it. A
// purchase paid with the pack's coins is no pack purchase and owes only its
// purchase.completed.
func TestDBACoinPackBoughtOnTheWebOwesCoinPackPurchased(t *testing.T) {
	t.Parallel()

	f := newCoinPackFixture(t)
	subscribeToCoinPackPurchases(t, f.env.PG.DB, f.tenant.ID)

	if err := f.startCheckout(t, f.pack.ID, ""); err != nil {
		t.Fatalf("StartCoinPackCheckout: %v", err)
	}
	// The tenant edits the pack before the payment arrives, which it may while
	// the pack has never been sold.
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET coins = 2000 WHERE id = $1`, f.pack.ID); err != nil {
		t.Fatalf("edit the pack: %v", err)
	}
	f.pay(t, "cs_pack_webhook")
	f.pay(t, "cs_pack_webhook")

	var purchaseID string
	if err := f.env.PG.DB.QueryRowContext(context.Background(), `SELECT id FROM purchases WHERE tenant_id = $1 AND coin_pack_id = $2`, f.tenant.ID, f.pack.ID).Scan(&purchaseID); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	got := coinPackPurchaseDeliveries(t, f.env.PG.DB, f.tenant.ID)
	if len(got) != 1 {
		t.Fatalf("owed %d coin_pack.purchased deliveries, want 1: %+v", len(got), got)
	}
	if want := (tenantwebhooks.CoinPackPurchase{
		PurchaseID:       purchaseID,
		CoinPackPublicID: f.pack.PublicID,
		Coins:            1000,
		BonusCoins:       100,
		Price:            1000,
		Currency:         f.checkout.input.Purchase.Currency,
		ReaderPublicID:   f.reader.PublicID,
		PurchasedAt:      got[0].PurchasedAt,
		Provider:         "stripe",
	}); got[0] != want || got[0].PurchasedAt == "" {
		t.Fatalf("coin_pack.purchased data = %+v, want %+v", got[0], want)
	}
	if completed := purchaseCompletedDeliveries(t, f.env.PG.DB, f.tenant.ID); len(completed) != 1 || completed[0] != purchaseID {
		t.Fatalf("purchase.completed deliveries = %v, want one for the pack purchase %s", completed, purchaseID)
	}

	spent := f.spendOn(t, f.episode.ID, 30, "spend-pack-coins")
	if got := coinPackPurchaseDeliveries(t, f.env.PG.DB, f.tenant.ID); len(got) != 1 {
		t.Fatalf("owed %d coin_pack.purchased deliveries after spending coins, want still 1", len(got))
	}
	if completed := purchaseCompletedDeliveries(t, f.env.PG.DB, f.tenant.ID); len(completed) != 2 || completed[1] != spent.GetId() {
		t.Fatalf("purchase.completed deliveries = %v, want the pack's and then the episode's %s", completed, spent.GetId())
	}
}

// A pack bought in the app owes coin_pack.purchased once however often the
// app confirms it, naming the store it was paid through, and still owes
// purchase.completed beside it.
func TestDBACoinPackBoughtInTheAppOwesCoinPackPurchased(t *testing.T) {
	t.Parallel()

	env := newCoinPackStoreEnv(t)
	subscribeToCoinPackPurchases(t, env.pg.DB, env.tenant.ID)

	intent, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	if err != nil {
		t.Fatalf("StartStorePurchase: %v", err)
	}
	transaction := env.appStoreTransaction("2000000000000700", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	var purchaseID string
	for range 2 {
		purchase, err := env.confirmAppStore(t, env.token, transaction)
		if err != nil {
			t.Fatalf("ConfirmStorePurchase: %v", err)
		}
		purchaseID = purchase.GetId()
	}

	var currency string
	var isTest bool
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT currency, is_test FROM purchases WHERE tenant_id = $1 AND id = $2`, env.tenant.ID, purchaseID).Scan(&currency, &isTest); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	got := coinPackPurchaseDeliveries(t, env.pg.DB, env.tenant.ID)
	if len(got) != 1 {
		t.Fatalf("owed %d coin_pack.purchased deliveries, want 1: %+v", len(got), got)
	}
	if want := (tenantwebhooks.CoinPackPurchase{
		PurchaseID:       purchaseID,
		CoinPackPublicID: env.pack.PublicID,
		Coins:            1000,
		BonusCoins:       100,
		Price:            1000,
		Currency:         currency,
		ReaderPublicID:   env.reader.PublicID,
		PurchasedAt:      got[0].PurchasedAt,
		Store:            "app_store",
		Test:             isTest,
	}); got[0] != want || got[0].PurchasedAt == "" {
		t.Fatalf("coin_pack.purchased data = %+v, want %+v", got[0], want)
	}
	if completed := purchaseCompletedDeliveries(t, env.pg.DB, env.tenant.ID); len(completed) != 1 || completed[0] != purchaseID {
		t.Fatalf("purchase.completed deliveries = %v, want one for the pack purchase %s", completed, purchaseID)
	}
}
