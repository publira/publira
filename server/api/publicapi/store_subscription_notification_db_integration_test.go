package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/outbox"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	// storeTestServiceAccount is the service account the store test tenant
	// saved under Google Play, which its pushes are authenticated as.
	storeTestServiceAccount = "publira@reader-app.iam.gserviceaccount.com"
)

// storeTestPushAudience is the URL the test tenant's push subscription pushes
// to, on the scheme the environment serves tenants on.
func storeTestPushAudience(t *testing.T) string {
	t.Helper()
	site, err := tenantorigin.Site(dbmodels.Tenant{Domain: "store-tenant.example.com"})
	if err != nil {
		t.Fatalf("build the tenant's site origin: %v", err)
	}
	return site.String() + "/api/v1/webhook/payment/google-play"
}

// Real-time developer notification types of a subscription.
const (
	playRecovered    = 1
	playRenewed      = 2
	playPurchased    = 4
	playOnHold       = 5
	playInGrace      = 6
	playExpired      = 13
	playNotification = "subscriptionNotification"
)

// recordedStoreSubscription is the row a store subscription is recorded as.
type recordedStoreSubscription struct {
	id        uuid.UUID
	storeID   string
	planID    uuid.UUID
	status    string
	periodEnd time.Time
	userID    uuid.NullUUID
}

func (e *storeSubscriptionEnv) recordedSubscription(t *testing.T) recordedStoreSubscription {
	t.Helper()
	var (
		row       recordedStoreSubscription
		periodEnd sql.NullTime
	)
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT id, store_subscription_id, plan_id, status, current_period_end, user_id
		FROM subscriptions WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&row.id, &row.storeID, &row.planID, &row.status, &periodEnd, &row.userID); err != nil {
		t.Fatalf("read the recorded subscription: %v", err)
	}
	row.periodEnd = periodEnd.Time
	return row
}

// notifyAppStoreSubscription posts an App Store notification of type and
// subtype about the transaction.
func (e *storeSubscriptionEnv) notifyAppStoreSubscription(t *testing.T, notificationType, subtype string, transaction appstoretest.Transaction) error {
	t.Helper()
	return e.notify(t, e.signer, appstoretest.Notification{
		NotificationType: notificationType,
		Subtype:          subtype,
		NotificationUUID: uuid.NewString(),
		Version:          "2.0",
		SignedDate:       time.Now().UnixMilli(),
		Data: appstoretest.NotificationData{
			BundleID:              transaction.BundleID,
			Environment:           transaction.Environment,
			SignedTransactionInfo: e.signer.Sign(t, transaction),
		},
	})
}

// renewAppStoreSubscription has the App Store renew the subscription until
// expires, and answers the renewal's transaction.
func (e *storeSubscriptionEnv) renewAppStoreSubscription(originalID, transactionID string, expires time.Time) appstoretest.Transaction {
	held := e.appStore.subscriptions[originalID]
	held.status = appstore.SubscriptionStatusActive
	held.latest.TransactionID = transactionID
	held.latest.PurchaseDate = time.Now().UnixMilli()
	held.latest.ExpiresDate = expires.UnixMilli()
	e.appStore.subscriptions[originalID] = held
	return held.latest
}

// notifyGooglePlay posts a real-time developer notification the way Cloud
// Pub/Sub pushes it and web-storefront forwards it.
func (e *storeSubscriptionEnv) notifyGooglePlay(t *testing.T, authorization string, notification map[string]any) error {
	t.Helper()
	_, err := e.client.ProcessGooglePlayNotification(context.Background(), &publirav1.ProcessGooglePlayNotificationRequest{
		Tenant:  tenantContext(e.tenant),
		Payload: googleplaytest.PushBody(t, notification),
		Headers: map[string]string{
			"authorization": authorization,
			"content-type":  "application/json",
		},
	})
	return err
}

func (e *storeSubscriptionEnv) pushAuthorization(t *testing.T) string {
	t.Helper()
	return e.playIssuer.Authorization(t, storeTestPushAudience(t), storeTestServiceAccount)
}

func playSubscriptionNotification(notificationType int, purchaseToken string) map[string]any {
	return map[string]any{
		"version":         "1.0",
		"packageName":     storeTestPackageName,
		"eventTimeMillis": "1761292800000",
		playNotification: map[string]any{
			"version":          "1.0",
			"notificationType": notificationType,
			"purchaseToken":    purchaseToken,
		},
	}
}

func (e *storeSubscriptionEnv) mustConfirmGooglePlaySubscription(t *testing.T, purchaseToken string, expiry time.Time) {
	t.Helper()
	intent := e.mustStartSubscription(t, e.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_GOOGLE_PLAY)
	e.play.PutSubscription(t, storeTestPackageName, purchaseToken, googleplaytest.SubscriptionActive, storeSubscriptionGooglePlayProduct, intent.IntentId, expiry)
	if _, err := e.confirmGooglePlaySubscription(t, purchaseToken); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}
}

func (e *storeSubscriptionEnv) requireEntitlement(t *testing.T, want publirav1.EpisodeEntitlementSource, when string) {
	t.Helper()
	if got := e.entitlementSource(t, e.token, publirattypesv1.ClientSurface_CLIENT_SURFACE_APP); got != want {
		t.Fatalf("%s the episode is opened by %v, want %v", when, got, want)
	}
}

// A renewal the App Store reports moves the period forward, a renewal it is
// retrying in the billing grace period keeps the plan open until the grace
// period ends, and an expiry closes it, each read from the App Store rather
// than from the notification.
func TestDBAppStoreNotificationsKeepASubscriptionInStep(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	const originalID = "2000000600000001"
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	transaction := env.putAppStoreSubscription(originalID, intent, appstore.SubscriptionStatusActive, time.Now().Add(time.Hour))
	if _, err := env.confirmAppStoreSubscription(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}

	renewed := time.Now().Add(31 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	renewal := env.renewAppStoreSubscription(originalID, "2000000600000002", renewed)
	if err := env.notifyAppStoreSubscription(t, "DID_RENEW", "", renewal); err != nil {
		t.Fatalf("ProcessAppStoreNotification of DID_RENEW: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "active" || !got.periodEnd.Equal(renewed) {
		t.Fatalf("after DID_RENEW the subscription is %s until %s, want active until %s", got.status, got.periodEnd, renewed)
	}

	grace := time.Now().Add(6 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	held := env.appStore.subscriptions[originalID]
	held.status = appstore.SubscriptionStatusBillingGracePeriod
	held.latest.ExpiresDate = time.Now().Add(-time.Minute).UnixMilli()
	held.renewal.GracePeriodExpiresDate = grace.UnixMilli()
	env.appStore.subscriptions[originalID] = held
	if err := env.notifyAppStoreSubscription(t, "DID_FAIL_TO_RENEW", "GRACE_PERIOD", held.latest); err != nil {
		t.Fatalf("ProcessAppStoreNotification of DID_FAIL_TO_RENEW: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "past_due" || !got.periodEnd.Equal(grace) {
		t.Fatalf("in the grace period the subscription is %s until %s, want past_due until %s", got.status, got.periodEnd, grace)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION, "in the grace period")

	held.status = appstore.SubscriptionStatusExpired
	held.renewal.GracePeriodExpiresDate = 0
	env.appStore.subscriptions[originalID] = held
	if err := env.notifyAppStoreSubscription(t, "EXPIRED", "BILLING_RETRY", held.latest); err != nil {
		t.Fatalf("ProcessAppStoreNotification of EXPIRED: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "canceled" {
		t.Fatalf("after EXPIRED the subscription is %s, want canceled", got.status)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED, "after EXPIRED")
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// A refund of a subscription closes it at once: canceled, its period ending
// when Apple revoked it.
func TestDBAppStoreRefundOfASubscriptionClosesItAtOnce(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	const originalID = "2000000600000011"
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	transaction := env.putAppStoreSubscription(originalID, intent, appstore.SubscriptionStatusActive, time.Now().Add(30*24*time.Hour))
	if _, err := env.confirmAppStoreSubscription(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION, "before the refund")

	revokedAt := time.Now().Add(-time.Minute).Truncate(time.Millisecond).UTC()
	held := env.appStore.subscriptions[originalID]
	held.status = appstore.SubscriptionStatusRevoked
	held.latest.RevocationDate = revokedAt.UnixMilli()
	env.appStore.subscriptions[originalID] = held
	if err := env.notifyAppStoreSubscription(t, appstore.NotificationTypeRefund, "", held.latest); err != nil {
		t.Fatalf("ProcessAppStoreNotification of REFUND: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "canceled" || !got.periodEnd.Equal(revokedAt) {
		t.Fatalf("after the refund the subscription is %s until %s, want canceled at %s", got.status, got.periodEnd, revokedAt)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED, "after the refund")
	if got := env.count(t, "SELECT count(*) FROM unapplied_store_refunds"); got != 0 {
		t.Fatalf("held refunds = %d, want none for a subscription", got)
	}
}

// A subscription the app has not confirmed yet is recorded from the intent its
// purchase carries, for the reader who opened it; one that carries no intent
// is acknowledged and left unrecorded.
func TestDBAppStoreNotificationRecordsASubscriptionTheAppHasNotConfirmed(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	unclaimed := env.putAppStoreSubscription("2000000600000021", &publirav1.StartStoreSubscriptionResponse{ProductId: intent.ProductId}, appstore.SubscriptionStatusActive, time.Now().Add(30*24*time.Hour))
	if err := env.notifyAppStoreSubscription(t, "SUBSCRIBED", "INITIAL_BUY", unclaimed); err != nil {
		t.Fatalf("ProcessAppStoreNotification of a subscription with no intent: %v", err)
	}
	if got := env.subscriptionRows(t); got != 0 {
		t.Fatalf("subscriptions recorded for no intent = %d, want none", got)
	}

	expires := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	transaction := env.putAppStoreSubscription("2000000600000022", intent, appstore.SubscriptionStatusActive, expires)
	if err := env.notifyAppStoreSubscription(t, "SUBSCRIBED", "INITIAL_BUY", transaction); err != nil {
		t.Fatalf("ProcessAppStoreNotification of SUBSCRIBED: %v", err)
	}
	got := env.recordedSubscription(t)
	if got.storeID != "2000000600000022" || got.userID.UUID != env.reader.ID || got.planID != env.plan.ID || got.status != "active" || !got.periodEnd.Equal(expires) {
		t.Fatalf("recorded %+v, want the reader's subscription to the plan until %s", got, expires)
	}
	if consumed := env.count(t, "SELECT count(*) FROM store_subscription_intents WHERE tenant_id = $1 AND consumed_at IS NOT NULL", env.tenant.ID); consumed != 1 {
		t.Fatalf("consumed intents = %d, want 1", consumed)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION, "before the app confirms")

	// The app's confirmation that follows answers the same subscription.
	confirmed, err := env.confirmAppStoreSubscription(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStoreSubscription after the notification: %v", err)
	}
	if confirmed.Id != got.id.String() || env.subscriptionRows(t) != 1 {
		t.Fatalf("the confirmation answered %s with %d rows, want %s alone", confirmed.Id, env.subscriptionRows(t), got.id)
	}
}

// A delivery repeated, or one that arrives after a newer one, writes what the
// App Store reports now, never what the notification was about.
func TestDBAppStoreNotificationsRepeatedOrReorderedWriteNothingOlder(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	const originalID = "2000000600000031"
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	first := env.putAppStoreSubscription(originalID, intent, appstore.SubscriptionStatusActive, time.Now().Add(time.Hour))
	if _, err := env.confirmAppStoreSubscription(t, env.token, first); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}
	renewed := time.Now().Add(31 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	renewal := env.renewAppStoreSubscription(originalID, "2000000600000032", renewed)

	for _, delivery := range []struct {
		notificationType string
		transaction      appstoretest.Transaction
	}{
		{"DID_RENEW", renewal},
		{"DID_RENEW", renewal},
		{"SUBSCRIBED", first},
	} {
		if err := env.notifyAppStoreSubscription(t, delivery.notificationType, "", delivery.transaction); err != nil {
			t.Fatalf("ProcessAppStoreNotification of %s: %v", delivery.notificationType, err)
		}
		if got := env.recordedSubscription(t); got.status != "active" || !got.periodEnd.Equal(renewed) {
			t.Fatalf("after %s about %s the subscription is %s until %s, want active until %s",
				delivery.notificationType, delivery.transaction.TransactionID, got.status, got.periodEnd, renewed)
		}
	}
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// An upgrade the App Store reports moves the subscription to the plan of its
// new product; a product no plan names leaves it on its plan.
func TestDBAppStorePlanChangeMovesTheSubscriptionToThePlanOfItsProduct(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	yearly := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, AppStoreProductID: "com.example.reader.yearly"})
	const originalID = "2000000600000041"
	intent := env.mustStartSubscription(t, env.token, publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE)
	transaction := env.putAppStoreSubscription(originalID, intent, appstore.SubscriptionStatusActive, time.Now().Add(30*24*time.Hour))
	if _, err := env.confirmAppStoreSubscription(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStoreSubscription: %v", err)
	}

	for _, change := range []struct {
		transactionID, product string
		want                   uuid.UUID
	}{
		{"2000000600000042", "com.example.reader.yearly", yearly.ID},
		{"2000000600000043", "com.example.reader.unlisted", yearly.ID},
	} {
		held := env.appStore.subscriptions[originalID]
		held.latest.TransactionID = change.transactionID
		held.latest.ProductID = change.product
		held.renewal.ProductID = change.product
		held.renewal.AutoRenewProductID = change.product
		env.appStore.subscriptions[originalID] = held
		if err := env.notifyAppStoreSubscription(t, "DID_CHANGE_RENEWAL_PREF", "UPGRADE", held.latest); err != nil {
			t.Fatalf("ProcessAppStoreNotification of an upgrade to %s: %v", change.product, err)
		}
		if got := env.recordedSubscription(t); got.planID != change.want {
			t.Fatalf("after an upgrade to %s the subscription is on plan %s, want %s", change.product, got.planID, change.want)
		}
	}
}

// A renewal Google Play reports moves the period forward, its grace period
// keeps the plan open, a hold closes it until a recovery, and an expiry closes
// it.
func TestDBGooglePlayNotificationsKeepASubscriptionInStep(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	const purchaseToken = "play-subscription-rtdn-0001.AO-J1Oy"
	env.mustConfirmGooglePlaySubscription(t, purchaseToken, time.Now().Add(time.Hour))
	authorization := env.pushAuthorization(t)

	for _, step := range []struct {
		name        string
		fixture     string
		kind        int
		expiry      time.Time
		status      string
		entitlement publirav1.EpisodeEntitlementSource
	}{
		{"RENEWED", googleplaytest.SubscriptionActive, playRenewed, time.Now().Add(31 * 24 * time.Hour), "active", publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION},
		{"IN_GRACE_PERIOD", googleplaytest.SubscriptionGracePeriod, playInGrace, time.Now().Add(3 * 24 * time.Hour), "past_due", publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION},
		{"ON_HOLD", googleplaytest.SubscriptionOnHold, playOnHold, time.Now().Add(-time.Minute), "unpaid", publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED},
		{"RECOVERED", googleplaytest.SubscriptionActive, playRecovered, time.Now().Add(30 * 24 * time.Hour), "active", publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION},
		{"EXPIRED", googleplaytest.SubscriptionExpired, playExpired, time.Now().Add(-time.Minute), "canceled", publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED},
	} {
		expiry := step.expiry.Truncate(time.Millisecond).UTC()
		intent := env.recordedIntent(t)
		env.play.PutSubscription(t, storeTestPackageName, purchaseToken, step.fixture, storeSubscriptionGooglePlayProduct, intent, expiry)
		if err := env.notifyGooglePlay(t, authorization, playSubscriptionNotification(step.kind, purchaseToken)); err != nil {
			t.Fatalf("ProcessGooglePlayNotification of %s: %v", step.name, err)
		}
		if got := env.recordedSubscription(t); got.status != step.status || !got.periodEnd.Equal(expiry) {
			t.Fatalf("after %s the subscription is %s until %s, want %s until %s", step.name, got.status, got.periodEnd, step.status, expiry)
		}
		env.requireEntitlement(t, step.entitlement, "after "+step.name)
	}
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// recordedIntent answers the intent the reader's one store subscription was
// opened with.
func (e *storeSubscriptionEnv) recordedIntent(t *testing.T) string {
	t.Helper()
	var id uuid.UUID
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT id FROM store_subscription_intents WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1
	`, e.tenant.ID).Scan(&id); err != nil {
		t.Fatalf("read the intent: %v", err)
	}
	return id.String()
}

// A push is taken only with a token Google signed for the URL it was pushed
// to and the service account the tenant saved, about the tenant's own app.
func TestDBGooglePlayNotificationRefusesAPushNotMeantForTheTenant(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	const purchaseToken = "play-subscription-rtdn-0002.AO-J1Oy"
	expiry := time.Now().Add(time.Hour).Truncate(time.Millisecond).UTC()
	env.mustConfirmGooglePlaySubscription(t, purchaseToken, expiry)
	env.play.PutSubscription(t, storeTestPackageName, purchaseToken, googleplaytest.SubscriptionExpired, storeSubscriptionGooglePlayProduct, env.recordedIntent(t), expiry)

	otherApp := playSubscriptionNotification(playExpired, purchaseToken)
	otherApp["packageName"] = "com.example.another"
	for name, push := range map[string]struct {
		authorization string
		notification  map[string]any
	}{
		"no token":                   {"", playSubscriptionNotification(playExpired, purchaseToken)},
		"another audience":           {env.playIssuer.Authorization(t, "https://other.example.com/api/v1/webhook/payment/google-play", storeTestServiceAccount), playSubscriptionNotification(playExpired, purchaseToken)},
		"another service account":    {env.playIssuer.Authorization(t, storeTestPushAudience(t), "attacker@other-project.iam.gserviceaccount.com"), playSubscriptionNotification(playExpired, purchaseToken)},
		"a key Google does not hold": {googleplaytest.NewIssuer(t).Authorization(t, storeTestPushAudience(t), storeTestServiceAccount), playSubscriptionNotification(playExpired, purchaseToken)},
		"another app":                {env.pushAuthorization(t), otherApp},
	} {
		t.Run(name, func(t *testing.T) {
			if err := env.notifyGooglePlay(t, push.authorization, push.notification); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ProcessGooglePlayNotification code = %v, want invalid_argument", connect.CodeOf(err))
			}
		})
	}
	if got := env.recordedSubscription(t); got.status != "active" {
		t.Fatalf("after the refused pushes the subscription is %s, want still active", got.status)
	}

	// A test notification from Play Console is acknowledged.
	if err := env.notifyGooglePlay(t, env.pushAuthorization(t), map[string]any{
		"version":          "1.0",
		"packageName":      storeTestPackageName,
		"eventTimeMillis":  "1761292800000",
		"testNotification": map[string]any{"version": "1.0"},
	}); err != nil {
		t.Fatalf("ProcessGooglePlayNotification of a test notification: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "active" {
		t.Fatalf("after the test notification the subscription is %s, want still active", got.status)
	}
}

// A change of plan gives the subscription a purchase token of its own, which
// replaces the one recorded: the reader keeps one subscription, now to the plan
// of the new product, and the expiry of the token it replaced changes nothing.
func TestDBGooglePlayPlanChangeMovesTheSubscriptionToTheNewToken(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	yearly := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_yearly"})
	const oldToken, newToken = "play-subscription-monthly.AO-J1Oy", "play-subscription-yearly.AO-J1Oy"
	env.mustConfirmGooglePlaySubscription(t, oldToken, time.Now().Add(time.Hour))
	before := env.recordedSubscription(t)
	intent := env.recordedIntent(t)

	expiry := time.Now().Add(365 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	env.play.PutSubscription(t, storeTestPackageName, newToken, googleplaytest.SubscriptionActive, "plan_yearly", intent, expiry)
	env.play.LinkSubscription(storeTestPackageName, newToken, oldToken)
	if err := env.notifyGooglePlay(t, env.pushAuthorization(t), playSubscriptionNotification(playPurchased, newToken)); err != nil {
		t.Fatalf("ProcessGooglePlayNotification of the new plan: %v", err)
	}
	after := env.recordedSubscription(t)
	if after.id != before.id || after.storeID != newToken || after.planID != yearly.ID || after.status != "active" || !after.periodEnd.Equal(expiry) {
		t.Fatalf("after the change of plan recorded %+v, want %s on %s, the yearly plan until %s", after, before.id, newToken, expiry)
	}
	for _, token := range []string{oldToken, newToken} {
		if got := env.count(t, "SELECT count(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 AND payload->>'purchase_token' = $3",
			env.tenant.ID, outbox.EventTypeGooglePlaySubscriptionAcknowledge, token); got != 1 {
			t.Fatalf("acknowledgements queued for %s = %d, want 1", token, got)
		}
	}

	env.play.PutSubscription(t, storeTestPackageName, oldToken, googleplaytest.SubscriptionExpired, storeSubscriptionGooglePlayProduct, intent, time.Now())
	if err := env.notifyGooglePlay(t, env.pushAuthorization(t), playSubscriptionNotification(playExpired, oldToken)); err != nil {
		t.Fatalf("ProcessGooglePlayNotification of the replaced token: %v", err)
	}
	if got := env.recordedSubscription(t); got.storeID != newToken || got.status != "active" {
		t.Fatalf("after the replaced token expired the subscription is %s on %s, want still active on %s", got.status, got.storeID, newToken)
	}
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// A replacement that was never paid for replaces nothing: the subscription it
// would have replaced is read and kept as Google Play reports it.
func TestDBGooglePlayPendingReplacementLeavesTheSubscriptionItWouldReplace(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_yearly"})
	const oldToken, newToken = "play-subscription-kept.AO-J1Oy", "play-subscription-never-paid.AO-J1Oy"
	expiry := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	env.mustConfirmGooglePlaySubscription(t, oldToken, expiry)
	before := env.recordedSubscription(t)
	intent := env.recordedIntent(t)

	for _, fixture := range []string{googleplaytest.SubscriptionPending, googleplaytest.SubscriptionPendingCanceled} {
		env.play.PutSubscription(t, storeTestPackageName, newToken, fixture, "plan_yearly", intent, time.Now().Add(365*24*time.Hour))
		env.play.LinkSubscription(storeTestPackageName, newToken, oldToken)
		if err := env.notifyGooglePlay(t, env.pushAuthorization(t), playSubscriptionNotification(playPurchased, newToken)); err != nil {
			t.Fatalf("ProcessGooglePlayNotification of a %s replacement: %v", fixture, err)
		}
		if got := env.recordedSubscription(t); got.id != before.id || got.storeID != oldToken || got.planID != env.plan.ID || got.status != "active" || !got.periodEnd.Equal(expiry) {
			t.Fatalf("after a %s replacement recorded %+v, want %s still active on %s until %s", fixture, got, before.id, oldToken, expiry)
		}
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION, "after a replacement that was never paid for")
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// A replacement that was never paid for, of a paid replacement not recorded
// yet, leaves the reader on the paid one: the recorded row moves to it rather
// than being read again as the subscription it replaced, which has expired.
func TestDBGooglePlayPendingReplacementOfAnUnrecordedPaidOneMovesToThePaidOne(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	yearly := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_yearly"})
	env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_weekly"})
	const first, paid, pending = "play-subscription-replaced.AO-J1Oy", "play-subscription-paid.AO-J1Oy", "play-subscription-unpaid.AO-J1Oy"
	env.mustConfirmGooglePlaySubscription(t, first, time.Now().Add(time.Hour))
	before := env.recordedSubscription(t)
	intent := env.recordedIntent(t)

	env.play.PutSubscription(t, storeTestPackageName, first, googleplaytest.SubscriptionExpired, storeSubscriptionGooglePlayProduct, intent, time.Now())
	expiry := time.Now().Add(365 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	env.play.PutSubscription(t, storeTestPackageName, paid, googleplaytest.SubscriptionActive, "plan_yearly", intent, expiry)
	env.play.LinkSubscription(storeTestPackageName, paid, first)
	env.play.PutSubscription(t, storeTestPackageName, pending, googleplaytest.SubscriptionPendingCanceled, "plan_weekly", intent, time.Now().Add(7*24*time.Hour))
	env.play.LinkSubscription(storeTestPackageName, pending, paid)

	if err := env.notifyGooglePlay(t, env.pushAuthorization(t), playSubscriptionNotification(playPurchased, pending)); err != nil {
		t.Fatalf("ProcessGooglePlayNotification of the unpaid replacement: %v", err)
	}
	if got := env.recordedSubscription(t); got.id != before.id || got.storeID != paid || got.planID != yearly.ID || got.status != "active" || !got.periodEnd.Equal(expiry) {
		t.Fatalf("after the unpaid replacement recorded %+v, want %s on %s, the yearly plan until %s", got, before.id, paid, expiry)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION, "after the unpaid replacement")
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// Two changes of plan whose notifications arrive newest first still reach the
// subscription they continue: the newest takes the recorded row over through
// the replacement between them, and the older one, arriving last, changes
// nothing.
func TestDBGooglePlayReplacementsArrivingOutOfOrderFindTheRecordedSubscription(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	yearly := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Published: true, GooglePlayProductID: "plan_yearly"})
	const first, second, third = "play-subscription-first.AO-J1Oy", "play-subscription-second.AO-J1Oy", "play-subscription-third.AO-J1Oy"
	env.mustConfirmGooglePlaySubscription(t, first, time.Now().Add(time.Hour))
	before := env.recordedSubscription(t)
	intent := env.recordedIntent(t)

	env.play.PutSubscription(t, storeTestPackageName, second, googleplaytest.SubscriptionExpired, storeSubscriptionGooglePlayProduct, intent, time.Now())
	env.play.LinkSubscription(storeTestPackageName, second, first)
	expiry := time.Now().Add(365 * 24 * time.Hour).Truncate(time.Millisecond).UTC()
	env.play.PutSubscription(t, storeTestPackageName, third, googleplaytest.SubscriptionActive, "plan_yearly", intent, expiry)
	env.play.LinkSubscription(storeTestPackageName, third, second)

	for _, token := range []string{third, second} {
		if err := env.notifyGooglePlay(t, env.pushAuthorization(t), playSubscriptionNotification(playPurchased, token)); err != nil {
			t.Fatalf("ProcessGooglePlayNotification of %s: %v", token, err)
		}
		if got := env.recordedSubscription(t); got.id != before.id || got.storeID != third || got.planID != yearly.ID || got.status != "active" || !got.periodEnd.Equal(expiry) {
			t.Fatalf("after the notification of %s recorded %+v, want %s on %s, the yearly plan until %s", token, got, before.id, third, expiry)
		}
	}
	if got := env.subscriptionRows(t); got != 1 {
		t.Fatalf("subscriptions recorded = %d, want the one", got)
	}
}

// A voided purchase of a one-time product takes the purchase back, as the
// hourly sync of voided purchases does; one of a subscription closes it.
func TestDBGooglePlayVoidedPurchaseNotificationTakesThePurchaseBack(t *testing.T) {
	t.Parallel()

	env := newStoreSubscriptionEnv(t)
	intent := env.start(t, env.token)
	const purchaseToken = "play-token-voided-rtdn.AO-J1Oy"
	env.play.Put(t, storeTestPackageName, intent.ProductId, purchaseToken, googleplaytest.Purchased, intent.IntentId)
	if _, err := env.confirmGooglePlay(t, intent.ProductId, purchaseToken); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	voided := func(token string, productType int) map[string]any {
		return map[string]any{
			"version":         "1.0",
			"packageName":     storeTestPackageName,
			"eventTimeMillis": "1761292800000",
			"voidedPurchaseNotification": map[string]any{
				"purchaseToken": token,
				"orderId":       "GPA.3367-5501-8812-47216",
				"productType":   productType,
				"refundType":    1,
			},
		}
	}
	for range 2 {
		if err := env.notifyGooglePlay(t, env.pushAuthorization(t), voided(purchaseToken, googleplay.VoidedProductTypeOneTime)); err != nil {
			t.Fatalf("ProcessGooglePlayNotification of a voided purchase: %v", err)
		}
	}
	if purchases := env.listPurchases(t); len(purchases) != 1 || purchases[0].IsActive {
		t.Fatalf("purchases = %+v, want the one purchase closed", purchases)
	}

	const subscriptionToken = "play-subscription-voided-rtdn.AO-J1Oy"
	env.mustConfirmGooglePlaySubscription(t, subscriptionToken, time.Now().Add(30*24*time.Hour))
	revokedAt := time.Now().Add(-time.Minute).Truncate(time.Millisecond).UTC()
	env.play.PutSubscription(t, storeTestPackageName, subscriptionToken, googleplaytest.SubscriptionExpired, storeSubscriptionGooglePlayProduct, env.recordedIntent(t), revokedAt)
	if err := env.notifyGooglePlay(t, env.pushAuthorization(t), voided(subscriptionToken, googleplay.VoidedProductTypeSubscription)); err != nil {
		t.Fatalf("ProcessGooglePlayNotification of a voided subscription: %v", err)
	}
	if got := env.recordedSubscription(t); got.status != "canceled" || !got.periodEnd.Equal(revokedAt) {
		t.Fatalf("after the voided subscription it is %s until %s, want canceled at %s", got.status, got.periodEnd, revokedAt)
	}
	env.requireEntitlement(t, publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED, "after the voided subscription")
	if got := env.count(t, "SELECT count(*) FROM unapplied_store_refunds WHERE store_transaction_id = $1", subscriptionToken); got != 0 {
		t.Fatalf("held refunds of the subscription = %d, want none", got)
	}
}
