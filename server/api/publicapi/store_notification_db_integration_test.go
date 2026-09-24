package publicapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/storepurchase"
)

// notify posts an App Store Server Notifications V2 body, signed by signer,
// the way web-host forwards one.
func (e *storePurchaseEnv) notify(t *testing.T, signer *appstoretest.Signer, notification appstoretest.Notification) error {
	t.Helper()
	body, err := json.Marshal(map[string]string{"signedPayload": signer.Sign(t, notification)})
	if err != nil {
		t.Fatalf("encode notification: %v", err)
	}
	_, err = e.client.ProcessAppStoreNotification(context.Background(), connect.NewRequest(&publirav1.ProcessAppStoreNotificationRequest{
		Tenant:  tenantContext(e.tenant),
		Payload: body,
	}))
	return err
}

func (e *storePurchaseEnv) refundNotification(t *testing.T, transaction appstoretest.Transaction) appstoretest.Notification {
	t.Helper()
	transaction.RevocationDate = time.Now().UnixMilli()
	return appstoretest.Notification{
		NotificationType: appstore.NotificationTypeRefund,
		NotificationUUID: uuid.NewString(),
		Version:          "2.0",
		SignedDate:       time.Now().UnixMilli(),
		Data: appstoretest.NotificationData{
			BundleID:              transaction.BundleID,
			Environment:           transaction.Environment,
			SignedTransactionInfo: e.signer.Sign(t, transaction),
		},
	}
}

func (e *storePurchaseEnv) royaltyGross(t *testing.T) int64 {
	t.Helper()
	totals, err := dbmodels.New(e.pg.DB).GetRoyaltySalesTotalsForPeriod(context.Background(), dbmodels.GetRoyaltySalesTotalsForPeriodParams{
		TenantID: e.tenant.ID,
		Period:   time.Date(time.Now().UTC().Year(), time.Now().UTC().Month(), 1, 0, 0, 0, 0, time.UTC),
		TimeZone: "UTC",
	})
	if err != nil {
		t.Fatalf("GetRoyaltySalesTotalsForPeriod: %v", err)
	}
	return totals.TotalGross
}

func (e *storePurchaseEnv) listPurchases(t *testing.T) []*publirav1.MyPurchase {
	t.Helper()
	res, err := e.client.ListMyPurchases(context.Background(), newBearerRequest(&publirav1.ListMyPurchasesRequest{
		Tenant: tenantContext(e.tenant),
	}, e.token))
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	return res.Msg.Purchases
}

func TestDBAppStoreRefundClosesTheReadingRightAndLeavesTheRoyaltyStatement(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000100", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	if _, err := env.confirmAppStore(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if got := env.royaltyGross(t); got != 300 {
		t.Fatalf("royalty gross before the refund = %d, want 300", got)
	}

	notification := env.refundNotification(t, transaction)
	for range 2 {
		if err := env.notify(t, env.signer, notification); err != nil {
			t.Fatalf("ProcessAppStoreNotification: %v", err)
		}
	}

	purchases := env.listPurchases(t)
	if len(purchases) != 1 || purchases[0].IsActive {
		t.Fatalf("purchases = %+v, want the one purchase closed", purchases)
	}
	if got := env.royaltyGross(t); got != 0 {
		t.Fatalf("royalty gross after the refund = %d, want 0", got)
	}
	// With the purchase refunded, the episode can be bought again.
	if again := env.start(t, env.token); again.IntentId == intent.IntentId {
		t.Fatal("a new start reused the consumed intent")
	}
}

func TestDBAppStoreRefundBeforeTheConfirmationIsAppliedWhenThePurchaseIsRecorded(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000101", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction

	if err := env.notify(t, env.signer, env.refundNotification(t, transaction)); err != nil {
		t.Fatalf("ProcessAppStoreNotification: %v", err)
	}
	purchase, err := env.confirmAppStore(t, env.token, transaction)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if purchase.IsActive {
		t.Fatal("a purchase refunded before it was confirmed opens the episode")
	}
	if got := env.count(t, "SELECT count(*) FROM unapplied_store_refunds"); got != 0 {
		t.Fatalf("held refunds = %d, want the one applied and released", got)
	}
}

func TestDBGooglePlayRefundBeforeTheConfirmationIsAppliedAndNotConsumed(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	const purchaseToken = "play-token-held.AO-J1Oy"
	env.play.Put(t, storeTestPackageName, intent.ProductId, purchaseToken, googleplaytest.Purchased, intent.IntentId)
	if _, err := storepurchase.RecordRefund(context.Background(), dbmodels.New(env.pg.DB), env.tenant.ID, storepurchase.StoreGooglePlay, purchaseToken); err != nil {
		t.Fatalf("hold refund: %v", err)
	}

	purchase, err := env.confirmGooglePlay(t, intent.ProductId, purchaseToken)
	if err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}
	if purchase.IsActive {
		t.Fatal("a purchase Google Play voided before it was confirmed opens the episode")
	}
	if got := env.count(t, "SELECT count(*) FROM outbox_events WHERE event_type = 'google_play_purchase_consume'"); got != 0 {
		t.Fatalf("consume events = %d, want none for a voided purchase", got)
	}
}

func TestDBAppStoreNotificationChangesNothingItCannotTrust(t *testing.T) {
	env := newStorePurchaseEnv(t)
	intent := env.start(t, env.token)
	transaction := env.appStoreTransaction("2000000000000102", intent)
	env.appStore.transactions[transaction.TransactionID] = transaction
	if _, err := env.confirmAppStore(t, env.token, transaction); err != nil {
		t.Fatalf("ConfirmStorePurchase: %v", err)
	}

	otherApp := env.refundNotification(t, transaction)
	otherApp.Data.BundleID = "com.example.another"
	for name, send := range map[string]func() error{
		"a chain Apple did not issue": func() error {
			return env.notify(t, appstoretest.NewUnmarkedSigner(t), env.refundNotification(t, transaction))
		},
		"another app": func() error { return env.notify(t, env.signer, otherApp) },
	} {
		t.Run(name, func(t *testing.T) {
			if err := send(); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ProcessAppStoreNotification code = %v, want invalid_argument", connect.CodeOf(err))
			}
		})
	}

	// A notification the purchase flow has no use for is acknowledged.
	consumption := env.refundNotification(t, transaction)
	consumption.NotificationType = "CONSUMPTION_REQUEST"
	if err := env.notify(t, env.signer, consumption); err != nil {
		t.Fatalf("ProcessAppStoreNotification of CONSUMPTION_REQUEST: %v", err)
	}

	if got := env.count(t, "SELECT count(*) FROM purchases WHERE refunded_at IS NOT NULL"); got != 0 {
		t.Fatalf("refunded purchases = %d, want 0", got)
	}
	if got := env.count(t, "SELECT count(*) FROM unapplied_store_refunds"); got != 0 {
		t.Fatalf("held refunds = %d, want 0", got)
	}
}
