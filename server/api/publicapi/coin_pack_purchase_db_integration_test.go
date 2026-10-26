package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// coinPackFixture is a tenant that sells through Stripe, whose coins are on at
// 10 a coin, last 180 days, and are named Points in en, with a pack of 1,000
// coins and 100 bonus coins at 1,000 on sale, a published episode at 300, and
// a reader signed in.
type coinPackFixture struct {
	env       *publicDBEnv
	tenant    testutil.Tenant
	reader    testutil.TenantUser
	series    testutil.Series
	episode   testutil.Episode
	pack      testutil.CoinPack
	checkout  *capturingCheckoutProvider
	coins     publirav1connect.CoinServiceClient
	purchases publirav1connect.PurchaseServiceClient
}

func newCoinPackFixture(t *testing.T) *coinPackFixture {
	t.Helper()
	return newCoinPackFixtureUnder(t, true)
}

// newCoinPackFixtureUnder is newCoinPackFixture under a platform that allows
// tenant coins or forbids them.
func newCoinPackFixtureUnder(t *testing.T, platformAllows bool) *coinPackFixture {
	t.Helper()
	encryptor := newPublicTestEncryptor(t)
	checkout := newCapturingCheckoutProvider()
	env := newPublicDBEnvConfigured(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.TenantCoinsAllowed = platformAllows
	}), openMailGuard(), func(api *apiServer, _ *sql.DB) {
		api.encryptor = encryptor
		api.paymentProviders = paymentprovider.NewRegistry(checkout)
	})
	tenant := env.seedTenant(t, "PACKTENANT01", "packs.example.com", "Pack tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "PACKREADER01", "reader@packs.example.com", "Reader")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PACKSERIES01", Title: "Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "PACKEPISODE1",
		Title:    "Episode",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedCoinSettings(t, tenant.ID, testutil.CoinSettingsSeed{Names: map[string]string{"ja": "Tickets", "en": "Points"}})
	pack := env.PG.SeedCoinPack(t, tenant.ID, testutil.CoinPackSeed{PublicID: "PACK1000COIN", Coins: 1000, BonusCoins: 100, Price: 1000})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(env.PG.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}
	transport := connecthttp.NewTransport(env.Server.Client(), env.Server.URL)
	return &coinPackFixture{
		env:       env,
		tenant:    tenant,
		reader:    reader,
		series:    series,
		episode:   episode,
		pack:      pack,
		checkout:  checkout,
		coins:     publirav1connect.NewCoinServiceClient(connect.NewClient(transport)),
		purchases: publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport)),
	}
}

func (f *coinPackFixture) readerCtx(t *testing.T) context.Context {
	t.Helper()
	return testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))
}

func (f *coinPackFixture) startCheckout(t *testing.T, packID uuid.UUID, returnEpisodeID string) error {
	t.Helper()
	_, err := f.coins.StartCoinPackCheckout(f.readerCtx(t), &publirav1.StartCoinPackCheckoutRequest{
		Tenant:          tenantContext(f.tenant),
		CoinPackId:      packID.String(),
		ReturnEpisodeId: returnEpisodeID,
		Locale:          "en",
	})
	return err
}

// deliver posts a Stripe notification of eventType about object.
func (f *coinPackFixture) deliver(t *testing.T, eventType string, object map[string]any) {
	t.Helper()
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, eventType, object)
	if _, err := f.purchases.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(f.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(%s): %v", eventType, err)
	}
}

// pay completes the checkout last started, as Stripe reports it, with the
// payment intent pi_<checkoutID>.
func (f *coinPackFixture) pay(t *testing.T, checkoutID string) {
	t.Helper()
	purchase := f.checkout.input.Purchase
	f.deliver(t, "checkout.session.completed", map[string]any{
		"id":             checkoutID,
		"object":         "checkout.session",
		"amount_total":   purchase.Price,
		"currency":       strings.ToLower(purchase.Currency),
		"payment_status": "paid",
		"livemode":       true,
		"payment_intent": "pi_" + checkoutID,
		"metadata":       stripetest.PurchaseMetadata(purchase),
	})
}

// buy starts a checkout of the fixture's pack and pays it.
func (f *coinPackFixture) buy(t *testing.T, checkoutID string) {
	t.Helper()
	if err := f.startCheckout(t, f.pack.ID, ""); err != nil {
		t.Fatalf("StartCoinPackCheckout: %v", err)
	}
	f.pay(t, checkoutID)
}

// refund reports amountRefunded refunded in all on the payment of a checkout
// of the pack at 1,000, in the currency it was paid in.
func (f *coinPackFixture) refund(t *testing.T, checkoutID string, amountRefunded int64) {
	t.Helper()
	charge := refundedCharge("pi_"+checkoutID, 1000, amountRefunded)
	charge["currency"] = strings.ToLower(f.checkout.input.Purchase.Currency)
	f.deliver(t, "charge.refunded", charge)
}

func (f *coinPackFixture) balance(t *testing.T) *publirav1.CoinBalance {
	t.Helper()
	res, err := f.coins.GetCoinBalance(f.readerCtx(t), &publirav1.GetCoinBalanceRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetCoinBalance: %v", err)
	}
	return res.GetBalance()
}

func (f *coinPackFixture) spend(t *testing.T, coins int32, key string) {
	t.Helper()
	f.spendOn(t, f.episode.ID, coins, key)
}

// spendOn opens an episode with coins and answers the purchase they paid for.
func (f *coinPackFixture) spendOn(t *testing.T, episodeID uuid.UUID, coins int32, key string) *publirav1.MyPurchase {
	t.Helper()
	res, err := f.coins.PayEpisodeWithCoins(f.readerCtx(t), &publirav1.PayEpisodeWithCoinsRequest{
		Tenant:         tenantContext(f.tenant),
		EpisodeId:      episodeID.String(),
		Coins:          coins,
		IdempotencyKey: key,
	})
	if err != nil {
		t.Fatalf("PayEpisodeWithCoins: %v", err)
	}
	return res.GetPurchase()
}

// soldFor answers what the purchase records of a sale: its price, what is
// refunded of it, and whether it was refunded in full or revoked.
func (f *coinPackFixture) soldFor(t *testing.T, purchaseID string) (price, refunded int32, closed bool) {
	t.Helper()
	var refundedAmount sql.NullInt32
	if err := f.env.PG.DB.QueryRowContext(context.Background(), `
		SELECT price_at_purchase, refunded_amount, refunded_at IS NOT NULL OR revoked_at IS NOT NULL
		FROM purchases
		WHERE tenant_id = $1 AND id = $2
	`, f.tenant.ID, purchaseID).Scan(&price, &refundedAmount, &closed); err != nil {
		t.Fatalf("read purchase %s: %v", purchaseID, err)
	}
	return price, refundedAmount.Int32, closed
}

// pricedEpisode seeds a published episode of the fixture's series at price.
func (f *coinPackFixture) pricedEpisode(t *testing.T, publicID string, price int32) testutil.Episode {
	t.Helper()
	return f.env.PG.SeedEpisode(t, f.tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: publicID,
		Title:    publicID,
		Price:    price,
		Status:   testutil.EpisodeStatusPublished,
	})
}

// history answers the reader's coin history, oldest first, as kind and coins.
func (f *coinPackFixture) history(t *testing.T) []string {
	t.Helper()
	res, err := f.coins.ListCoinTransactions(f.readerCtx(t), &publirav1.ListCoinTransactionsRequest{Tenant: tenantContext(f.tenant), Limit: 100})
	if err != nil {
		t.Fatalf("ListCoinTransactions: %v", err)
	}
	entries := make([]string, 0, len(res.GetTransactions()))
	for i := len(res.GetTransactions()) - 1; i >= 0; i-- {
		transaction := res.GetTransactions()[i]
		entries = append(entries, strings.TrimPrefix(transaction.GetKind().String(), "COIN_TRANSACTION_KIND_")+" "+strconv.Itoa(int(transaction.GetCoins())))
	}
	return entries
}

// Buying a pack on the web grants its coins once the provider's notification
// confirms the payment, and not before, on the terms the checkout was started
// on, with the tenant's expiry counted from the purchase.
func TestDBBuyingACoinPackOnTheWebGrantsItsCoinsOnceThePaymentIsConfirmed(t *testing.T) {
	f := newCoinPackFixture(t)

	if err := f.startCheckout(t, f.pack.ID, ""); err != nil {
		t.Fatalf("StartCoinPackCheckout: %v", err)
	}
	started := f.checkout.input
	if want := (paymentprovider.Purchase{
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		CoinPackID:     f.pack.ID,
		Coins:          1000,
		BonusCoins:     100,
		CoinExpiryDays: 180,
		Kind:           paymentprovider.KindPurchase,
		Price:          1000,
		Currency:       started.Purchase.Currency,
	}); started.Purchase != want {
		t.Fatalf("checkout purchase = %+v, want %+v", started.Purchase, want)
	}
	if started.LineItemName != "1,100 Points (including 100 bonus)" {
		t.Fatalf("line item = %q, want the coins it grants under the tenant's word in en", started.LineItemName)
	}
	success, err := url.Parse(started.SuccessURL)
	if err != nil {
		t.Fatalf("parse success URL: %v", err)
	}
	if success.Path != "/my/coins" || success.Query().Get("checkout") != "success" || success.Query().Get("coin_pack") != f.pack.PublicID {
		t.Fatalf("success URL = %s, want the coins page naming the pack", started.SuccessURL)
	}
	if !strings.HasPrefix(started.IdempotencyKey, "coin-pack-checkout:") {
		t.Fatalf("idempotency key = %q, want one of a coin pack checkout", started.IdempotencyKey)
	}
	if got := f.balance(t).GetCoins(); got != 0 {
		t.Fatalf("balance before the payment is confirmed = %d, want 0", got)
	}

	// The tenant edits the pack before the payment arrives, which it may while
	// the pack has never been sold. The reader pays for what they were shown.
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET coins = 2000 WHERE id = $1`, f.pack.ID); err != nil {
		t.Fatalf("edit the pack: %v", err)
	}
	f.pay(t, "cs_pack")
	// A redelivery of the same checkout grants nothing more.
	f.pay(t, "cs_pack")

	balance := f.balance(t)
	if balance.GetCoins() != 1100 || balance.GetNearestExpiryCoins() != 1100 || balance.GetShortfallCoins() != 0 {
		t.Fatalf("balance = %+v, want 1,100 coins owing nothing", balance)
	}
	var purchasedAt time.Time
	if err := f.env.PG.DB.QueryRowContext(context.Background(), `SELECT purchased_at FROM purchases WHERE tenant_id = $1 AND coin_pack_id = $2`, f.tenant.ID, f.pack.ID).Scan(&purchasedAt); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	expiresAt, err := time.Parse(time.RFC3339, balance.GetNearestExpiryAt())
	if err != nil {
		t.Fatalf("parse nearest_expiry_at %q: %v", balance.GetNearestExpiryAt(), err)
	}
	if want := purchasedAt.UTC().AddDate(0, 0, 180).Truncate(time.Second); !expiresAt.Equal(want) {
		t.Fatalf("coins expire at %s, want 180 days after the purchase, %s", expiresAt, want)
	}

	for query, want := range map[string]int{
		`SELECT count(*) FROM purchases WHERE tenant_id = $1 AND coin_pack_id IS NOT NULL AND episode_id IS NULL AND expires_at IS NULL AND price_at_purchase = 1000`: 1,
		`SELECT count(*) FROM coin_pack_purchases WHERE tenant_id = $1 AND coins = 1000 AND bonus_coins = 100`:                                                        1,
		`SELECT count(*) FROM coin_grants WHERE tenant_id = $1 AND source = 'pack_purchase' AND coins = 1100`:                                                         1,
		`SELECT count(*) FROM tenant_coin_packs WHERE tenant_id = $1 AND first_sold_at IS NOT NULL`:                                                                   1,
		`SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = 'purchase_receipt'`:                                                                 1,
		`SELECT count(*) FROM episode_grants WHERE tenant_id = $1`:                                                                                                    0,
	} {
		if got := f.env.countRows(t, query, f.tenant.ID); got != want {
			t.Fatalf("%s = %d, want %d", query, got, want)
		}
	}
	if got := f.history(t); strings.Join(got, ",") != "GRANT 1100" {
		t.Fatalf("coin history = %v, want the grant", got)
	}

	library, err := f.purchases.ListMyPurchases(f.readerCtx(t), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(f.tenant), Locale: "en"})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.GetPurchases()) != 1 {
		t.Fatalf("purchase history = %v, want the pack", library.GetPurchases())
	}
	bought := library.GetPurchases()[0]
	if pack := bought.GetCoinPack(); pack.GetId() != f.pack.ID.String() || pack.GetPublicId() != f.pack.PublicID || pack.GetCoins() != 1000 || pack.GetBonusCoins() != 100 {
		t.Fatalf("purchased pack = %+v, want the pack as the reader was shown it", pack)
	}
	if bought.GetCoinName() != "Points" || bought.GetSeries() != nil || bought.GetEpisode() != nil || !bought.GetIsActive() || bought.GetPriceAtPurchase() != 1000 {
		t.Fatalf("purchase history entry = %+v, want an active pack of Points at 1,000 of no series", bought)
	}
	// The app lists the pack too: its coins are spent on either surface.
	app, err := f.purchases.ListMyPurchases(f.readerCtx(t), &publirav1.ListMyPurchasesRequest{
		Tenant:  tenantContext(f.tenant),
		Surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
	})
	if err != nil {
		t.Fatalf("ListMyPurchases in the app: %v", err)
	}
	if len(app.GetPurchases()) != 1 || app.GetPurchases()[0].GetCoinName() != "Tickets" {
		t.Fatalf("purchase history in the app = %v, want the pack under the ja name", app.GetPurchases())
	}

	// Each purchase of the same pack is a checkout of its own.
	paidKey := started.IdempotencyKey
	if err := f.startCheckout(t, f.pack.ID, f.episode.ID.String()); err != nil {
		t.Fatalf("StartCoinPackCheckout again: %v", err)
	}
	again := f.checkout.input
	if again.IdempotencyKey == paidKey {
		t.Fatal("a second purchase of the pack reuses the paid checkout's idempotency key")
	}
	if again.Purchase.Coins != 2000 {
		t.Fatalf("second checkout grants %d coins, want the pack as it is now", again.Purchase.Coins)
	}
	back, err := url.Parse(again.SuccessURL)
	if err != nil {
		t.Fatalf("parse success URL: %v", err)
	}
	if back.Path != "/series/"+f.series.PublicID+"/episodes/"+f.episode.PublicID || back.Query().Get("coin_pack") != f.pack.PublicID {
		t.Fatalf("success URL = %s, want the episode the reader was short of coins for", again.SuccessURL)
	}
}

// A checkout is refused unless the tenant sells packs now, while the reader
// spends the coins they hold whether or not it does.
func TestDBStartCoinPackCheckoutRefusesWhatItCannotSell(t *testing.T) {
	t.Run("the platform forbids tenant coins", func(t *testing.T) {
		f := newCoinPackFixtureUnder(t, false)
		err := f.startCheckout(t, f.pack.ID, "")
		if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonCoinsUnavailable {
			t.Fatalf("checkout = %v, want failed_precondition with COINS_UNAVAILABLE", err)
		}
	})

	f := newCoinPackFixture(t)
	f.env.PG.SeedCoinGrant(t, f.tenant.ID, f.reader.ID, 50, time.Now().Add(30*24*time.Hour))
	setConfig := func(column string, value bool) {
		t.Helper()
		if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_config SET `+column+` = $2 WHERE tenant_id = $1`, f.tenant.ID, value); err != nil {
			t.Fatalf("set %s: %v", column, err)
		}
	}

	setConfig("selling", false)
	if err := f.startCheckout(t, f.pack.ID, ""); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("checkout while not selling = %v, want failed_precondition", err)
	}
	f.spend(t, 30, "while-not-selling")
	if got := f.balance(t).GetCoins(); got != 20 {
		t.Fatalf("balance after spending while not selling = %d, want 20", got)
	}

	setConfig("enabled", false)
	err := f.startCheckout(t, f.pack.ID, "")
	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonCoinsUnavailable {
		t.Fatalf("checkout while coins are off = %v, want COINS_UNAVAILABLE", err)
	}
	setConfig("enabled", true)
	setConfig("selling", true)

	offSale := f.env.PG.SeedCoinPack(t, f.tenant.ID, testutil.CoinPackSeed{OffSale: true})
	if err := f.startCheckout(t, offSale.ID, ""); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("checkout of a pack off sale = %v, want not_found", err)
	}
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET retired_at = now(), on_sale = false WHERE id = $1`, f.pack.ID); err != nil {
		t.Fatalf("retire the pack: %v", err)
	}
	if err := f.startCheckout(t, f.pack.ID, ""); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("checkout of a retired pack = %v, want not_found", err)
	}
	other := f.env.seedTenant(t, "PACKTENANT02", "other-packs.example.com", "Other")
	theirs := f.env.PG.SeedCoinPack(t, other.ID, testutil.CoinPackSeed{})
	if err := f.startCheckout(t, theirs.ID, ""); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("checkout of another tenant's pack = %v, want not_found", err)
	}

	onSale := f.env.PG.SeedCoinPack(t, f.tenant.ID, testutil.CoinPackSeed{})
	if err := f.startCheckout(t, onSale.ID, uuid.NewString()); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("checkout returning to no episode = %v, want invalid_argument", err)
	}
	if err := f.startCheckout(t, onSale.ID, ""); err != nil {
		t.Fatalf("checkout of a pack on sale: %v", err)
	}
}

// A full refund of a pack nobody has spent from takes every coin of it back.
func TestDBAFullRefundOfAnUnspentPackTakesItsCoinsBack(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_unspent")

	f.refund(t, "cs_unspent", 400)
	if got := f.balance(t).GetCoins(); got != 1100 {
		t.Fatalf("balance after a partial refund = %d, want the pack's coins kept", got)
	}
	f.refund(t, "cs_unspent", 1000)
	// A refund reported again changes nothing more.
	f.refund(t, "cs_unspent", 1000)

	balance := f.balance(t)
	if balance.GetCoins() != 0 || balance.GetShortfallCoins() != 0 {
		t.Fatalf("balance after a full refund = %+v, want nothing held and nothing owed", balance)
	}
	if got := f.history(t); strings.Join(got, ",") != "GRANT 1100,REVOCATION 1100" {
		t.Fatalf("coin history = %v, want the grant and its revocation", got)
	}
	library, err := f.purchases.ListMyPurchases(f.readerCtx(t), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if bought := library.GetPurchases()[0]; bought.GetIsActive() || bought.GetRefundedAt() == "" {
		t.Fatalf("refunded pack = %+v, want refunded and inactive", bought)
	}
}

// A refund of a pack partly spent takes back what is left and records what was
// spent as a shortfall, which the reader's next pack pays before any coin of
// it can be spent.
func TestDBARefundOfAHalfSpentPackLeavesAShortfallTheNextPackCovers(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_first")
	f.spend(t, 30, "episode")

	f.refund(t, "cs_first", 1000)
	balance := f.balance(t)
	if balance.GetCoins() != 0 || balance.GetShortfallCoins() != 30 {
		t.Fatalf("balance after the refund = %+v, want nothing held and 30 owed", balance)
	}
	// The episode the coins paid for stays open: the shortfall is what it cost.
	if got := f.env.countRows(t, `SELECT count(*) FROM episode_grants WHERE tenant_id = $1 AND episode_id = $2`, f.tenant.ID, f.episode.ID); got != 1 {
		t.Fatalf("grants of the episode = %d, want the coin purchase to keep opening it", got)
	}

	f.buy(t, "cs_second")
	balance = f.balance(t)
	if balance.GetCoins() != 1070 || balance.GetShortfallCoins() != 0 {
		t.Fatalf("balance after the next pack = %+v, want 1,070 held and nothing owed", balance)
	}
	if got := f.history(t); strings.Join(got, ",") != "GRANT 1100,SPEND 30,REVOCATION 1070,SHORTFALL 30,GRANT 1100,SHORTFALL_SETTLEMENT 30" {
		t.Fatalf("coin history = %v", got)
	}

	// Refunding the pack that paid the shortfall leaves it owed again: the
	// coins it paid with are spent coins of that pack.
	f.refund(t, "cs_second", 1000)
	balance = f.balance(t)
	if balance.GetCoins() != 0 || balance.GetShortfallCoins() != 30 {
		t.Fatalf("balance after refunding the second pack = %+v, want 30 owed again", balance)
	}
}

// A dispute closes a pack's coins at once, before the dispute is decided.
func TestDBADisputeOfAPackClosesItsCoinsAtOnce(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_disputed")
	f.spend(t, 30, "episode")

	payload, headers := stripetest.NewFixture(t).Disputed(t, stripeFixtureCredentials, "pi_cs_disputed")
	if _, err := f.purchases.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(f.tenant.ID.String(), payload, headers)); err != nil {
		t.Fatalf("ProcessPaymentWebhook: %v", err)
	}
	balance := f.balance(t)
	if balance.GetCoins() != 0 || balance.GetShortfallCoins() != 30 {
		t.Fatalf("balance after the dispute = %+v, want nothing held and 30 owed", balance)
	}
}

// A refund that reaches the server before the payment it refunds is held, and
// closes the pack's coins as the purchase is recorded.
func TestDBARefundThatOvertakesItsPackClosesTheCoinsAsTheyAreGranted(t *testing.T) {
	f := newCoinPackFixture(t)
	if err := f.startCheckout(t, f.pack.ID, ""); err != nil {
		t.Fatalf("StartCoinPackCheckout: %v", err)
	}
	f.refund(t, "cs_overtaken", 1000)
	f.pay(t, "cs_overtaken")

	if got := f.balance(t).GetCoins(); got != 0 {
		t.Fatalf("balance = %d, want the overtaken refund to take the coins back", got)
	}
	if got := f.history(t); strings.Join(got, ",") != "GRANT 1100,REVOCATION 1100" {
		t.Fatalf("coin history = %v, want the grant and its revocation", got)
	}
}

// An episode paid with coins of a pack is a sale at what those coins were paid
// for: each of the pack's 1,100 coins, its bonus coins among them, is worth
// its 1,000 spread over all of them, so 100 coins are worth 90.9, rounded
// down. The reader is shown the coins they spent, and no price.
func TestDBASpendOfPackCoinsIsASaleAtWhatTheCoinsWerePaidFor(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_valued")
	episode := f.pricedEpisode(t, "PACKEPISODE2", 1000)

	purchase := f.spendOn(t, episode.ID, 100, "valued")
	if price, refunded, _ := f.soldFor(t, purchase.GetId()); price != 90 || refunded != 0 {
		t.Fatalf("sale = %d with %d refunded, want 90 with nothing refunded", price, refunded)
	}
	if purchase.GetPriceAtPurchase() != 0 || purchase.GetCoinsSpent() != 100 {
		t.Fatalf("purchase shown to the reader = %+v, want 100 coins spent and no price", purchase)
	}
	if got := f.env.countRows(t, `SELECT count(*) FROM coin_spend_allocations WHERE tenant_id = $1 AND coins = 100 AND amount = 90`, f.tenant.ID); got != 1 {
		t.Fatalf("allocations of 100 coins worth 90 = %d, want 1", got)
	}
}

// Coins granted without a payment are worth nothing, so a spend that draws on
// them and on a pack is a sale at what its pack coins alone were paid for.
// Coins of a test purchase paid the tenant nothing either.
func TestDBCoinsNoOnePaidForAreWorthNothing(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_mixed")
	// Staff's coins expire before the pack's, so they are spent first.
	f.env.PG.SeedCoinGrant(t, f.tenant.ID, f.reader.ID, 50, time.Now().Add(24*time.Hour))
	episode := f.pricedEpisode(t, "PACKEPISODE2", 1000)

	purchase := f.spendOn(t, episode.ID, 100, "mixed")
	if price, _, _ := f.soldFor(t, purchase.GetId()); price != 45 {
		t.Fatalf("sale = %d, want 45 for 50 coins of staff's and 50 of the pack's", price)
	}

	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE purchases SET is_test = true WHERE tenant_id = $1 AND coin_pack_id IS NOT NULL`, f.tenant.ID); err != nil {
		t.Fatalf("mark the pack purchase a test: %v", err)
	}
	purchase = f.spendOn(t, f.episode.ID, 30, "test")
	if price, _, _ := f.soldFor(t, purchase.GetId()); price != 0 {
		t.Fatalf("sale = %d, want 0 for coins of a test purchase", price)
	}
}

// A refund of a pack in full refunds, on each purchase its coins paid for, what
// those coins were worth, and leaves the episode open: the coins it paid with
// are what the reader now owes. A purchase whose coins came from several packs
// is refunded the part the refunded pack paid. The reader is shown no refund.
func TestDBARefundOfAPackRefundsTheSalesItsCoinsPaidFor(t *testing.T) {
	f := newCoinPackFixture(t)
	f.buy(t, "cs_refunded")
	episode := f.pricedEpisode(t, "PACKEPISODE2", 1000)
	whole := f.spendOn(t, episode.ID, 100, "whole")
	// The pack has 1,000 coins left. A second one, bought later, expires later
	// and is drawn on once the first runs out.
	f.buy(t, "cs_kept")
	big := f.pricedEpisode(t, "PACKEPISODE3", 15000)
	split := f.spendOn(t, big.ID, 1500, "split")
	if price, _, _ := f.soldFor(t, split.GetId()); price != 909+454 {
		t.Fatalf("split sale = %d, want 909 for 1,000 coins of the first pack and 454 for 500 of the second", price)
	}

	f.refund(t, "cs_refunded", 1000)
	if price, refunded, closed := f.soldFor(t, whole.GetId()); price != 90 || refunded != 90 || closed {
		t.Fatalf("sale paid with the refunded pack = %d with %d refunded (closed %v), want 90 refunded in full and left open", price, refunded, closed)
	}
	if price, refunded, closed := f.soldFor(t, split.GetId()); price != 1363 || refunded != 909 || closed {
		t.Fatalf("split sale = %d with %d refunded (closed %v), want the refunded pack's 909 of 1,363 refunded", price, refunded, closed)
	}
	// Refunding the pack again takes nothing more back.
	f.refund(t, "cs_refunded", 1000)
	if _, refunded, _ := f.soldFor(t, whole.GetId()); refunded != 90 {
		t.Fatalf("refunded after the refund was reported again = %d, want 90", refunded)
	}

	library, err := f.purchases.ListMyPurchases(f.readerCtx(t), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	for _, bought := range library.GetPurchases() {
		if bought.GetCoinsSpent() == 0 {
			continue
		}
		if bought.GetRefundedAmount() != 0 || bought.GetRefundedAt() != "" || !bought.GetIsActive() {
			t.Fatalf("purchase paid with coins = %+v, want it open with no refund shown", bought)
		}
	}
}

// The catalog message names the bonus coins only when a pack grants any.
func TestCoinPackLineItemNameNamesTheBonusOnlyWhenThereIsOne(t *testing.T) {
	for _, tc := range []struct {
		code              string
		coins, bonusCoins int32
		coinName, want    string
	}{
		{code: "en", coins: 1000, bonusCoins: 100, coinName: "Points", want: "1,100 Points (including 100 bonus)"},
		{code: "en", coins: 500, coinName: "Points", want: "500 Points"},
		{code: "ja", coins: 1000, bonusCoins: 100, coinName: "ポイント", want: "1,100ポイント（うちボーナス100）"},
		{code: "ja", coins: 500, coinName: "ポイント", want: "500ポイント"},
	} {
		got, err := coinPackLineItemName(tc.code, tc.coinName, tc.coins, tc.bonusCoins)
		if err != nil {
			t.Fatalf("coinPackLineItemName(%s, %d, %d): %v", tc.code, tc.coins, tc.bonusCoins, err)
		}
		if got != tc.want {
			t.Errorf("coinPackLineItemName(%s, %d, %d) = %q, want %q", tc.code, tc.coins, tc.bonusCoins, got, tc.want)
		}
	}
}
