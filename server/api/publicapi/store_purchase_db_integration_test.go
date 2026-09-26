package publicapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	storeTestBundleIdentifier = "com.example.reader"
	storeTestPackageName      = "com.example.reader"
)

// fakeAppStore answers Get Transaction Info from the transactions a test put,
// signed by the chain the server under test trusts.
type fakeAppStore struct {
	t            *testing.T
	signer       *appstoretest.Signer
	transactions map[string]appstoretest.Transaction
	calls        int
}

func (f *fakeAppStore) GetTransactionInfo(_ context.Context, credentials appstore.Credentials, environment, transactionID string) (string, error) {
	f.calls++
	if credentials.BundleIdentifier != storeTestBundleIdentifier || credentials.PrivateKey == "" {
		f.t.Errorf("GetTransactionInfo called with credentials for %q", credentials.BundleIdentifier)
	}
	transaction, ok := f.transactions[transactionID]
	if !ok || transaction.Environment != environment {
		return "", appstore.ErrTransactionNotFound
	}
	return f.signer.Sign(f.t, transaction), nil
}

type storePurchaseEnv struct {
	pg       *testutil.PostgresEnv
	tenant   testutil.Tenant
	reader   testutil.TenantUser
	token    string
	episode  testutil.Episode
	signer   *appstoretest.Signer
	appStore *fakeAppStore
	play     *googleplaytest.Server
	client   publirav1connect.PurchaseServiceClient
	tenants  publirav1connect.TenantServiceClient
}

// newStorePurchaseEnv seeds a tenant whose app sells through both stores and
// one paid episode at 300 yen, and signs in a reader.
func newStorePurchaseEnv(t *testing.T) *storePurchaseEnv {
	t.Helper()
	return newStorePurchaseEnvWithGuards(t, openReaderGuards())
}

func newStorePurchaseEnvWithGuards(t *testing.T, guards readerGuards) *storePurchaseEnv {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "STORETNT0001", "store-tenant.example.com", "Store Tenant")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, ios_team_id, ios_bundle_identifier, android_application_id, android_sha256_cert_fingerprints)
		VALUES ($1, 'ABCDE12345', $2, $3, ARRAY[$4])
	`, tenant.ID, storeTestBundleIdentifier, storeTestPackageName, strings.Repeat("AB:", 31)+"AB"); err != nil {
		t.Fatalf("set app identities: %v", err)
	}
	if _, err := paymentsettings.NewAppStores(dbmodels.New(pg.DB), encryptor).Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteStore,
		AppStore: paymentsettings.AppStoreUpdate{
			Enabled:              true,
			IssuerID:             "57246542-96fe-1a63-e053-0824d011072a",
			KeyID:                "2X9R4HXF34",
			PrivateKey:           appstoretest.PrivateKeyPEM(t),
			PrivateKeyUpdateMode: secretupdate.Replace,
		},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     true,
			ServiceAccountKey:           testutil.ServiceAccountJSON(t, "reader-app", "publira@reader-app.iam.gserviceaccount.com"),
			ServiceAccountKeyUpdateMode: secretupdate.Replace,
		},
	}); err != nil {
		t.Fatalf("save store settings: %v", err)
	}

	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "STORESERIES1", Title: "Store Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "STOREEPISOD1",
		Title:    "Store Episode",
		Status:   testutil.EpisodeStatusPublished,
		Price:    300,
	})
	reader := pg.SeedEndUser(t, tenant.ID, "STOREREADER1", "reader@example.com", "Reader")

	signer := appstoretest.NewSigner(t)
	fake := &fakeAppStore{t: t, signer: signer, transactions: map[string]appstoretest.Transaction{}}
	play := googleplaytest.NewServer(t)

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), guards, openMailGuard())
	server.stores = storeClients{appStoreVerifier: signer.Verifier(), appStore: fake, googlePlay: play.Client()}
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	return &storePurchaseEnv{
		pg:       pg,
		tenant:   tenant,
		reader:   reader,
		token:    tokenFor(t, tenant, reader),
		episode:  episode,
		signer:   signer,
		appStore: fake,
		play:     play,
		client:   publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL),
		tenants:  publirav1connect.NewTenantServiceClient(ts.Client(), ts.URL),
	}
}

func (e *storePurchaseEnv) start(t *testing.T, token string) *publirav1.StartStorePurchaseResponse {
	t.Helper()
	res, err := e.client.StartStorePurchase(context.Background(), newBearerRequest(&publirav1.StartStorePurchaseRequest{
		Tenant:          tenantContext(e.tenant),
		EpisodePublicId: e.episode.PublicID,
		Store:           publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
	}, token))
	if err != nil {
		t.Fatalf("StartStorePurchase: %v", err)
	}
	return res.Msg
}

// appStoreTransaction is what the App Store holds for a purchase of the intent,
// and what the app sends is the same transaction signed the same way.
func (e *storePurchaseEnv) appStoreTransaction(id string, intent *publirav1.StartStorePurchaseResponse) appstoretest.Transaction {
	return appstoretest.Transaction{
		TransactionID:         id,
		OriginalTransactionID: id,
		BundleID:              storeTestBundleIdentifier,
		ProductID:             intent.ProductId,
		Type:                  appstore.TypeConsumable,
		AppAccountToken:       intent.IntentId,
		Environment:           appstore.EnvironmentProduction,
		PurchaseDate:          time.Now().UnixMilli(),
		SignedDate:            time.Now().UnixMilli(),
	}
}

func (e *storePurchaseEnv) confirmAppStore(t *testing.T, token string, transaction appstoretest.Transaction) (*publirav1.MyPurchase, error) {
	t.Helper()
	res, err := e.client.ConfirmStorePurchase(context.Background(), newBearerRequest(&publirav1.ConfirmStorePurchaseRequest{
		Tenant:      tenantContext(e.tenant),
		Store:       publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
		Transaction: e.signer.Sign(t, transaction),
	}, token))
	if err != nil {
		return nil, err
	}
	return res.Msg.Purchase, nil
}

func (e *storePurchaseEnv) confirmGooglePlay(t *testing.T, productID, purchaseToken string) (*publirav1.MyPurchase, error) {
	t.Helper()
	res, err := e.client.ConfirmStorePurchase(context.Background(), newBearerRequest(&publirav1.ConfirmStorePurchaseRequest{
		Tenant:      tenantContext(e.tenant),
		Store:       publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
		Transaction: purchaseToken,
		ProductId:   productID,
	}, e.token))
	if err != nil {
		return nil, err
	}
	return res.Msg.Purchase, nil
}

func (e *storePurchaseEnv) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var count int
	if err := e.pg.DB.QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return count
}

func (e *storePurchaseEnv) purchases(t *testing.T) int {
	return e.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1", e.tenant.ID)
}

func TestDBStartStorePurchaseAnswersTheTierProductAndReusesTheOpenIntent(t *testing.T) {
	env := newStorePurchaseEnv(t)

	first := env.start(t, env.token)
	if first.ProductId != "episode_300" {
		t.Fatalf("product_id = %q, want episode_300", first.ProductId)
	}
	if again := env.start(t, env.token); again.IntentId != first.IntentId {
		t.Fatalf("a second start opened intent %s, want the open one %s", again.IntentId, first.IntentId)
	}
	if got := env.count(t, "SELECT count(*) FROM store_purchase_intents WHERE tenant_id = $1", env.tenant.ID); got != 1 {
		t.Fatalf("store_purchase_intents rows = %d, want 1", got)
	}
}

func TestDBStartStorePurchaseRefusesATenantThatSellsThroughTheCheckout(t *testing.T) {
	env := newStorePurchaseEnv(t)
	if _, err := env.pg.DB.ExecContext(context.Background(),
		"UPDATE tenant_config SET app_purchase_route = 'external_checkout' WHERE tenant_id = $1", env.tenant.ID); err != nil {
		t.Fatalf("switch route: %v", err)
	}
	_, err := env.client.StartStorePurchase(context.Background(), newBearerRequest(&publirav1.StartStorePurchaseRequest{
		Tenant:          tenantContext(env.tenant),
		EpisodePublicId: env.episode.PublicID,
		Store:           publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
	}, env.token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartStorePurchase code = %v, want failed_precondition", connect.CodeOf(err))
	}
}

// The app offers a purchase only through a store StartStorePurchase would
// accept, so the tenant read answers each store on the same terms.
func TestDBGetTenantAnswersWhichStoreTheAppSellsThrough(t *testing.T) {
	env := newStorePurchaseEnv(t)
	storePayments := func() (bool, bool) {
		t.Helper()
		res, err := env.tenants.GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
			Tenant: tenantContext(env.tenant),
		}))
		if err != nil {
			t.Fatalf("GetTenant: %v", err)
		}
		return res.Msg.AcceptsAppStorePayments, res.Msg.AcceptsGooglePlayPayments
	}
	exec := func(query string) {
		t.Helper()
		if _, err := env.pg.DB.ExecContext(context.Background(), query, env.tenant.ID); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}

	if appStore, googlePlay := storePayments(); !appStore || !googlePlay {
		t.Fatalf("both stores ready: store payments = %v / %v, want true / true", appStore, googlePlay)
	}

	exec("UPDATE tenant_google_play_config SET enabled = false WHERE tenant_id = $1")
	if appStore, googlePlay := storePayments(); !appStore || googlePlay {
		t.Fatalf("App Store alone ready: store payments = %v / %v, want true / false", appStore, googlePlay)
	}

	// A key this server cannot decrypt could not verify the charge.
	exec("UPDATE tenant_app_store_config SET private_key_encrypted = 'enc:v1:not-a-key' WHERE tenant_id = $1")
	if appStore, googlePlay := storePayments(); appStore || googlePlay {
		t.Fatalf("App Store key that does not decrypt: store payments = %v / %v, want false / false", appStore, googlePlay)
	}

	exec("UPDATE tenant_config SET app_purchase_route = 'external_checkout' WHERE tenant_id = $1")
	if appStore, googlePlay := storePayments(); appStore || googlePlay {
		t.Fatalf("external checkout: store payments = %v / %v, want false / false", appStore, googlePlay)
	}
}

func TestDBConfirmStorePurchaseRecordsAnAppStoreTransactionOnce(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000001", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction

	first, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if first.Episode.GetPublicId() != env.episode.PublicID || first.PriceAtPurchase != 300 || !first.IsActive {
		t.Fatalf("purchase = %+v, want an active 300 yen purchase of %s", first, env.episode.PublicID)
	}
	second, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("second ConfirmStorePurchase: %v", err)
	}
	if second.Id != first.Id {
		t.Fatalf("second confirmation answered purchase %s, want %s", second.Id, first.Id)
	}
	if env.appStore.calls != 1 {
		t.Fatalf("the App Store was asked %d times, want once", env.appStore.calls)
	}

	var store, transactionID string
	var isTest bool
	if err := env.pg.DB.QueryRowContext(context.Background(),
		"SELECT store, store_transaction_id, is_test FROM purchases WHERE tenant_id = $1", env.tenant.ID,
	).Scan(&store, &transactionID, &isTest); err != nil {
		t.Fatalf("read purchase: %v", err)
	}
	if store != "app_store" || transactionID != transaction.TransactionID || isTest {
		t.Fatalf("purchase row = (%s, %s, test %v), want the production App Store transaction", store, transactionID, isTest)
	}
	if got := env.count(t, "SELECT count(*) FROM store_purchase_intents WHERE consumed_at IS NOT NULL"); got != 1 {
		t.Fatalf("consumed intents = %d, want 1", got)
	}
	if got := env.count(t, "SELECT count(*) FROM content_events WHERE event_type = 'purchase' AND tenant_id = $1", env.tenant.ID); got != 1 {
		t.Fatalf("purchase content events = %d, want 1", got)
	}
	// The App Store charges no follow-up of ours, so nothing is queued for it.
	if got := env.count(t, "SELECT count(*) FROM outbox_events WHERE event_type = $1", outbox.EventTypeGooglePlayPurchaseConsume); got != 0 {
		t.Fatalf("consume events = %d, want 0", got)
	}
}

func TestDBConfirmStorePurchaseRefusesAnAppStoreTransactionItCannotMatch(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)

	wrongProduct := env.appStoreTransaction("2000000000000002", intent)
	wrongProduct.ProductID = "episode_100"
	otherApp := env.appStoreTransaction("2000000000000003", intent)
	otherApp.BundleID = "com.example.another"
	unknownIntent := env.appStoreTransaction("2000000000000004", intent)
	unknownIntent.AppAccountToken = uuid.NewString()
	revoked := env.appStoreTransaction("2000000000000005", intent)
	revoked.RevocationDate = time.Now().UnixMilli()
	unknownToApple := env.appStoreTransaction("2000000000000006", intent)
	for _, transaction := range []appstoretest.Transaction{wrongProduct, otherApp, unknownIntent, revoked} {
		env.appStore.transactions[transaction.TransactionID] = transaction
	}

	for name, transaction := range map[string]appstoretest.Transaction{
		"the wrong product":     wrongProduct,
		"another tenant's app":  otherApp,
		"an unknown intent":     unknownIntent,
		"a revoked transaction": revoked,
		"a transaction unknown": unknownToApple,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := env.confirmAppStore(t, env.token, transaction); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ConfirmStorePurchase code = %v, want invalid_argument", connect.CodeOf(err))
			}
		})
	}

	t.Run("a chain Apple did not issue", func(t *testing.T) {
		transaction := env.appStoreTransaction("2000000000000007", intent)
		_, err := env.client.ConfirmStorePurchase(context.Background(), newBearerRequest(&publirav1.ConfirmStorePurchaseRequest{
			Tenant:      tenantContext(env.tenant),
			Store:       publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
			Transaction: appstoretest.NewUnmarkedSigner(t).Sign(t, transaction),
		}, env.token))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ConfirmStorePurchase code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	if got := env.purchases(t); got != 0 {
		t.Fatalf("purchases = %d, want 0", got)
	}
	if got := env.count(t, "SELECT count(*) FROM store_purchase_intents WHERE consumed_at IS NOT NULL"); got != 0 {
		t.Fatalf("consumed intents = %d, want 0", got)
	}
}

func TestDBConfirmStorePurchaseRefusesAConsumedIntent(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	first := env.appStoreTransaction("2000000000000010", intent)
	second := env.appStoreTransaction("2000000000000011", intent)
	env.appStore.transactions[first.TransactionID] = first
	env.appStore.transactions[second.TransactionID] = second

	if _, err := env.confirmAppStore(t, env.token, first); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if _, err := env.confirmAppStore(t, env.token, second); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a second transaction on the same intent: code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := env.purchases(t); got != 1 {
		t.Fatalf("purchases = %d, want 1", got)
	}
}

func TestDBConfirmStorePurchaseRefusesAnotherReadersIntent(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000020", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	other := env.pg.SeedEndUser(t, env.tenant.ID, "STOREREADER2", "other@example.com", "Other Reader")

	if _, err := env.confirmAppStore(t, tokenFor(t, env.tenant, other), transaction); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ConfirmStorePurchase code = %v, want permission_denied", connect.CodeOf(err))
	}
	if got := env.purchases(t); got != 0 {
		t.Fatalf("purchases = %d, want 0", got)
	}
}

func TestDBConfirmStorePurchaseKeepsASandboxPurchaseOffTheRoyaltyStatement(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000030", intent)
	transaction.Environment = appstore.EnvironmentSandbox
	env.appStore.transactions[transaction.TransactionID] = transaction

	purchase, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if !purchase.IsActive {
		t.Fatal("a sandbox purchase does not open the episode")
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE is_test"); got != 1 {
		t.Fatalf("test purchases = %d, want 1", got)
	}
	gross := func() int64 {
		t.Helper()
		totals, err := dbmodels.New(env.pg.DB).GetRoyaltySalesTotalsForPeriod(context.Background(), dbmodels.GetRoyaltySalesTotalsForPeriodParams{
			TenantID: env.tenant.ID,
			Period:   time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC),
			TimeZone: "UTC",
		})
		if err != nil {
			t.Fatalf("GetRoyaltySalesTotalsForPeriod: %v", err)
		}
		return totals.TotalGross
	}
	if got := gross(); got != 0 {
		t.Fatalf("royalty gross = %d, want 0 for a sandbox purchase", got)
	}
	// The same row paid for would be a sale, so the zero above is the flag's.
	if _, err := env.pg.DB.ExecContext(context.Background(), "UPDATE purchases SET is_test = false WHERE tenant_id = $1", env.tenant.ID); err != nil {
		t.Fatalf("clear is_test: %v", err)
	}
	if got := gross(); got != 300 {
		t.Fatalf("royalty gross = %d, want 300 once the purchase is paid for", got)
	}
}

func TestDBConfirmStorePurchaseRecordsAGooglePlayPurchaseAndQueuesItsConsumption(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	const purchaseToken = "play-token-0001.AO-J1Oy"
	env.play.Put(t, storeTestPackageName, intent.ProductId, purchaseToken, googleplaytest.Purchased, intent.IntentId)

	first, err := env.confirmGooglePlay(t, intent.ProductId, purchaseToken)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	second, err := env.confirmGooglePlay(t, intent.ProductId, purchaseToken)
	if err != nil {
		t.Fatalf("second ConfirmStorePurchase: %v", err)
	}
	if second.Id != first.Id {
		t.Fatalf("second confirmation answered purchase %s, want %s", second.Id, first.Id)
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE store = 'google_play' AND store_transaction_id = $1 AND NOT is_test", purchaseToken); got != 1 {
		t.Fatalf("google play purchases = %d, want 1", got)
	}

	var payload []byte
	if err := env.pg.DB.QueryRowContext(context.Background(),
		"SELECT payload FROM outbox_events WHERE event_type = $1", outbox.EventTypeGooglePlayPurchaseConsume,
	).Scan(&payload); err != nil {
		t.Fatalf("read consume event: %v", err)
	}
	var decoded outbox.GooglePlayPurchaseConsumePayload
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode consume event: %v", err)
	}
	if decoded.PurchaseID != first.Id || decoded.ProductID != intent.ProductId || decoded.PurchaseToken != purchaseToken {
		t.Fatalf("consume event = %+v, want the purchase %s", decoded, first.Id)
	}
}

func TestDBConfirmStorePurchaseMarksALicenseTestersPurchase(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	const purchaseToken = "play-token-0002.AO-J1Oy"
	env.play.Put(t, storeTestPackageName, intent.ProductId, purchaseToken, googleplaytest.TestPurchase, intent.IntentId)

	if _, err := env.confirmGooglePlay(t, intent.ProductId, purchaseToken); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE is_test"); got != 1 {
		t.Fatalf("test purchases = %d, want 1", got)
	}
}

func TestDBConfirmStorePurchaseRefusesAGooglePlayPurchaseItCannotRecord(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	env.play.Put(t, storeTestPackageName, intent.ProductId, "pending-token", googleplaytest.Pending, intent.IntentId)
	env.play.Put(t, storeTestPackageName, "episode_100", "cheaper-token", googleplaytest.Purchased, intent.IntentId)
	env.play.Put(t, "com.example.another", intent.ProductId, "other-app-token", googleplaytest.Purchased, intent.IntentId)

	for _, tc := range []struct {
		name      string
		productID string
		token     string
		want      connect.Code
	}{
		{name: "a pending purchase", productID: intent.ProductId, token: "pending-token", want: connect.CodeFailedPrecondition},
		{name: "the wrong product", productID: "episode_100", token: "cheaper-token", want: connect.CodeInvalidArgument},
		{name: "another tenant's app", productID: intent.ProductId, token: "other-app-token", want: connect.CodeInvalidArgument},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := env.confirmGooglePlay(t, tc.productID, tc.token); connect.CodeOf(err) != tc.want {
				t.Fatalf("ConfirmStorePurchase code = %v, want %v", connect.CodeOf(err), tc.want)
			}
		})
	}
	if got := env.purchases(t); got != 0 {
		t.Fatalf("purchases = %d, want 0", got)
	}
	if got := env.count(t, "SELECT count(*) FROM outbox_events WHERE event_type = $1", outbox.EventTypeGooglePlayPurchaseConsume); got != 0 {
		t.Fatalf("consume events = %d, want 0", got)
	}
}

func TestDBStartStorePurchaseRefusesAStoreThatIsNotReady(t *testing.T) {
	env := newStorePurchaseEnv(t)
	if _, err := env.pg.DB.ExecContext(context.Background(),
		"UPDATE tenant_google_play_config SET enabled = false WHERE tenant_id = $1", env.tenant.ID); err != nil {
		t.Fatalf("switch Google Play off: %v", err)
	}
	_, err := env.client.StartStorePurchase(context.Background(), newBearerRequest(&publirav1.StartStorePurchaseRequest{
		Tenant:          tenantContext(env.tenant),
		EpisodePublicId: env.episode.PublicID,
		Store:           publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
	}, env.token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartStorePurchase through a store that is off: code = %v, want failed_precondition", connect.CodeOf(err))
	}
	// The App Store is still ready, so the app on iOS keeps selling.
	env.start(t, env.token)
}

func TestDBStartStorePurchaseRefusesAStoreWhoseKeyDoesNotDecrypt(t *testing.T) {
	env := newStorePurchaseEnv(t)
	// A key this server cannot decrypt could not verify the charge.
	if _, err := env.pg.DB.ExecContext(context.Background(),
		"UPDATE tenant_app_store_config SET private_key_encrypted = 'enc:v1:not-a-key' WHERE tenant_id = $1", env.tenant.ID); err != nil {
		t.Fatalf("store a key that does not decrypt: %v", err)
	}
	_, err := env.client.StartStorePurchase(context.Background(), newBearerRequest(&publirav1.StartStorePurchaseRequest{
		Tenant:          tenantContext(env.tenant),
		EpisodePublicId: env.episode.PublicID,
		Store:           publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
	}, env.token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartStorePurchase through a store whose key does not decrypt: code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := env.count(t, "SELECT count(*) FROM store_purchase_intents WHERE tenant_id = $1", env.tenant.ID); got != 0 {
		t.Fatalf("store_purchase_intents rows = %d, want 0", got)
	}
}

func TestDBConfirmStorePurchaseKeepsTheReadingPeriodTheIntentWasOpenedOn(t *testing.T) {
	env := newStorePurchaseEnv(t)
	if _, err := env.pg.DB.ExecContext(context.Background(),
		"UPDATE episode_listings SET reading_period_hours = 48 WHERE episode_id = $1", env.episode.ID); err != nil {
		t.Fatalf("set reading period: %v", err)
	}
	intent := env.start(t, env.token)
	// Changed while the payment sheet was open.
	if _, err := env.pg.DB.ExecContext(context.Background(),
		"UPDATE episode_listings SET reading_period_hours = NULL WHERE episode_id = $1", env.episode.ID); err != nil {
		t.Fatalf("clear reading period: %v", err)
	}
	transaction := env.appStoreTransaction("2000000000000040", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction

	purchase, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	expiresAt, err := time.Parse(time.RFC3339, purchase.ExpiresAt)
	if err != nil {
		t.Fatalf("expires_at = %q, want the 48 hours the intent was opened on", purchase.ExpiresAt)
	}
	if remaining := time.Until(expiresAt); remaining < 47*time.Hour || remaining > 49*time.Hour {
		t.Fatalf("expires in %s, want about 48 hours", remaining)
	}
}

func TestDBConfirmStorePurchaseChargesTheReaderBeforeAskingTheStore(t *testing.T) {
	env := newStorePurchaseEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.StorePurchaseConfirmation = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	}))
	intent := env.start(t, env.token)
	unknown := env.appStoreTransaction("2000000000000050", intent)

	if _, err := env.confirmAppStore(t, env.token, unknown); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("first confirmation code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if _, err := env.confirmAppStore(t, env.token, unknown); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("confirmation past the allowance: code = %v, want resource_exhausted", connect.CodeOf(err))
	}
	if env.appStore.calls != 1 {
		t.Fatalf("the App Store was asked %d times, want only by the confirmation within the allowance", env.appStore.calls)
	}
}
