package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// takeTips turns the tenant's tips on in amounts, or off with none.
func takeTips(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, amounts ...int32) {
	t.Helper()
	if amounts == nil {
		amounts = []int32{}
	}
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_config (tenant_id, tips_enabled, tip_amounts)
		VALUES ($1, $2, $3::integer[])
		ON CONFLICT (tenant_id) DO UPDATE
		SET tips_enabled = EXCLUDED.tips_enabled,
			tip_amounts = EXCLUDED.tip_amounts
	`, tenantID, len(amounts) > 0, int32ArrayLiteral(amounts)); err != nil {
		t.Fatalf("set the tenant's tips to %v: %v", amounts, err)
	}
}

func int32ArrayLiteral(values []int32) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.FormatInt(int64(value), 10))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// tipEnv is a tenant that takes tips through Stripe, with a priced episode
// credited to one Author, and a reader to tip it.
type tipEnv struct {
	pg       *testutil.PostgresEnv
	tenant   testutil.Tenant
	series   testutil.Series
	episode  testutil.Episode
	reader   testutil.TenantUser
	token    string
	checkout *capturingCheckoutProvider
	catalog  publirav1connect.CatalogServiceClient
	client   publirav1connect.PurchaseServiceClient
}

func newTipEnv(t *testing.T, prefix string) *tipEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, prefix+"TENANT", prefix+".example.com", "Tip tenant")
	reader := pg.SeedEndUser(t, tenant.ID, prefix+"READER", "reader@"+prefix+".example.com", "Reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Title:       "Paid episode",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default()).Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}
	takeTips(t, pg, tenant.ID, 100, 300)

	db := pg.OpenPublicDB(t)
	checkout := newCapturingCheckoutProvider()
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = paymentprovider.NewRegistry(checkout)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	transport := connecthttp.NewTransport(ts.Client(), ts.URL)
	return &tipEnv{
		pg:       pg,
		tenant:   tenant,
		series:   series,
		episode:  episode,
		reader:   reader,
		token:    tokenFor(t, tenant, reader),
		checkout: checkout,
		catalog:  publirav1connect.NewCatalogServiceClient(connect.NewClient(transport)),
		client:   publirav1connect.NewPurchaseServiceClient(connect.NewClient(transport)),
	}
}

func (e *tipEnv) tip(ctx context.Context, episodeID uuid.UUID, amount int32) error {
	_, err := e.client.StartTipCheckout(ctx, &publirav1.StartTipCheckoutRequest{
		Tenant:    tenantContext(e.tenant),
		EpisodeId: episodeID.String(),
		Amount:    amount,
		Locale:    "en",
	})
	return err
}

// pay completes the checkout last started, as Stripe reports it.
func (e *tipEnv) pay(t *testing.T, checkoutID string) {
	t.Helper()
	purchase := e.checkout.input.Purchase
	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":             checkoutID,
		"object":         "checkout.session",
		"amount_total":   purchase.Price,
		"currency":       strings.ToLower(purchase.Currency),
		"payment_status": "paid",
		"livemode":       true,
		"payment_intent": "pi_" + checkoutID,
		"metadata":       stripetest.PurchaseMetadata(purchase),
	})
	if _, err := e.client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(e.tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("ProcessPaymentWebhook(%s): %v", checkoutID, err)
	}
}

// A tip paid through the provider is recorded as a tip, which the reader's
// purchases list as one and which opens nothing: the episode stays locked,
// its permanent copy stays on sale, and the reader may tip again.
func TestDBATipThroughTheProviderOpensNothing(t *testing.T) {
	t.Parallel()

	env := newTipEnv(t, "TIPWEB")
	ctx := testutil.WithBearer(context.Background(), env.token)

	detail, err := env.catalog.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if got := detail.TipAmounts; len(got) != 2 || got[0] != 100 || got[1] != 300 {
		t.Fatalf("tip amounts = %v, want [100 300]", got)
	}

	if err := env.tip(ctx, env.episode.ID, 300); err != nil {
		t.Fatalf("StartTipCheckout: %v", err)
	}
	started := env.checkout.input
	if started.Purchase.Kind != paymentprovider.KindTip || started.Purchase.Price != 300 || started.Purchase.EpisodeID != env.episode.ID || started.Purchase.ReadingPeriodHours != 0 {
		t.Fatalf("tip checkout = %+v, want a tip of 300 to the episode", started.Purchase)
	}
	if started.LineItemName != "Tip for the Authors of Paid episode" {
		t.Fatalf("line item = %q, want the tip named for the episode", started.LineItemName)
	}
	wantReturn := "/series/" + env.series.PublicID + "/episodes/" + env.episode.PublicID + "?tip=success"
	if !strings.HasSuffix(started.SuccessURL, wantReturn) {
		t.Fatalf("success URL = %q, want it to end in %q", started.SuccessURL, wantReturn)
	}
	env.pay(t, "cs_tip_first")

	var (
		kind      string
		expiresAt *time.Time
	)
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT kind, expires_at
		FROM purchases
		WHERE tenant_id = $1
			AND provider_checkout_id = 'cs_tip_first'
	`, env.tenant.ID).Scan(&kind, &expiresAt); err != nil {
		t.Fatalf("read the tip: %v", err)
	}
	if kind != "tip" || expiresAt != nil {
		t.Fatalf("tip recorded as kind %q expiring %v, want a tip with no expiry", kind, expiresAt)
	}
	receipts := 0
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = 'purchase_receipt'
	`, env.tenant.ID).Scan(&receipts); err != nil {
		t.Fatalf("count receipts: %v", err)
	}
	if receipts != 1 {
		t.Fatalf("receipts queued = %d, want one for the tip", receipts)
	}

	after, err := env.catalog.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail after the tip: %v", err)
	}
	if after.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access after a tip = %s, want the episode still locked", after.Access)
	}

	library, err := env.client.ListMyPurchases(ctx, &publirav1.ListMyPurchasesRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.Purchases) != 1 {
		t.Fatalf("library = %v, want the tip", library.Purchases)
	}
	if got := library.Purchases[0]; got.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_TIP || got.IsActive || got.PriceAtPurchase != 300 || got.Episode.GetPublicId() != env.episode.PublicID {
		t.Fatalf("listed tip = %+v, want an inactive tip of 300 naming the episode", got)
	}

	// The permanent copy is still on sale to a reader who tipped.
	if _, err := env.client.StartEpisodeCheckout(ctx, &publirav1.StartEpisodeCheckoutRequest{
		Tenant:    tenantContext(env.tenant),
		EpisodeId: env.episode.ID.String(),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout after a tip: %v", err)
	}

	// The same tip again is a checkout of its own, not the one just paid.
	if err := env.tip(ctx, env.episode.ID, 300); err != nil {
		t.Fatalf("StartTipCheckout again: %v", err)
	}
	if env.checkout.input.IdempotencyKey == started.IdempotencyKey {
		t.Fatalf("a second tip reuses the key %q of the paid one", started.IdempotencyKey)
	}
}

// A tip is refused to a guest, while the tenant takes no tips, in an amount
// the tenant does not offer, on an episode that is not published, and to a
// reader the episode credits; none of them reaches the provider.
func TestDBStartTipCheckoutRefusals(t *testing.T) {
	t.Parallel()

	env := newTipEnv(t, "TIPREF")
	ctx := testutil.WithBearer(context.Background(), env.token)
	draft := env.pg.SeedEpisode(t, env.tenant.ID, env.series.ID, testutil.EpisodeSeed{
		PublicID: "TIPREFDRAFT1",
		Title:    "Draft episode",
		Price:    500,
		Status:   testutil.EpisodeStatusDraft,
	})

	if err := env.tip(context.Background(), env.episode.ID, 300); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("a guest's tip = %v, want unauthenticated", err)
	}
	if err := env.tip(ctx, env.episode.ID, 200); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a tip of an amount not offered = %v, want failed_precondition", err)
	}
	if err := env.tip(ctx, draft.ID, 300); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a tip on a draft = %v, want failed_precondition", err)
	}

	creator := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{PublicID: "TIPREFCREATR", Name: "Author"})
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, creator.ID, "Artist")
	author := env.pg.SeedEndUser(t, env.tenant.ID, "TIPREFAUTHOR", "author@tipref.example.com", "Author")
	env.pg.SeedCreatorAccount(t, env.tenant.ID, creator.ID, author.ID)
	err := env.tip(testutil.WithBearer(context.Background(), tokenFor(t, env.tenant, author)), env.episode.ID, 300)
	assertPermissionDeniedReason(t, err, rpcerrors.ReasonReaderCreditedOnEpisode)

	takeTips(t, env.pg, env.tenant.ID)
	if err := env.tip(ctx, env.episode.ID, 300); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a tip while tips are off = %v, want failed_precondition", err)
	}
	detail, err := env.catalog.GetEpisodeDetail(ctx, &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(env.tenant),
		PublicId: env.episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if len(detail.TipAmounts) != 0 {
		t.Fatalf("tip amounts while tips are off = %v, want none", detail.TipAmounts)
	}
	if len(env.checkout.sent) != 0 {
		t.Fatalf("checkouts started = %d, want none", len(env.checkout.sent))
	}
}

// A tip in an app that sells through the stores is the product of its amount,
// confirmed as a purchase is, and recorded as a tip that opens nothing. One
// from the App Store sandbox is a test, and so no sale.
func TestDBStoreTipIsRecordedAsATip(t *testing.T) {
	t.Parallel()

	env := newStorePurchaseEnv(t)
	takeTips(t, env.pg, env.tenant.ID, 300)
	ctx := testutil.WithBearer(context.Background(), env.token)
	start := func(amount int32) (*publirav1.StartStoreTipResponse, error) {
		return env.client.StartStoreTip(ctx, &publirav1.StartStoreTipRequest{
			Tenant:    tenantContext(env.tenant),
			Store:     publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
			EpisodeId: env.episode.ID.String(),
			Amount:    amount,
		})
	}

	if _, err := start(500); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a store tip of an amount not offered = %v, want failed_precondition", err)
	}
	intent, err := start(300)
	if err != nil {
		t.Fatalf("StartStoreTip: %v", err)
	}
	if intent.ProductId != "tip_300" {
		t.Fatalf("product = %q, want tip_300", intent.ProductId)
	}
	again, err := start(300)
	if err != nil {
		t.Fatalf("StartStoreTip again: %v", err)
	}
	if again.IntentId != intent.IntentId {
		t.Fatalf("a second start opened intent %s beside %s", again.IntentId, intent.IntentId)
	}

	transaction := env.appStoreTransaction("2000000000000300", &publirav1.StartStorePurchaseResponse{IntentId: intent.IntentId, ProductId: intent.ProductId})
	transaction.Environment = appstore.EnvironmentSandbox
	env.appStore.transactions[transaction.TransactionID] = transaction
	purchase, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if purchase.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_TIP || purchase.IsActive || purchase.PriceAtPurchase != 300 || purchase.ExpiresAt != "" {
		t.Fatalf("confirmed tip = %+v, want an inactive tip of 300", purchase)
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1 AND kind = 'tip' AND is_test AND store = 'app_store'", env.tenant.ID); got != 1 {
		t.Fatalf("test tips from the App Store = %d, want 1", got)
	}
	if got := env.count(t, "SELECT count(*) FROM episode_grants WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", env.tenant.ID, env.reader.ID, env.episode.ID); got != 0 {
		t.Fatalf("grants after a tip = %d, want none", got)
	}
	month := time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	lines, err := dbmodels.New(env.pg.DB).ListRoyaltyLinesForPeriod(context.Background(), dbmodels.ListRoyaltyLinesForPeriodParams{
		TenantID: env.tenant.ID,
		Currency: storeTestCurrency(t, env.pg, env.tenant.ID),
		StartsAt: month,
		EndsAt:   month.AddDate(0, 1, 0),
	})
	if err != nil {
		t.Fatalf("ListRoyaltyLinesForPeriod: %v", err)
	}
	if len(lines) != 0 {
		t.Fatalf("royalty lines = %v, want none for a sandbox tip", lines)
	}
}
