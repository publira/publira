package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// subscribeToTips saves an endpoint on the tenant that subscribed to
// tip.received, and one beside it that subscribed to purchase.completed alone.
func subscribeToTips(t *testing.T, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()

	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $3, 'https://royalties.example.com/publira', 'sealed', 'whsec_••••', ARRAY['tip.received']),
			($2, $3, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', ARRAY['purchase.completed'])
	`, uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), tenantID); err != nil {
		t.Fatalf("insert webhook endpoints: %v", err)
	}
}

// tipDelivery is the data of one tip.received delivery, decoded, and its
// creator_public_ids as the body carries them.
type tipDelivery struct {
	data     tenantwebhooks.Tip
	creators string
}

// tipDeliveries answers every tip.received delivery owed on the tenant, oldest
// first, each to the endpoint that subscribed to it.
func tipDeliveries(t *testing.T, db *sql.DB, tenantID uuid.UUID) []tipDelivery {
	t.Helper()

	rows, err := db.QueryContext(context.Background(), `
		SELECT e.url, d.payload->'data', d.payload->'data'->'creator_public_ids'
		FROM webhook_deliveries d
			JOIN tenant_webhook_endpoints e ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id
		WHERE d.tenant_id = $1 AND d.event_type = 'tip.received'
		ORDER BY d.created_at, d.id
	`, tenantID)
	if err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []tipDelivery
	for rows.Next() {
		var url, creators string
		var raw []byte
		if err := rows.Scan(&url, &raw, &creators); err != nil {
			t.Fatalf("scan webhook delivery: %v", err)
		}
		if url != "https://royalties.example.com/publira" {
			t.Errorf("a delivery is owed to %s, which did not subscribe to it", url)
		}
		var data tenantwebhooks.Tip
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatalf("decode webhook delivery: %v", err)
		}
		got = append(got, tipDelivery{data: data, creators: creators})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	return got
}

// tipMatches reports whether got is want, purchased_at compared only for
// being set.
func tipMatches(got, want tenantwebhooks.Tip) bool {
	want.PurchasedAt = got.PurchasedAt
	return got.PurchasedAt != "" && reflect.DeepEqual(got, want)
}

// A tip paid on the site owes tip.received once however often the provider
// reports the payment, naming each Author the episode credits once and in the
// order its credits are shown, and still owes purchase.completed beside it. A
// purchase of the same episode is no tip and owes only its
// purchase.completed.
func TestDBATipPaidOnTheSiteOwesTipReceived(t *testing.T) {
	t.Parallel()

	env := newTipEnv(t, "TIPWH")
	subscribeToTips(t, env.pg.DB, env.tenant.ID)
	// The Artist role outranks the Writer role though its credit is ordered
	// after theirs, so the Artist leads, and their Supervisor credit, which
	// ranks last, does not name them a second time. The two Writers share a
	// role and a display_order, so the name puts the one seeded second first.
	artist := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{Name: "Artist"})
	writerB := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{Name: "Writer B"})
	writerA := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{Name: "Writer A"})
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, artist.ID, "Artist")
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, artist.ID, "Supervisor")
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, writerB.ID, "Writer")
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, writerA.ID, "Writer")
	artistRole := env.pg.CreatorRoleByName(t, env.tenant.ID, "Artist")
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE episode_creators SET display_order = 1 WHERE tenant_id = $1 AND creator_id = $2 AND role_id = $3`, env.tenant.ID, artist.ID, artistRole.ID); err != nil {
		t.Fatalf("order the credits: %v", err)
	}
	ctx := testutil.WithBearer(context.Background(), env.token)

	if err := env.tip(ctx, env.episode.ID, 300); err != nil {
		t.Fatalf("StartTipCheckout: %v", err)
	}
	env.pay(t, "cs_tip_webhook")
	env.pay(t, "cs_tip_webhook")

	var purchaseID string
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT id FROM purchases WHERE tenant_id = $1 AND provider_checkout_id = 'cs_tip_webhook'`, env.tenant.ID).Scan(&purchaseID); err != nil {
		t.Fatalf("read the tip: %v", err)
	}
	got := tipDeliveries(t, env.pg.DB, env.tenant.ID)
	if len(got) != 1 {
		t.Fatalf("owed %d tip.received deliveries, want 1: %+v", len(got), got)
	}
	want := tenantwebhooks.Tip{
		PurchaseID:       purchaseID,
		EpisodePublicID:  env.episode.PublicID,
		SeriesPublicID:   env.series.PublicID,
		Price:            300,
		Currency:         env.checkout.input.Purchase.Currency,
		CreatorPublicIDs: []string{artist.PublicID, writerA.PublicID, writerB.PublicID},
		ReaderPublicID:   env.reader.PublicID,
		Provider:         "stripe",
	}
	if !tipMatches(got[0].data, want) {
		t.Fatalf("tip.received data = %+v, want %+v", got[0].data, want)
	}
	if completed := purchaseCompletedDeliveries(t, env.pg.DB, env.tenant.ID); len(completed) != 1 || completed[0] != purchaseID {
		t.Fatalf("purchase.completed deliveries = %v, want one for the tip %s", completed, purchaseID)
	}

	if _, err := env.client.StartEpisodeCheckout(ctx, &publirav1.StartEpisodeCheckoutRequest{
		Tenant:    tenantContext(env.tenant),
		EpisodeId: env.episode.ID.String(),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	env.pay(t, "cs_episode_after_tip")
	if got := tipDeliveries(t, env.pg.DB, env.tenant.ID); len(got) != 1 {
		t.Fatalf("owed %d tip.received deliveries after a purchase of the episode, want still 1", len(got))
	}
	if completed := purchaseCompletedDeliveries(t, env.pg.DB, env.tenant.ID); len(completed) != 2 {
		t.Fatalf("purchase.completed deliveries = %v, want the tip's and then the episode's", completed)
	}
}

// A tip paid in the app owes tip.received once however often the app confirms
// it, naming the store it was paid through, and still owes purchase.completed
// beside it. An episode that credits no one is sent with an empty list of
// Authors rather than none.
func TestDBATipPaidInTheAppOwesTipReceived(t *testing.T) {
	t.Parallel()

	env := newStorePurchaseEnv(t)
	takeTips(t, env.pg, env.tenant.ID, 300)
	subscribeToTips(t, env.pg.DB, env.tenant.ID)
	ctx := testutil.WithBearer(context.Background(), env.token)

	intent, err := env.client.StartStoreTip(ctx, &publirav1.StartStoreTipRequest{
		Tenant:    tenantContext(env.tenant),
		Store:     publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
		EpisodeId: env.episode.ID.String(),
		Amount:    300,
	})
	if err != nil {
		t.Fatalf("StartStoreTip: %v", err)
	}
	transaction := env.appStoreTransaction("2000000000000800", &publirav1.StartStorePurchaseResponse{IntentId: intent.IntentId, ProductId: intent.ProductId})
	transaction.Environment = appstore.EnvironmentSandbox
	env.appStore.transactions[transaction.TransactionID] = transaction
	var purchaseID string
	for range 2 {
		purchase, err := env.confirmAppStore(t, env.token, transaction)
		if err != nil {
			t.Fatalf("ConfirmStorePurchase: %v", err)
		}
		purchaseID = purchase.GetId()
	}

	var seriesPublicID string
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT s.public_id FROM episodes e JOIN series s ON s.id = e.series_id WHERE e.id = $1`, env.episode.ID).Scan(&seriesPublicID); err != nil {
		t.Fatalf("read the episode's series: %v", err)
	}
	got := tipDeliveries(t, env.pg.DB, env.tenant.ID)
	if len(got) != 1 {
		t.Fatalf("owed %d tip.received deliveries, want 1: %+v", len(got), got)
	}
	want := tenantwebhooks.Tip{
		PurchaseID:       purchaseID,
		EpisodePublicID:  env.episode.PublicID,
		SeriesPublicID:   seriesPublicID,
		Price:            300,
		Currency:         storeTestCurrency(t, env.pg, env.tenant.ID),
		CreatorPublicIDs: []string{},
		ReaderPublicID:   env.reader.PublicID,
		Store:            "app_store",
		Test:             true,
	}
	if !tipMatches(got[0].data, want) || got[0].creators != "[]" {
		t.Fatalf("tip.received data = %+v with creator_public_ids %s, want %+v with []", got[0].data, got[0].creators, want)
	}
	if completed := purchaseCompletedDeliveries(t, env.pg.DB, env.tenant.ID); len(completed) != 1 || completed[0] != purchaseID {
		t.Fatalf("purchase.completed deliveries = %v, want one for the tip %s", completed, purchaseID)
	}
}
