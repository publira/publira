package publicapi

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/coinexpiry"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// coinFixture is a tenant whose default locale is ja and whose coins are on at
// 10 a coin, named in ja and en, under a platform that allows tenant coins,
// with one reader signed in and a published series of one episode at 300.
type coinFixture struct {
	env     *publicDBEnv
	tenant  testutil.Tenant
	reader  testutil.TenantUser
	series  testutil.Series
	episode testutil.Episode
	coins   publirav1connect.CoinServiceClient
}

func newCoinFixture(t *testing.T) *coinFixture {
	t.Helper()
	return newCoinFixtureUnder(t, true)
}

// newCoinFixtureUnder is newCoinFixture under a platform that allows tenant
// coins or forbids them.
func newCoinFixtureUnder(t *testing.T, platformAllows bool) *coinFixture {
	t.Helper()

	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.TenantCoinsAllowed = platformAllows
	}))
	tenant := env.seedTenant(t, "COINTENANT", "coins.example.com", "Coin tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "COINREADER01", "reader@coins.example.com", "Reader")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "COINSERIES01", Title: "Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "COINEPISODE1",
		Title:    "Episode",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedCoinSettings(t, tenant.ID, testutil.CoinSettingsSeed{Names: map[string]string{"ja": "Tickets", "en": "Points"}})
	return &coinFixture{
		env:     env,
		tenant:  tenant,
		reader:  reader,
		series:  series,
		episode: episode,
		coins:   publirav1connect.NewCoinServiceClient(connect.NewClient(connecthttp.NewTransport(env.Server.Client(), env.Server.URL))),
	}
}

func (f *coinFixture) readerCtx(t *testing.T) context.Context {
	t.Helper()
	return testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))
}

func (f *coinFixture) grant(t *testing.T, coins int32, expiresIn time.Duration) uuid.UUID {
	t.Helper()
	return f.env.PG.SeedCoinGrant(t, f.tenant.ID, f.reader.ID, coins, time.Now().Add(expiresIn))
}

func (f *coinFixture) pay(t *testing.T, kind publirattypesv1.PurchaseKind, coins int32, key string) (*publirav1.PayEpisodeWithCoinsResponse, error) {
	t.Helper()
	return f.coins.PayEpisodeWithCoins(f.readerCtx(t), &publirav1.PayEpisodeWithCoinsRequest{
		Tenant:         tenantContext(f.tenant),
		EpisodeId:      f.episode.ID.String(),
		Kind:           kind,
		Coins:          coins,
		IdempotencyKey: key,
	})
}

func (f *coinFixture) balance(t *testing.T) *publirav1.CoinBalance {
	t.Helper()
	res, err := f.coins.GetCoinBalance(f.readerCtx(t), &publirav1.GetCoinBalanceRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetCoinBalance: %v", err)
	}
	return res.GetBalance()
}

func (f *coinFixture) episodeDetail(t *testing.T, locale string) *publirattypesv1.Episode {
	t.Helper()
	res, err := f.env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(f.tenant),
		PublicId: f.episode.PublicID,
		Locale:   locale,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	return res.GetEpisode()
}

func (f *coinFixture) countRows(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := f.env.PG.DB.QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return count
}

// errorInfoOf is the ErrorInfo a refusal carries, failing the test when it
// carries none.
func errorInfoOf(t *testing.T, err error) *errdetails.ErrorInfo {
	t.Helper()
	reason, metadata := errorInfoReason(err)
	if reason == "" {
		t.Fatalf("error %v carries no ErrorInfo", err)
	}
	return &errdetails.ErrorInfo{Reason: reason, Metadata: metadata}
}

func TestCoinPriceOfRoundsUp(t *testing.T) {
	for _, tc := range []struct {
		price, unit, want int32
	}{
		{price: 300, unit: 10, want: 30},
		{price: 305, unit: 10, want: 31},
		{price: 1, unit: 10, want: 1},
		{price: 300, unit: 1, want: 300},
		{price: 2147483647, unit: 1, want: 2147483647},
	} {
		if got := coinPriceOf(tc.price, tc.unit); got != tc.want {
			t.Fatalf("coinPriceOf(%d, %d) = %d, want %d", tc.price, tc.unit, got, tc.want)
		}
	}
}

func TestDBPayEpisodeWithCoinsOpensTheEpisodeAndRecordsAPurchase(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 50, 30*24*time.Hour)

	if got := f.episodeDetail(t, "").GetCoinPrice(); got != 30 {
		t.Fatalf("coin_price = %d, want 30 for 300 at 10 a coin", got)
	}
	res, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_UNSPECIFIED, 30, "tap-1")
	if err != nil {
		t.Fatalf("PayEpisodeWithCoins: %v", err)
	}
	if got := res.GetBalance().GetCoins(); got != 20 {
		t.Fatalf("balance after paying = %d, want 20", got)
	}
	purchase := res.GetPurchase()
	if purchase.GetCoinsSpent() != 30 || purchase.GetCoinName() != "Tickets" || !purchase.GetIsActive() {
		t.Fatalf("purchase = %+v, want an active purchase of 30 Tickets", purchase)
	}
	if purchase.GetEpisode().GetId() != f.episode.ID.String() || purchase.GetSeries().GetId() != f.series.ID.String() {
		t.Fatalf("purchase names episode %q of series %q, want %s of %s", purchase.GetEpisode().GetId(), purchase.GetSeries().GetId(), f.episode.ID, f.series.ID)
	}
	if purchase.GetPriceAtPurchase() != 0 {
		t.Fatalf("price_at_purchase = %d, want 0 for a purchase that took no payment", purchase.GetPriceAtPurchase())
	}

	library, err := publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(f.env.Server.Client(), f.env.Server.URL))).
		ListMyPurchases(f.readerCtx(t), &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(f.tenant), Locale: "en"})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.GetPurchases()) != 1 {
		t.Fatalf("purchase history = %d purchases, want 1", len(library.GetPurchases()))
	}
	if got := library.GetPurchases()[0]; got.GetId() != purchase.GetId() || got.GetCoinsSpent() != 30 || got.GetCoinName() != "Points" {
		t.Fatalf("purchase history entry = %+v, want %s paid with 30 Points", got, purchase.GetId())
	}
	if got := f.countRows(t, `SELECT count(*) FROM episode_grants WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3 AND purchase_kind = 'purchase'`, f.tenant.ID, f.reader.ID, f.episode.ID); got != 1 {
		t.Fatalf("grants of the episode = %d, want the purchase to open it", got)
	}
	if got := f.countRows(t, `SELECT count(*) FROM purchases WHERE tenant_id = $1 AND provider = 'coins'`, f.tenant.ID); got != 1 {
		t.Fatalf("purchases paid with coins = %d, want 1", got)
	}
}

func TestDBPayEpisodeWithCoinsRentsAnEpisodeForItsPeriod(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 50, 30*24*time.Hour)
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE episode_listings SET rental_price = 101, rental_period_hours = 48 WHERE episode_id = $1`, f.episode.ID); err != nil {
		t.Fatalf("rent the episode: %v", err)
	}

	if got := f.episodeDetail(t, "").GetCoinRentalPrice(); got != 11 {
		t.Fatalf("coin_rental_price = %d, want 11 for 101 at 10 a coin, rounded up", got)
	}
	res, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL, 11, "rent-1")
	if err != nil {
		t.Fatalf("PayEpisodeWithCoins: %v", err)
	}
	purchase := res.GetPurchase()
	if purchase.GetKind() != publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL || purchase.GetExpiresAt() == "" {
		t.Fatalf("purchase = %+v, want a rental with an expiry", purchase)
	}
	expiresAt, err := time.Parse(time.RFC3339, purchase.GetExpiresAt())
	if err != nil {
		t.Fatalf("parse expires_at: %v", err)
	}
	if until := time.Until(expiresAt); until < 47*time.Hour || until > 49*time.Hour {
		t.Fatalf("rental expires in %s, want 48h", until)
	}
	if res.GetBalance().GetCoins() != 39 {
		t.Fatalf("balance = %d, want 39", res.GetBalance().GetCoins())
	}
}

func TestDBPayEpisodeWithCoinsRefusesAShortBalanceWithTheShortfall(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 12, 30*24*time.Hour)

	_, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "tap-1")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("PayEpisodeWithCoins code = %v, want failed_precondition", connect.CodeOf(err))
	}
	info := errorInfoOf(t, err)
	if info.GetReason() != rpcerrors.ReasonCoinBalanceInsufficient || info.GetMetadata()[rpcerrors.MetadataShortfall] != "18" {
		t.Fatalf("ErrorInfo = %+v, want %s with a shortfall of 18", info, rpcerrors.ReasonCoinBalanceInsufficient)
	}
	if got := f.balance(t).GetCoins(); got != 12 {
		t.Fatalf("balance after the refusal = %d, want the 12 untouched", got)
	}
	if got := f.countRows(t, `SELECT count(*) FROM purchases WHERE tenant_id = $1`, f.tenant.ID); got != 0 {
		t.Fatalf("purchases = %d, want none", got)
	}
}

func TestDBPayEpisodeWithCoinsSpendsTheCoinsThatExpireFirst(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	later := f.grant(t, 20, 20*24*time.Hour)
	sooner := f.grant(t, 15, 5*24*time.Hour)

	balance := f.balance(t)
	if balance.GetCoins() != 35 || balance.GetNearestExpiryCoins() != 15 {
		t.Fatalf("balance = %+v, want 35 with the 15 that expire first next", balance)
	}
	if _, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "tap-1"); err != nil {
		t.Fatalf("PayEpisodeWithCoins: %v", err)
	}
	remaining := func(grantID uuid.UUID) int {
		return f.countRows(t, `SELECT remaining_coins FROM coin_grants WHERE id = $1`, grantID)
	}
	if got := remaining(sooner); got != 0 {
		t.Fatalf("the grant that expires first has %d left, want it spent first", got)
	}
	if got := remaining(later); got != 5 {
		t.Fatalf("the later grant has %d left, want 5", got)
	}
	if got := f.countRows(t, `SELECT coins FROM coin_spend_allocations WHERE grant_id = $1`, sooner); got != 15 {
		t.Fatalf("the spend drew %d on the sooner grant, want 15", got)
	}
	if got := f.balance(t); got.GetCoins() != 5 || got.GetNearestExpiryCoins() != 5 {
		t.Fatalf("balance after paying = %+v, want the later grant's 5", got)
	}
}

func TestDBPayEpisodeWithCoinsSpendsOnceForARepeatedKey(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 100, 30*24*time.Hour)

	first, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "double-tap")
	if err != nil {
		t.Fatalf("first PayEpisodeWithCoins: %v", err)
	}
	second, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "double-tap")
	if err != nil {
		t.Fatalf("repeated PayEpisodeWithCoins: %v", err)
	}
	if second.GetPurchase().GetId() != first.GetPurchase().GetId() {
		t.Fatalf("repeated payment answered purchase %s, want the first one's %s", second.GetPurchase().GetId(), first.GetPurchase().GetId())
	}
	if got := second.GetBalance().GetCoins(); got != 70 {
		t.Fatalf("balance after the repeat = %d, want 70: spent once", got)
	}
	if _, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL, 30, "double-tap"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the key sent for another kind: code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if _, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "another-tap"); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("paying again under another key: code = %v, want already_exists", connect.CodeOf(err))
	}
	if got := f.countRows(t, `SELECT count(*) FROM coin_transactions WHERE tenant_id = $1 AND kind = 'spend'`, f.tenant.ID); got != 1 {
		t.Fatalf("spends = %d, want 1", got)
	}
}

func TestDBPayEpisodeWithCoinsRefusesAPriceTheReaderWasNotShown(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 100, 30*24*time.Hour)

	_, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 25, "tap-1")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if info := errorInfoOf(t, err); info.GetReason() != rpcerrors.ReasonCoinPriceChanged || info.GetMetadata()[rpcerrors.MetadataCoinPrice] != "30" {
		t.Fatalf("ErrorInfo = %+v, want %s naming 30", info, rpcerrors.ReasonCoinPriceChanged)
	}
	if got := f.balance(t).GetCoins(); got != 100 {
		t.Fatalf("balance = %d, want 100 untouched", got)
	}
}

// The coin name follows the reader's locale and falls back to the tenant
// default locale's, as a series title does.
func TestDBCoinNameFollowsTheReadersLocale(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)

	for _, tc := range []struct{ locale, want string }{
		{locale: "", want: "Tickets"},
		{locale: "en", want: "Points"},
		{locale: "ko", want: "Tickets"},
	} {
		settings, err := f.coins.GetCoinSettings(context.Background(), &publirav1.GetCoinSettingsRequest{Tenant: tenantContext(f.tenant), Locale: tc.locale})
		if err != nil {
			t.Fatalf("GetCoinSettings(%q): %v", tc.locale, err)
		}
		if got := settings.GetSettings().GetCoinName(); got != tc.want {
			t.Fatalf("GetCoinSettings(%q) coin_name = %q, want %q", tc.locale, got, tc.want)
		}
		if got := f.episodeDetail(t, tc.locale).GetCoinName(); got != tc.want {
			t.Fatalf("Episode.coin_name in %q = %q, want %q", tc.locale, got, tc.want)
		}
	}
}

func TestDBGetCoinSettingsAnswersThePacksOnSale(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	ctx := context.Background()
	for _, pack := range []struct {
		publicID string
		coins    int32
		onSale   bool
	}{{"COINPACK0001", 100, true}, {"COINPACK0002", 500, false}} {
		if _, err := f.env.PG.DB.ExecContext(ctx, `
			INSERT INTO tenant_coin_packs (id, tenant_id, public_id, coins, bonus_coins, price, on_sale)
			VALUES ($1, $2, $3, $4, 10, $4 * 10, $5)
		`, uuid.Must(uuid.NewV7()), f.tenant.ID, pack.publicID, pack.coins, pack.onSale); err != nil {
			t.Fatalf("insert pack: %v", err)
		}
	}

	res, err := f.coins.GetCoinSettings(ctx, &publirav1.GetCoinSettingsRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetCoinSettings: %v", err)
	}
	settings := res.GetSettings()
	if settings.GetCoinUnitAmount() != 10 || settings.GetExpiryDays() != 180 || !settings.GetSelling() || settings.GetDisclosures().GetIssuerName() == "" {
		t.Fatalf("settings = %+v, want 10 a coin, 180 days, selling, with the disclosures", settings)
	}
	if len(settings.GetPacks()) != 1 || settings.GetPacks()[0].GetPublicId() != "COINPACK0001" || settings.GetPacks()[0].GetPrice() != 1000 {
		t.Fatalf("packs = %v, want the one on sale", settings.GetPacks())
	}
}

// With either gate off nothing about coins reaches a reader: no coin field on
// the episode, and every coin RPC refused.
func TestDBCoinsStayHiddenWhileEitherGateIsOff(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name           string
		platformAllows bool
		tenantDisables bool
	}{
		{name: "platform forbids", platformAllows: false},
		{name: "tenant turned off", platformAllows: true, tenantDisables: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newCoinFixtureUnder(t, tc.platformAllows)
			f.grant(t, 100, 30*24*time.Hour)
			if tc.tenantDisables {
				if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_config SET enabled = false WHERE tenant_id = $1`, f.tenant.ID); err != nil {
					t.Fatalf("turn coins off: %v", err)
				}
			}

			episode := f.episodeDetail(t, "")
			if episode.GetCoinPrice() != 0 || episode.GetCoinRentalPrice() != 0 || episode.GetCoinName() != "" {
				t.Fatalf("episode = %+v, want no coin field", episode)
			}
			series, err := f.env.catalogClient().GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{Tenant: tenantContext(f.tenant), PublicId: f.series.PublicID})
			if err != nil {
				t.Fatalf("GetSeriesDetail: %v", err)
			}
			for _, listed := range series.GetEpisodes() {
				if listed.GetCoinPrice() != 0 || listed.GetCoinName() != "" {
					t.Fatalf("listed episode = %+v, want no coin field", listed)
				}
			}

			readerCtx := f.readerCtx(t)
			_, settingsErr := f.coins.GetCoinSettings(context.Background(), &publirav1.GetCoinSettingsRequest{Tenant: tenantContext(f.tenant)})
			_, balanceErr := f.coins.GetCoinBalance(readerCtx, &publirav1.GetCoinBalanceRequest{Tenant: tenantContext(f.tenant)})
			_, historyErr := f.coins.ListCoinTransactions(readerCtx, &publirav1.ListCoinTransactionsRequest{Tenant: tenantContext(f.tenant)})
			_, payErr := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "tap-1")
			for name, err := range map[string]error{
				"GetCoinSettings":      settingsErr,
				"GetCoinBalance":       balanceErr,
				"ListCoinTransactions": historyErr,
				"PayEpisodeWithCoins":  payErr,
			} {
				if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoOf(t, err).GetReason() != rpcerrors.ReasonCoinsUnavailable {
					t.Fatalf("%s: error = %v, want failed_precondition with %s", name, err, rpcerrors.ReasonCoinsUnavailable)
				}
			}
			if got := f.countRows(t, `SELECT remaining_coins FROM coin_grants WHERE tenant_id = $1`, f.tenant.ID); got != 100 {
				t.Fatalf("remaining coins = %d, want the balance kept", got)
			}
		})
	}
}

// A grant that expired with coins left counts for nothing at once, and the
// expiry job writes where the coins went into the history.
func TestDBExpiredCoinsLeaveTheBalanceAndShowInTheHistory(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	expired := f.grant(t, 40, -time.Hour)
	f.grant(t, 10, 30*24*time.Hour)

	if got := f.balance(t).GetCoins(); got != 10 {
		t.Fatalf("balance = %d, want the expired grant's 40 left out before the job runs", got)
	}
	if _, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "tap-1"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("paying with expired coins: code = %v, want failed_precondition", connect.CodeOf(err))
	}

	ticker := f.env.PG.OpenTickerDB(t)
	coinexpiry.New(dbmodels.New(ticker), nil).RunOnce(context.Background())
	coinexpiry.New(dbmodels.New(ticker), nil).RunOnce(context.Background())

	if got := f.countRows(t, `SELECT remaining_coins FROM coin_grants WHERE id = $1`, expired); got != 0 {
		t.Fatalf("expired grant keeps %d coins, want 0", got)
	}
	history, err := f.coins.ListCoinTransactions(f.readerCtx(t), &publirav1.ListCoinTransactionsRequest{Tenant: tenantContext(f.tenant), Locale: "en"})
	if err != nil {
		t.Fatalf("ListCoinTransactions: %v", err)
	}
	if history.GetCoinName() != "Points" {
		t.Fatalf("coin_name = %q, want Points", history.GetCoinName())
	}
	var expiries []*publirav1.CoinTransaction
	for _, entry := range history.GetTransactions() {
		if entry.GetKind() == publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_EXPIRY {
			expiries = append(expiries, entry)
		}
	}
	if len(expiries) != 1 || expiries[0].GetCoins() != 40 {
		t.Fatalf("expiries = %v, want one of 40 however often the job ran", expiries)
	}
	if got := f.balance(t).GetCoins(); got != 10 {
		t.Fatalf("balance after the job = %d, want 10: expired coins are never restored", got)
	}
}

func TestDBListCoinTransactionsNamesTheEpisodeASpendPaidFor(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 100, 30*24*time.Hour)
	if _, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, "tap-1"); err != nil {
		t.Fatalf("PayEpisodeWithCoins: %v", err)
	}

	first, err := f.coins.ListCoinTransactions(f.readerCtx(t), &publirav1.ListCoinTransactionsRequest{Tenant: tenantContext(f.tenant), Limit: 1})
	if err != nil {
		t.Fatalf("ListCoinTransactions: %v", err)
	}
	if len(first.GetTransactions()) != 1 || first.GetNextToken() == "" {
		t.Fatalf("first page = %v, next %q, want one entry and a next page", first.GetTransactions(), first.GetNextToken())
	}
	spend := first.GetTransactions()[0]
	if spend.GetKind() != publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_SPEND || spend.GetCoins() != 30 || spend.GetEpisode().GetId() != f.episode.ID.String() || spend.GetSeries().GetPublicId() != f.series.PublicID {
		t.Fatalf("newest entry = %+v, want the spend of 30 naming the episode", spend)
	}
	second, err := f.coins.ListCoinTransactions(f.readerCtx(t), &publirav1.ListCoinTransactionsRequest{Tenant: tenantContext(f.tenant), Limit: 1, Token: first.GetNextToken()})
	if err != nil {
		t.Fatalf("ListCoinTransactions next page: %v", err)
	}
	if len(second.GetTransactions()) != 1 || second.GetTransactions()[0].GetKind() != publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_GRANT || second.GetTransactions()[0].GetExpiresAt() == "" {
		t.Fatalf("second page = %v, want the grant with its expiry", second.GetTransactions())
	}
}

// A double tap sends the same payment at once, and two taps on two gates send
// two payments of the same episode at once. Either way the coins are spent
// once.
func TestDBPayEpisodeWithCoinsSpendsOnceUnderConcurrentRequests(t *testing.T) {
	t.Parallel()

	f := newCoinFixture(t)
	f.grant(t, 100, 30*24*time.Hour)

	const requests = 6
	errs := make(chan error, requests)
	ids := make(chan string, requests)
	for i := range requests {
		key := "same-key"
		if i%2 == 1 {
			key = "key-" + strconv.Itoa(i)
		}
		go func() {
			res, err := f.pay(t, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, 30, key)
			if err == nil {
				ids <- res.GetPurchase().GetId()
			}
			errs <- err
		}()
	}
	for range requests {
		if err := <-errs; err != nil && connect.CodeOf(err) != connect.CodeAlreadyExists {
			t.Fatalf("PayEpisodeWithCoins: %v, want success or already_exists", err)
		}
	}
	close(ids)
	purchases := map[string]bool{}
	for id := range ids {
		purchases[id] = true
	}
	if len(purchases) != 1 {
		t.Fatalf("payments answered %d purchases, want 1", len(purchases))
	}
	if got := f.balance(t).GetCoins(); got != 70 {
		t.Fatalf("balance = %d, want 70: spent once", got)
	}
}
