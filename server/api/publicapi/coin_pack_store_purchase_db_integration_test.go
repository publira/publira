package publicapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// coinPackStoreEnv is newStorePurchaseEnv's tenant under a platform that
// allows tenant coins, with its coins on at 10 a coin, named Points in en,
// and a pack of 1,000 coins and 100 bonus coins at 1,000 on sale.
type coinPackStoreEnv struct {
	*storePurchaseEnv
	pack testutil.CoinPack
}

func newCoinPackStoreEnv(t *testing.T) coinPackStoreEnv {
	t.Helper()
	env := newStorePurchaseEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.TenantCoinsAllowed = true
	}))
	env.pg.SeedCoinSettings(t, env.tenant.ID, testutil.CoinSettingsSeed{Names: map[string]string{"en": "Points"}})
	return coinPackStoreEnv{
		storePurchaseEnv: env,
		pack:             env.pg.SeedCoinPack(t, env.tenant.ID, testutil.CoinPackSeed{PublicID: "STOREPACK001", Coins: 1000, BonusCoins: 100, Price: 1000}),
	}
}

func (e coinPackStoreEnv) startPack(store publirav1.InAppPurchaseStore) (*publirav1.StartStorePurchaseResponse, error) {
	return e.client.StartStorePurchase(testutil.WithBearer(context.Background(), e.token), &publirav1.StartStorePurchaseRequest{
		Tenant:     tenantContext(e.tenant),
		CoinPackId: e.pack.ID.String(),
		Store:      store,
	})
}

func (e coinPackStoreEnv) balance(t *testing.T) *publirav1.CoinBalance {
	t.Helper()
	res, err := e.coins.GetCoinBalance(testutil.WithBearer(context.Background(), e.token), &publirav1.GetCoinBalanceRequest{Tenant: tenantContext(e.tenant)})
	if err != nil {
		t.Fatalf("GetCoinBalance: %v", err)
	}
	return res.GetBalance()
}

// A pack bought through the App Store grants the coins the same pack grants on
// the web, once however often the app confirms it, and a refund from the
// store takes them back.
func TestDBBuyingACoinPackThroughTheAppStoreGrantsItsCoins(t *testing.T) {
	t.Parallel()

	env := newCoinPackStoreEnv(t)

	intent, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	if err != nil {
		t.Fatalf("StartStorePurchase: %v", err)
	}
	if want := "coins_" + strings.ReplaceAll(env.pack.ID.String(), "-", ""); intent.GetProductId() != want {
		t.Fatalf("product_id = %q, want %q, coins_ followed by the pack's UUID in hexadecimal", intent.GetProductId(), want)
	}
	if again, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE); err != nil || again.GetIntentId() != intent.GetIntentId() {
		t.Fatalf("a second start = (%v, %v), want the open intent %s", again, err, intent.GetIntentId())
	}
	// The tenant edits the pack while the payment sheet is open, which it may
	// while the pack has never been sold.
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET bonus_coins = 0 WHERE id = $1`, env.pack.ID); err != nil {
		t.Fatalf("edit the pack: %v", err)
	}

	transaction := env.appStoreTransaction("2000000000000500", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	for range 2 {
		purchase, err := env.confirmAppStore(t, env.token, transaction)
		if err != nil {
			t.Fatalf("ConfirmStorePurchase: %v", err)
		}
		if pack := purchase.GetCoinPack(); pack.GetId() != env.pack.ID.String() || pack.GetCoins() != 1000 || pack.GetBonusCoins() != 100 {
			t.Fatalf("purchased pack = %+v, want the pack as the payment sheet showed it", pack)
		}
		if purchase.GetCoinName() != "Points" || purchase.GetPriceAtPurchase() != 1000 || purchase.GetEpisode() != nil {
			t.Fatalf("purchase = %+v, want a pack of Points at 1,000", purchase)
		}
	}
	if got := env.balance(t).GetCoins(); got != 1100 {
		t.Fatalf("balance = %d, want the pack's 1,100 coins once", got)
	}
	if got := env.count(t, `SELECT count(*) FROM coin_grants WHERE tenant_id = $1`, env.tenant.ID); got != 1 {
		t.Fatalf("grants = %d, want 1", got)
	}

	if err := env.notify(t, env.signer, env.refundNotification(t, transaction)); err != nil {
		t.Fatalf("ProcessAppStoreNotification: %v", err)
	}
	if balance := env.balance(t); balance.GetCoins() != 0 || balance.GetShortfallCoins() != 0 {
		t.Fatalf("balance after the store's refund = %+v, want nothing held and nothing owed", balance)
	}
}

// A pack bought through Google Play grants its coins and is consumed, so the
// reader can buy the same pack again.
func TestDBBuyingACoinPackThroughGooglePlayGrantsItsCoinsAndConsumesIt(t *testing.T) {
	t.Parallel()

	env := newCoinPackStoreEnv(t)

	intent, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY)
	if err != nil {
		t.Fatalf("StartStorePurchase: %v", err)
	}
	const purchaseToken = "play-pack-token-0001.AO-J1Oy"
	env.play.Put(t, storeTestPackageName, intent.GetProductId(), purchaseToken, googleplaytest.Purchased, intent.GetIntentId())
	if _, err := env.confirmGooglePlay(t, intent.GetProductId(), purchaseToken); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if got := env.balance(t).GetCoins(); got != 1100 {
		t.Fatalf("balance = %d, want 1,100", got)
	}
	if got := env.count(t, `SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = 'google_play_purchase_consume'`, env.tenant.ID); got != 1 {
		t.Fatalf("consume events = %d, want the pack consumed", got)
	}
	again, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY)
	if err != nil {
		t.Fatalf("StartStorePurchase again: %v", err)
	}
	if again.GetIntentId() == intent.GetIntentId() {
		t.Fatal("buying the pack again reused the consumed intent")
	}
}

// The store sells a pack on the terms the web does: only while the tenant
// sells packs, and only a pack on sale.
func TestDBStartStorePurchaseRefusesAPackItCannotSell(t *testing.T) {
	t.Parallel()

	env := newCoinPackStoreEnv(t)

	_, err := env.client.StartStorePurchase(testutil.WithBearer(context.Background(), env.token), &publirav1.StartStorePurchaseRequest{
		Tenant:     tenantContext(env.tenant),
		EpisodeId:  env.episode.ID.String(),
		CoinPackId: env.pack.ID.String(),
		Store:      publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an episode and a pack at once = %v, want invalid_argument", err)
	}

	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_coin_config SET selling = false WHERE tenant_id = $1`, env.tenant.ID); err != nil {
		t.Fatalf("stop selling: %v", err)
	}
	if _, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a pack while not selling = %v, want failed_precondition", err)
	}
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_coin_config SET selling = true, enabled = false WHERE tenant_id = $1`, env.tenant.ID); err != nil {
		t.Fatalf("turn coins off: %v", err)
	}
	_, err = env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonCoinsUnavailable {
		t.Fatalf("a pack while coins are off = %v, want COINS_UNAVAILABLE", err)
	}
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_coin_config SET enabled = true WHERE tenant_id = $1`, env.tenant.ID); err != nil {
		t.Fatalf("turn coins on: %v", err)
	}
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET on_sale = false WHERE id = $1`, env.pack.ID); err != nil {
		t.Fatalf("take the pack off sale: %v", err)
	}
	if _, err := env.startPack(publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a pack off sale = %v, want not_found", err)
	}
}
