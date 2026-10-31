package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	storeSubscriptionAppStoreProduct   = "com.example.reader.monthly"
	storeSubscriptionGooglePlayProduct = "plan_monthly"
)

// storeSubscriptionEnv is a store tenant with a published plan of its whole
// catalog, sold in both apps.
type storeSubscriptionEnv struct {
	*storePurchaseEnv
	plan testutil.SubscriptionPlan
}

func newStoreSubscriptionEnv(t *testing.T) *storeSubscriptionEnv {
	t.Helper()
	return newStoreSubscriptionEnvWithGuards(t, openReaderGuards())
}

func newStoreSubscriptionEnvWithGuards(t *testing.T, guards readerGuards) *storeSubscriptionEnv {
	t.Helper()
	env := newStorePurchaseEnvWithGuards(t, guards)
	plan := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{
		Published:           true,
		AppStoreProductID:   storeSubscriptionAppStoreProduct,
		GooglePlayProductID: storeSubscriptionGooglePlayProduct,
	})
	return &storeSubscriptionEnv{storePurchaseEnv: env, plan: plan}
}

func (e *storeSubscriptionEnv) startSubscription(t *testing.T, token string, store publirav1.InAppPurchaseStore) (*publirav1.StartStoreSubscriptionResponse, error) {
	t.Helper()
	return e.subscriptions.StartStoreSubscription(testutil.WithBearer(context.Background(), token), &publirav1.StartStoreSubscriptionRequest{
		Tenant: tenantContext(e.tenant),
		Store:  store,
		PlanId: e.plan.ID.String(),
	})
}

func (e *storeSubscriptionEnv) mustStartSubscription(t *testing.T, token string, store publirav1.InAppPurchaseStore) *publirav1.StartStoreSubscriptionResponse {
	t.Helper()
	res, err := e.startSubscription(t, token, store)
	if err != nil {
		t.Fatalf("StartStoreSubscription: %v", err)
	}
	return res
}

// putAppStoreSubscription has the App Store hold a subscription of the intent's
// product in the sandbox, renewing and paid until expires, and answers the
// transaction the app reports for it.
func (e *storeSubscriptionEnv) putAppStoreSubscription(originalID string, intent *publirav1.StartStoreSubscriptionResponse, status int, expires time.Time) appstoretest.Transaction {
	transaction := appstoretest.Transaction{
		TransactionID:         originalID,
		OriginalTransactionID: originalID,
		BundleID:              storeTestBundleIdentifier,
		ProductID:             intent.ProductId,
		Type:                  appstore.TypeAutoRenewableSubscription,
		AppAccountToken:       intent.IntentId,
		Environment:           appstore.EnvironmentSandbox,
		PurchaseDate:          time.Now().UnixMilli(),
		SignedDate:            time.Now().UnixMilli(),
		ExpiresDate:           expires.UnixMilli(),
	}
	e.appStore.subscriptions[originalID] = fakeAppStoreSubscription{
		status: status,
		latest: transaction,
		renewal: appstoretest.RenewalInfo{
			OriginalTransactionID: originalID,
			ProductID:             intent.ProductId,
			AutoRenewProductID:    intent.ProductId,
			AutoRenewStatus:       appstore.AutoRenewOn,
			Environment:           appstore.EnvironmentSandbox,
			SignedDate:            time.Now().UnixMilli(),
		},
	}
	return transaction
}

func (e *storeSubscriptionEnv) confirmAppStoreSubscription(t *testing.T, token string, transaction appstoretest.Transaction) (*publirav1.Subscription, error) {
	t.Helper()
	res, err := e.subscriptions.ConfirmStoreSubscription(testutil.WithBearer(context.Background(), token), &publirav1.ConfirmStoreSubscriptionRequest{
		Tenant:      tenantContext(e.tenant),
		Store:       publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
		Transaction: e.signer.Sign(t, transaction),
	})
	if err != nil {
		return nil, err
	}
	return res.Subscription, nil
}

func (e *storeSubscriptionEnv) confirmGooglePlaySubscription(t *testing.T, purchaseToken string) (*publirav1.Subscription, error) {
	t.Helper()
	res, err := e.subscriptions.ConfirmStoreSubscription(testutil.WithBearer(context.Background(), e.token), &publirav1.ConfirmStoreSubscriptionRequest{
		Tenant:      tenantContext(e.tenant),
		Store:       publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
		Transaction: purchaseToken,
		ProductId:   storeSubscriptionGooglePlayProduct,
	})
	if err != nil {
		return nil, err
	}
	return res.Subscription, nil
}

// entitlementSource answers what opens the tenant's episode to the reader on
// surface.
func (e *storeSubscriptionEnv) entitlementSource(t *testing.T, token string, surface publirattypesv1.ClientSurface) publirav1.EpisodeEntitlementSource {
	t.Helper()
	detail, err := e.catalog.GetEpisodeDetail(testutil.WithBearer(context.Background(), token), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(e.tenant),
		PublicId: e.episode.PublicID,
		Surface:  surface,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail on %v: %v", surface, err)
	}
	return detail.EntitlementSource
}

func (e *storeSubscriptionEnv) subscriptionRows(t *testing.T) int {
	return e.count(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1", e.tenant.ID)
}

// A sandbox subscription the app confirms is recorded as the reader's
// subscription to the plan of its product, a test one, paid until the
// transaction's expiry, and it opens the plan's episodes on the web and in the
// app alike. Confirming it again answers the same subscription, and another
// reader confirming it is refused.
func TestDBConfirmStoreSubscriptionRecordsASandboxAppStoreSubscription(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	if intent.ProductId != storeSubscriptionAppStoreProduct {
		t.Fatalf("product_id = %q, want the plan's App Store product", intent.ProductId)
	}
	if again := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE); again.IntentId != intent.IntentId {
		t.Fatalf("a second start opened intent %s, want the open one %s", again.IntentId, intent.IntentId)
	}
	for _, surface := range []publirattypesv1.ClientSurface{publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP} {
		if got := env.entitlementSource(t, env.token, surface); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
			t.Fatalf("before the subscription the episode on %v is opened by %v, want nothing", surface, got)
		}
	}

	expires := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	transaction := env.putAppStoreSubscription("2000000500000001", intent, appstore.SubscriptionStatusActive, expires)
	subscription, err := env.confirmAppStoreSubscription(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}
	if subscription.Store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE ||
		subscription.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE ||
		subscription.CurrentPeriodEnd != expires.Format(time.RFC3339) ||
		subscription.CancelAtPeriodEnd ||
		subscription.Plan.GetId() != env.plan.ID.String() {
		t.Fatalf("ConfirmStoreSubscription = %+v, want the plan active from the App Store until %s", subscription, expires)
	}

	var (
		provider, storeID, productID string
		isTest                       bool
		planID                       uuid.UUID
		periodEnd                    time.Time
		userID                       uuid.NullUUID
		stripeID                     sql.NullString
	)
	if err := env.pg.DB.QueryRowContext(context.Background(), `
		SELECT provider, store_subscription_id, store_product_id, is_test, plan_id, current_period_end, user_id, stripe_subscription_id
		FROM subscriptions WHERE tenant_id = $1
	`, env.tenant.ID).Scan(&provider, &storeID, &productID, &isTest, &planID, &periodEnd, &userID, &stripeID); err != nil {
		t.Fatalf("read the recorded subscription: %v", err)
	}
	if provider != "app_store" || storeID != "2000000500000001" || productID != storeSubscriptionAppStoreProduct || !isTest ||
		planID != env.plan.ID || !periodEnd.Equal(expires) || userID.UUID != env.reader.ID || stripeID.Valid {
		t.Fatalf("recorded %s %s %s test=%v plan=%s until %s for %v (stripe %v)", provider, storeID, productID, isTest, planID, periodEnd, userID, stripeID)
	}
	if got := env.count(t, "SELECT count(*) FROM store_subscription_intents WHERE tenant_id = $1 AND consumed_at IS NOT NULL", env.tenant.ID); got != 1 {
		t.Fatalf("consumed intents = %d, want 1", got)
	}
	for _, surface := range []publirattypesv1.ClientSurface{publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP} {
		if got := env.entitlementSource(t, env.token, surface); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION {
			t.Fatalf("the episode on %v is opened by %v, want the subscription", surface, got)
		}
	}
	mine, err := env.subscriptions.GetMySubscription(testutil.WithBearer(context.Background(), env.token), &publirav1.GetMySubscriptionRequest{Tenant: tenantContext(env.tenant)})
	if err != nil {
		t.Fatalf("GetMySubscription: %v", err)
	}
	if mine.Subscription.GetId() != subscription.Id || mine.Subscription.Store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE {
		t.Fatalf("GetMySubscription = %+v, want the store subscription", mine.Subscription)
	}

	again, err := env.confirmAppStoreSubscription(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription again: %v", err)
	}
	if again.Id != subscription.Id || env.subscriptionRows(t) != 1 {
		t.Fatalf("confirming again answered %s with %d rows, want %s alone", again.Id, env.subscriptionRows(t), subscription.Id)
	}

	other := env.pg.SeedEndUser(t, env.tenant.ID, "STOREREADER2", "other@example.com", "Other")
	calls := env.appStore.calls
	if _, err := env.confirmAppStoreSubscription(t, tokenFor(t, env.tenant, other), transaction); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("another reader confirming error = %v, want permission_denied", err)
	}
	if env.appStore.calls != calls {
		t.Fatal("another reader's confirmation asked the App Store")
	}
	if got := env.entitlementSource(t, tokenFor(t, env.tenant, other), publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("the episode is opened to the other reader by %v, want nothing", got)
	}
}

// A confirmation records what the App Store reports now: a renewal it is
// retrying in the grace period opens the plan until the grace period ends,
// and renewal turned off ends the subscription with its period.
func TestDBConfirmStoreSubscriptionRecordsTheAppStoresStateNow(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	expired := time.Now().Add(-time.Hour)
	grace := time.Now().Add(6 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	transaction := env.putAppStoreSubscription("2000000500000002", intent, appstore.SubscriptionStatusBillingGracePeriod, expired)
	held := env.appStore.subscriptions["2000000500000002"]
	held.renewal.GracePeriodExpiresDate = grace.UnixMilli()
	held.renewal.AutoRenewStatus = appstore.AutoRenewOff
	env.appStore.subscriptions["2000000500000002"] = held

	subscription, err := env.confirmAppStoreSubscription(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}
	if subscription.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE ||
		subscription.CurrentPeriodEnd != grace.Format(time.RFC3339) || !subscription.CancelAtPeriodEnd {
		t.Fatalf("ConfirmStoreSubscription = %+v, want past due until the grace period ends, renewal off", subscription)
	}
	if got := env.entitlementSource(t, env.token, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION {
		t.Fatalf("the episode in the grace period is opened by %v, want the subscription", got)
	}

	held.status = appstore.SubscriptionStatusExpired
	env.appStore.subscriptions["2000000500000002"] = held
	subscription, err = env.confirmAppStoreSubscription(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription after expiry: %v", err)
	}
	if subscription.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELED {
		t.Fatalf("ConfirmStoreSubscription after expiry = %v, want canceled", subscription.Status)
	}
	if got := env.entitlementSource(t, env.token, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("the episode after expiry is opened by %v, want nothing", got)
	}
}

// The store is asked about a subscription only under its lock, so of two
// confirmations that overlap, the one that writes last is the one that asked
// last: a confirmation held up inside the App Store's answer that it is active
// does not write that over the revocation a later one read and recorded.
func TestDBConfirmStoreSubscriptionNeverWritesAnOlderAnswerOverANewerOne(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	transaction := env.putAppStoreSubscription("2000000500000008", intent, appstore.SubscriptionStatusActive, time.Now().Add(30*24*time.Hour))

	answering := make(chan struct{})
	release := make(chan struct{})
	// Only the first answer is held; a sync.Once would hold every later one
	// until the first returned.
	var held atomic.Bool
	env.appStore.mu.Lock()
	env.appStore.answeringStatuses = func() {
		if held.CompareAndSwap(false, true) {
			close(answering)
			<-release
		}
	}
	env.appStore.mu.Unlock()

	// The first confirmation has read the subscription as active and is held
	// before the answer reaches it.
	first := make(chan error, 1)
	go func() {
		_, err := env.confirmAppStoreSubscription(t, env.token, transaction)
		first <- err
	}()
	<-answering

	// Apple revokes it, and a second confirmation asks after that.
	env.appStore.mu.Lock()
	revoked := env.appStore.subscriptions["2000000500000008"]
	revoked.status = appstore.SubscriptionStatusRevoked
	revoked.latest.RevocationDate = time.Now().Add(-time.Minute).UnixMilli()
	env.appStore.subscriptions["2000000500000008"] = revoked
	env.appStore.mu.Unlock()
	second := make(chan error, 1)
	go func() {
		_, err := env.confirmAppStoreSubscription(t, env.token, transaction)
		second <- err
	}()
	// Long enough for the second confirmation to have asked and recorded, had
	// it not waited for the first.
	time.Sleep(500 * time.Millisecond)
	close(release)

	for name, done := range map[string]chan error{"first": first, "second": second} {
		if err := <-done; err != nil {
			t.Fatalf("%s confirmation: %v", name, err)
		}
	}
	if got := env.count(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1 AND status = 'canceled'", env.tenant.ID); got != 1 || env.subscriptionRows(t) != 1 {
		t.Fatalf("canceled subscriptions = %d of %d, want the revocation recorded on the one row", got, env.subscriptionRows(t))
	}
}

// A transaction whose account token names another reader's intent is refused
// and records nothing, as is one for a product its intent was not opened for,
// one for a consumable, and one naming no intent.
func TestDBConfirmStoreSubscriptionRefusesATransactionThatIsNotTheCallers(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	other := env.pg.SeedEndUser(t, env.tenant.ID, "STOREREADER2", "other@example.com", "Other")
	otherToken := tokenFor(t, env.tenant, other)
	intent := env.mustStartSubscription(t, otherToken, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	expires := time.Now().Add(30 * 24 * time.Hour)

	stolen := env.putAppStoreSubscription("2000000500000003", intent, appstore.SubscriptionStatusActive, expires)
	if _, err := env.confirmAppStoreSubscription(t, env.token, stolen); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("confirming another reader's intent error = %v, want permission_denied", err)
	}

	mine := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	unsold := env.putAppStoreSubscription("2000000500000004", mine, appstore.SubscriptionStatusActive, expires)
	unsold.ProductID = "com.example.reader.yearly"
	held := env.appStore.subscriptions["2000000500000004"]
	held.latest.ProductID = unsold.ProductID
	env.appStore.subscriptions["2000000500000004"] = held
	if _, err := env.confirmAppStoreSubscription(t, env.token, unsold); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("confirming a product no plan is sold as error = %v, want invalid_argument", err)
	}

	consumable := env.putAppStoreSubscription("2000000500000005", mine, appstore.SubscriptionStatusActive, expires)
	consumable.Type = appstore.TypeConsumable
	if _, err := env.confirmAppStoreSubscription(t, env.token, consumable); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("confirming a consumable error = %v, want invalid_argument", err)
	}

	unnamed := env.putAppStoreSubscription("2000000500000006", &publirav1.StartStoreSubscriptionResponse{ProductId: mine.ProductId, IntentId: uuid.NewString()}, appstore.SubscriptionStatusActive, expires)
	if _, err := env.confirmAppStoreSubscription(t, env.token, unnamed); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("confirming a transaction naming no intent error = %v, want invalid_argument", err)
	}
	if got := env.subscriptionRows(t); got != 0 {
		t.Fatalf("subscriptions recorded = %d, want none", got)
	}
}

// A Google Play subscription is recorded on the plan of its product, and its
// acknowledgement is queued once it has been paid for: a pending purchase is
// incomplete, opens nothing, and is acknowledged when a later confirmation
// finds it paid.
func TestDBConfirmStoreSubscriptionRecordsAGooglePlaySubscriptionAndQueuesItsAcknowledgement(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY)
	if intent.ProductId != storeSubscriptionGooglePlayProduct {
		t.Fatalf("product_id = %q, want the plan's Google Play product", intent.ProductId)
	}
	const purchaseToken = "play-subscription-0001.AO-J1Oy"
	expiry := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	env.play.PutSubscription(t, storeTestPackageName, purchaseToken, googleplaytest.SubscriptionPending, storeSubscriptionGooglePlayProduct, intent.IntentId, expiry)

	pending, err := env.confirmGooglePlaySubscription(t, purchaseToken)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription of a pending purchase: %v", err)
	}
	if pending.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_INCOMPLETE || pending.Store != publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY {
		t.Fatalf("ConfirmStoreSubscription of a pending purchase = %+v, want incomplete from Google Play", pending)
	}
	acknowledgements := func() int {
		return env.count(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2", env.tenant.ID, outbox.EventTypeGooglePlaySubscriptionAcknowledge)
	}
	if got := acknowledgements(); got != 0 {
		t.Fatalf("acknowledgements queued for a pending purchase = %d, want 0", got)
	}
	if got := env.entitlementSource(t, env.token, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("a pending subscription opens the episode by %v, want nothing", got)
	}

	env.play.PutSubscription(t, storeTestPackageName, purchaseToken, googleplaytest.SubscriptionActive, storeSubscriptionGooglePlayProduct, intent.IntentId, expiry)
	paid, err := env.confirmGooglePlaySubscription(t, purchaseToken)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription once paid: %v", err)
	}
	if paid.Id != pending.Id || paid.Status != publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE || paid.CurrentPeriodEnd != expiry.Format(time.RFC3339) {
		t.Fatalf("ConfirmStoreSubscription once paid = %+v, want %s active until %s", paid, pending.Id, expiry)
	}
	if got := env.count(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1 AND provider = 'google_play' AND store_subscription_id = $2 AND store_product_id = $3 AND NOT is_test", env.tenant.ID, purchaseToken, storeSubscriptionGooglePlayProduct); got != 1 {
		t.Fatalf("Google Play subscriptions recorded = %d, want the paid one", got)
	}
	if got := acknowledgements(); got != 1 {
		t.Fatalf("acknowledgements queued once paid = %d, want 1", got)
	}
	if _, err := env.confirmGooglePlaySubscription(t, purchaseToken); err != nil {
		t.Fatalf("ConfirmStoreSubscription again: %v", err)
	}
	if got := acknowledgements(); got != 1 {
		t.Fatalf("acknowledgements queued after confirming again = %d, want still 1", got)
	}
	if got := env.entitlementSource(t, env.token, publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB); got != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION {
		t.Fatalf("the episode is opened by %v, want the subscription", got)
	}
}

// StartStoreSubscription sells only a published plan the store sells, and only
// to a reader who holds no subscription, whoever bills it.
func TestDBStartStoreSubscriptionRefusesWhatItCannotSell(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	appStore := publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE

	unsold := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_android_only"})
	if _, err := env.subscriptions.StartStoreSubscription(testutil.WithBearer(context.Background(), env.token), &publirav1.StartStoreSubscriptionRequest{
		Tenant: tenantContext(env.tenant), Store: appStore, PlanId: unsold.ID.String(),
	}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a plan the App Store does not sell error = %v, want failed_precondition", err)
	}
	unpublished := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{AppStoreProductID: "com.example.reader.hidden"})
	if _, err := env.subscriptions.StartStoreSubscription(testutil.WithBearer(context.Background(), env.token), &publirav1.StartStoreSubscriptionRequest{
		Tenant: tenantContext(env.tenant), Store: appStore, PlanId: unpublished.ID.String(),
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unpublished plan error = %v, want not_found", err)
	}

	stripeReader := env.pg.SeedEndUser(t, env.tenant.ID, "STOREREADER3", "stripe@example.com", "Stripe subscriber")
	env.pg.SeedSubscription(t, env.tenant.ID, stripeReader.ID, env.plan.ID, testutil.SubscriptionSeed{})
	if _, err := env.startSubscription(t, tokenFor(t, env.tenant, stripeReader), appStore); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a Stripe subscriber error = %v, want already_exists", err)
	}
	storeReader := env.pg.SeedEndUser(t, env.tenant.ID, "STOREREADER4", "store@example.com", "Store subscriber")
	env.pg.SeedSubscription(t, env.tenant.ID, storeReader.ID, env.plan.ID, testutil.SubscriptionSeed{Provider: "google_play", Status: "paused"})
	if _, err := env.startSubscription(t, tokenFor(t, env.tenant, storeReader), appStore); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a paused Google Play subscriber error = %v, want already_exists", err)
	}

	if _, err := env.pg.DB.ExecContext(context.Background(), "UPDATE tenant_config SET app_purchase_route = 'external_checkout' WHERE tenant_id = $1", env.tenant.ID); err != nil {
		t.Fatalf("switch the app to the external checkout: %v", err)
	}
	if _, err := env.startSubscription(t, env.token, appStore); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("an app that does not sell through the store error = %v, want failed_precondition", err)
	}
	if got := env.count(t, "SELECT count(*) FROM store_subscription_intents WHERE tenant_id = $1", env.tenant.ID); got != 0 {
		t.Fatalf("intents opened = %d, want none", got)
	}
}

// A store start spends the allowance a checkout on the site spends, so a
// reader past it is refused before any intent is written.
func TestDBStartStoreSubscriptionSpendsTheReadersAllowance(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.SubscriptionCheckout = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	}))
	env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	if _, err := env.startSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a second start over the limit = %v, want resource_exhausted", err)
	}
	if got := env.count(t, "SELECT count(*) FROM store_subscription_intents WHERE tenant_id = $1", env.tenant.ID); got != 1 {
		t.Fatalf("intents opened = %d, want the first start's alone", got)
	}
}

// A reader who started a checkout on the site and then subscribes in the app
// cannot go on to pay both: the store start expires the open checkout, and a
// checkout the reader has paid refuses the start until its subscription ends.
func TestDBStartStoreSubscriptionSettlesTheCheckoutOnTheSite(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	fixture := stripetest.NewFixture(t)
	credentials := fixture.Credentials()
	if _, err := paymentsettings.New(dbmodels.New(env.pg.DB), newPublicTestEncryptor(t), providers.Registry(), nil, slog.Default()).Upsert(context.Background(), env.tenant.ID,
		stripeSettings(credentials[stripe.FieldSecretKey], credentials[stripe.FieldWebhookSecret]), paymentsettings.AuditMeta{},
	); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}
	env.server.paymentProviders = paymentprovider.NewRegistry(fixture.Provider())
	checkout := func() string {
		t.Helper()
		res, err := env.subscriptions.StartSubscriptionCheckout(testutil.WithBearer(context.Background(), env.token), &publirav1.StartSubscriptionCheckoutRequest{
			Tenant: tenantContext(env.tenant),
			PlanId: env.plan.ID.String(),
		})
		if err != nil {
			t.Fatalf("StartSubscriptionCheckout: %v", err)
		}
		return checkoutIDOf(res.GetCheckoutUrl())
	}
	appStore := publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE

	open := checkout()
	env.mustStartSubscription(t, env.token, appStore)
	if got := fixture.API.CheckoutSessionStatus(open); got != "expired" {
		t.Fatalf("the checkout on the site is %s after the store start, want expired", got)
	}

	paid := checkout()
	fixture.API.CompleteCheckoutSession(paid, "sub_paid_on_the_site")
	if _, err := env.startSubscription(t, env.token, appStore); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("a store start after paying on the site = %v, want already_exists", err)
	}
	if got := env.count(t, "SELECT count(*) FROM store_subscription_intents WHERE tenant_id = $1", env.tenant.ID); got != 1 {
		t.Fatalf("intents opened = %d, want the first start's alone", got)
	}
}

// A store bills its own subscriptions and only the reader can cancel one
// there, so closing the account queues no cancellation for it and leaves it
// recorded for no one, in the state the store last reported.
func TestDBDeleteMeLeavesAStoreSubscriptionToItsStore(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	transaction := env.putAppStoreSubscription("2000000500000007", intent, appstore.SubscriptionStatusActive, time.Now().Add(30*24*time.Hour))
	if _, err := env.confirmAppStoreSubscription(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}

	if _, err := env.auth.DeleteMe(testutil.WithBearer(context.Background(), env.token), &publirav1.DeleteMeRequest{Tenant: tenantContext(env.tenant), Password: testutil.SeededPassword}); err != nil {
		t.Fatalf("DeleteMe: %v", err)
	}
	if got := env.count(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2", env.tenant.ID, outbox.EventTypeSubscriptionCancel); got != 0 {
		t.Fatalf("cancellations queued = %d, want none", got)
	}
	if got := env.count(t, "SELECT count(*) FROM subscriptions WHERE tenant_id = $1 AND provider = 'app_store' AND status = 'active' AND user_id IS NULL", env.tenant.ID); got != 1 {
		t.Fatalf("store subscriptions kept for no one = %d, want 1", got)
	}
}
