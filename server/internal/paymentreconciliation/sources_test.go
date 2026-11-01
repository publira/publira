package paymentreconciliation

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/appstore/appstoretest"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/testutil"
)

func byID(t *testing.T, records []Record) map[string]Record {
	t.Helper()
	got := map[string]Record{}
	for _, r := range records {
		if _, dup := got[r.PaymentID]; dup {
			t.Fatalf("records = %+v, want each payment once", records)
		}
		got[r.PaymentID] = r
	}
	return got
}

// The App Store is read through the history of each customer a purchase of
// the range names, which also lists that customer's transactions the app never
// recorded, and a customer's history is read once however many purchases name
// it.
func TestAppStoreSourceReadsTheHistoryOfEveryCustomer(t *testing.T) {
	signer := appstoretest.NewSigner(t)
	history := appstoretest.NewHistory(t, signer)
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	transaction := func(id, environment string, at time.Time, price int64, revoked bool) appstoretest.Transaction {
		tx := appstoretest.Transaction{
			TransactionID: id, OriginalTransactionID: id, BundleID: "com.example.reader", ProductID: "episode_300",
			Type: appstore.TypeConsumable, Environment: environment, PurchaseDate: at.UnixMilli(), SignedDate: at.UnixMilli(),
			Price: price, Currency: "JPY",
		}
		if revoked {
			tx.RevocationDate = at.Add(time.Hour).UnixMilli()
		}
		return tx
	}
	history.Put("reader", transaction("1", appstore.EnvironmentProduction, from.Add(time.Hour), 300_000, false))
	history.Put("reader", transaction("2", appstore.EnvironmentProduction, from.Add(2*time.Hour), 300_000, false))
	history.Put("reader", transaction("3", appstore.EnvironmentProduction, from.Add(3*time.Hour), 500_000, true))
	history.Put("tester", transaction("4", appstore.EnvironmentSandbox, from.Add(time.Hour), 300_000, false))
	history.Put("stranger", transaction("5", appstore.EnvironmentProduction, from.Add(time.Hour), 300_000, false))
	other := transaction("6", appstore.EnvironmentProduction, from.Add(4*time.Hour), 300_000, false)
	other.BundleID = "com.example.other"
	history.Put("reader", other)

	src := appStoreSource{
		history:  history.Client(),
		verifier: signer.Verifier(),
		credentials: paymentsettings.AppStoreCredentials{
			IssuerID: "57246542-96fe-1a63-e053-0824d011072a", KeyID: "2X9R4HXF34",
			PrivateKey: appstoretest.PrivateKeyPEM(t), BundleIdentifier: "com.example.reader",
		},
	}
	records, err := src.records(context.Background(), from, from.Add(24*time.Hour), []Purchase{
		{ID: uuid.New(), PaymentID: "1"},
		{ID: uuid.New(), PaymentID: "2"},
		{ID: uuid.New(), PaymentID: "4", Test: true},
		{ID: uuid.New(), PaymentID: "unknown"},
	})
	if err != nil {
		t.Fatalf("records: %v", err)
	}
	got := byID(t, records)
	if len(got) != 4 {
		t.Fatalf("records = %+v, want the reader's three and the tester's one", records)
	}
	if r := got["3"]; !r.Refunded || r.Amount != 500 || r.RefundedAmount != 500 || r.Currency != "JPY" || r.Test {
		t.Fatalf("revoked transaction = %+v, want ¥500 refunded in full", r)
	}
	if r := got["4"]; !r.Test || r.Amount != 300 {
		t.Fatalf("sandbox transaction = %+v, want a ¥300 test record", r)
	}
	if _, ok := got["5"]; ok {
		t.Fatal("a customer no purchase names was read")
	}
}

// Google Play is read through the tenant's purchases, each with its order,
// and through the voided purchases, which are the only purchases the app never
// recorded it lists.
func TestGooglePlaySourceReadsThePurchasesAndTheVoidedOnes(t *testing.T) {
	const pkg = "com.example.reader"
	play := googleplaytest.NewServer(t)
	now := time.Now()
	from := now.Add(-48 * time.Hour)
	purchasedAt := from.Add(time.Hour).Truncate(time.Millisecond)

	play.Put(t, pkg, "episode_300", "paid-token", googleplaytest.Purchased, "")
	play.PutOrder(t, pkg, "episode_300", "paid-token", purchasedAt, "JPY", 0, 300, 0, "PROCESSED")
	play.Put(t, pkg, "episode_300", "refunded-token", googleplaytest.Purchased, "")
	play.PutOrder(t, pkg, "episode_300", "refunded-token", purchasedAt, "USD", 2, 199, 199, googleplay.OrderStateRefunded)
	play.Put(t, pkg, "episode_300", "test-token", googleplaytest.TestPurchase, "")
	play.VoidPurchasedAt(t, pkg, "refunded-token", purchasedAt, now.Add(-time.Hour))
	play.VoidPurchasedAt(t, pkg, "unrecorded-token", purchasedAt, now.Add(-time.Hour))

	src := googlePlaySource{
		client: play.Client(),
		credentials: paymentsettings.GooglePlayCredentials{
			ServiceAccountKey: testutil.ServiceAccountJSON(t, "reader-app", "publira@reader-app.iam.gserviceaccount.com"),
			PackageName:       pkg,
		},
		now: now,
	}
	records, err := src.records(context.Background(), from, now, []Purchase{
		{ID: uuid.New(), PaymentID: "paid-token", ProductID: "episode_300", PurchasedAt: purchasedAt},
		{ID: uuid.New(), PaymentID: "refunded-token", ProductID: "episode_300", PurchasedAt: purchasedAt},
		{ID: uuid.New(), PaymentID: "test-token", ProductID: "episode_300", PurchasedAt: purchasedAt},
		{ID: uuid.New(), PaymentID: "missing-token", ProductID: "episode_300", PurchasedAt: purchasedAt},
	})
	if err != nil {
		t.Fatalf("records: %v", err)
	}
	got := byID(t, records)
	if len(got) != 4 {
		t.Fatalf("records = %+v, want three purchases and one unrecorded voided purchase", records)
	}
	if r := got["paid-token"]; r.Amount != 300 || r.Currency != "JPY" || r.Refunded || !r.OccurredAt.Equal(purchasedAt) {
		t.Fatalf("paid purchase = %+v, want ¥300 standing", r)
	}
	if r := got["refunded-token"]; r.Amount != 199 || r.RefundedAmount != 199 || r.Currency != "USD" || !r.Refunded {
		t.Fatalf("refunded purchase = %+v, want $1.99 refunded in full", r)
	}
	if r := got["test-token"]; !r.Test || r.Currency != "" {
		t.Fatalf("test purchase = %+v, want a test record with no order", r)
	}
	if r := got["unrecorded-token"]; !r.Refunded || r.Currency != "" || !r.OccurredAt.Equal(purchasedAt) {
		t.Fatalf("voided purchase = %+v, want a refunded record dated by its purchase", r)
	}
}
