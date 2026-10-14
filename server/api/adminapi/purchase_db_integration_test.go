package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

const purchaseTestSecretKey = "sk_test_51PurchaseListAAAA"

// purchaseFixture is a tenant that sells through Stripe, whose API is a fake,
// with two series, three episodes, and two readers to buy them.
type purchaseFixture struct {
	env      *adminDBEnv
	stripe   *stripetest.API
	admin    adminDBTenant
	seriesA  testutil.Series
	seriesB  testutil.Series
	episodeA testutil.Episode
	episodeC testutil.Episode
	episodeB testutil.Episode
	alice    testutil.TenantUser
	bob      testutil.TenantUser
}

func newPurchaseFixture(t *testing.T) *purchaseFixture {
	t.Helper()

	api := stripetest.NewAPI(t)
	env := newAdminDBEnvWithPaymentProviders(t, paymentprovider.NewRegistry(stripe.New(stripe.WithAPIURL(api.URL()))))
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	f := &purchaseFixture{env: env, stripe: api, admin: admin}
	f.seriesA = env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A", Published: true})
	f.seriesB = env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB1", Title: "Series B", Published: true})
	published := time.Now().Add(-time.Hour)
	f.episodeA = env.PG.SeedEpisode(t, admin.Tenant.ID, f.seriesA.ID, testutil.EpisodeSeed{PublicID: "EPISODEA1", Title: "Episode A1", Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: published})
	f.episodeC = env.PG.SeedEpisode(t, admin.Tenant.ID, f.seriesA.ID, testutil.EpisodeSeed{PublicID: "EPISODEA2", Title: "Episode A2", Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: published})
	f.episodeB = env.PG.SeedEpisode(t, admin.Tenant.ID, f.seriesB.ID, testutil.EpisodeSeed{PublicID: "EPISODEB1", Title: "Episode B1", Price: 500, Status: testutil.EpisodeStatusPublished, PublishedAt: published})
	f.alice = env.PG.SeedEndUser(t, admin.Tenant.ID, "READERALICE", "alice@example.com", "Alice")
	f.bob = env.PG.SeedEndUser(t, admin.Tenant.ID, "READERBOB01", "bob@example.com", "Bob")

	if _, err := env.paymentClient().UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant:   admin.tenantContext(),
		Provider: stripe.ID,
		Enabled:  true,
		Currency: "JPY",
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: purchaseTestSecretKey},
			{Name: stripe.FieldWebhookSecret, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: "whsec_PurchaseListAAAA"},
		},
	}); err != nil {
		t.Fatalf("save the Stripe settings: %v", err)
	}
	return f
}

func (f *purchaseFixture) client() publiraadminv1connect.AdminPurchaseServiceClient {
	return publiraadminv1connect.NewAdminPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(f.env.Server.Client(), f.env.Server.URL)))
}

func (f *purchaseFixture) ctx() context.Context {
	return testutil.WithBearer(context.Background(), f.admin.token())
}

// purchaseSeed is one purchase to insert. With neither a provider payment nor
// a store it is a purchase made without a payment.
type purchaseSeed struct {
	reader      testutil.TenantUser
	episode     testutil.Episode
	purchasedAt time.Time
	// paymentID makes it a Stripe purchase, and a payment the fake has been
	// paid for.
	paymentID string
	store     string
	// revocationReason revokes it; "refund" records it refunded in full too.
	revocationReason string
}

func (f *purchaseFixture) seedPurchase(t *testing.T, seed purchaseSeed) uuid.UUID {
	t.Helper()

	id := uuid.Must(uuid.NewV7())
	var provider, checkoutID, paymentID, store, transactionID, reason sql.NullString
	if seed.paymentID != "" {
		provider = sql.NullString{String: stripe.ID, Valid: true}
		checkoutID = sql.NullString{String: "cs_" + seed.paymentID, Valid: true}
		paymentID = sql.NullString{String: seed.paymentID, Valid: true}
		f.stripe.SetPaymentIntent(purchaseTestSecretKey, seed.paymentID, int64(seed.episode.Price), "JPY")
	}
	if seed.store != "" {
		store = sql.NullString{String: seed.store, Valid: true}
		transactionID = sql.NullString{String: "txn_" + id.String(), Valid: true}
	}
	if seed.revocationReason != "" {
		reason = sql.NullString{String: seed.revocationReason, Valid: true}
	}
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (
			id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency,
			provider, provider_checkout_id, provider_payment_id, store, store_transaction_id,
			revoked_at, revocation_reason, refunded_amount, refunded_at
		)
		VALUES (
			$1, $2, $3, $4, $5::integer, $6, 'JPY',
			$7, $8, $9, $10, $11,
			CASE WHEN $12::text IS NOT NULL THEN NOW() END, $12::text,
			CASE WHEN $12::text = 'refund' THEN $5::integer END,
			CASE WHEN $12::text = 'refund' THEN NOW() END
		)
	`, id, f.admin.Tenant.ID, seed.reader.ID, seed.episode.ID, seed.episode.Price, seed.purchasedAt,
		provider, checkoutID, paymentID, store, transactionID, reason); err != nil {
		t.Fatalf("insert a purchase of %s: %v", seed.episode.PublicID, err)
	}
	return id
}

func (f *purchaseFixture) list(t *testing.T, req *publiraadminv1.ListPurchasesRequest) *publiraadminv1.ListPurchasesResponse {
	t.Helper()

	req.Tenant = f.admin.tenantContext()
	res, err := f.client().ListPurchases(f.ctx(), req)
	if err != nil {
		t.Fatalf("ListPurchases: %v", err)
	}
	return res
}

func (f *purchaseFixture) refund(purchaseID uuid.UUID) (*publiraadminv1.AdminPurchase, error) {
	res, err := f.client().RefundPurchase(f.ctx(), &publiraadminv1.RefundPurchaseRequest{
		Tenant:     f.admin.tenantContext(),
		PurchaseId: purchaseID.String(),
	})
	if err != nil {
		return nil, err
	}
	return res.Purchase, nil
}

func (f *purchaseFixture) refundAudits(t *testing.T, purchaseID uuid.UUID) int {
	t.Helper()
	return f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'purchase_refunded' AND target_type = 'purchase' AND target_id = $2",
		f.admin.Tenant.ID, purchaseID.String(),
	)
}

func purchaseIDs(purchases []*publiraadminv1.AdminPurchase) []string {
	ids := make([]string, 0, len(purchases))
	for _, purchase := range purchases {
		ids = append(ids, purchase.Id)
	}
	return ids
}

func assertPurchaseIDs(t *testing.T, label string, got []*publiraadminv1.AdminPurchase, want ...uuid.UUID) {
	t.Helper()

	gotIDs := purchaseIDs(got)
	if len(gotIDs) != len(want) {
		t.Fatalf("%s = %v, want %v", label, gotIDs, want)
	}
	for i, id := range want {
		if gotIDs[i] != id.String() {
			t.Fatalf("%s = %v, want %v", label, gotIDs, want)
		}
	}
}

func assertConnectCode(t *testing.T, label string, err error, want connect.Code) {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != want {
		t.Fatalf("%s error = %v, want %v", label, err, want)
	}
}

// The list runs newest first and narrows to a series, an episode, a reader's
// address, and a period, each of which a page token keeps to.
func TestDBListPurchasesFiltersAndPages(t *testing.T) {
	f := newPurchaseFixture(t)
	day := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	first := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: day, paymentID: "pi_first"})
	second := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeC, purchasedAt: day.Add(24 * time.Hour), paymentID: "pi_second"})
	third := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeB, purchasedAt: day.Add(48 * time.Hour), store: "app_store"})
	fourth := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeA, purchasedAt: day.Add(72 * time.Hour)})

	t.Run("every purchase, newest first", func(t *testing.T) {
		assertPurchaseIDs(t, "purchases", f.list(t, &publiraadminv1.ListPurchasesRequest{}).Purchases, fourth, third, second, first)
	})

	t.Run("one series", func(t *testing.T) {
		assertPurchaseIDs(t, "purchases of series A", f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID}).Purchases, fourth, second, first)
	})

	t.Run("one episode", func(t *testing.T) {
		assertPurchaseIDs(t, "purchases of episode A1", f.list(t, &publiraadminv1.ListPurchasesRequest{EpisodePublicId: f.episodeA.PublicID}).Purchases, fourth, first)
	})

	t.Run("one reader's address in any case", func(t *testing.T) {
		assertPurchaseIDs(t, "purchases by Alice", f.list(t, &publiraadminv1.ListPurchasesRequest{ReaderEmail: " Alice@Example.com "}).Purchases, third, first)
	})

	t.Run("a period", func(t *testing.T) {
		res := f.list(t, &publiraadminv1.ListPurchasesRequest{
			PurchasedFrom: day.Add(24 * time.Hour).Format(time.RFC3339),
			PurchasedTo:   day.Add(72 * time.Hour).Format(time.RFC3339),
		})
		assertPurchaseIDs(t, "purchases in the period", res.Purchases, third, second)
	})

	t.Run("a series or an episode the tenant does not have lists nothing", func(t *testing.T) {
		if got := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: "NOSUCHSR"}).Purchases; len(got) != 0 {
			t.Fatalf("purchases of an unknown series = %v, want none", purchaseIDs(got))
		}
		if got := f.list(t, &publiraadminv1.ListPurchasesRequest{EpisodePublicId: "NOSUCHEP"}).Purchases; len(got) != 0 {
			t.Fatalf("purchases of an unknown episode = %v, want none", purchaseIDs(got))
		}
	})

	t.Run("pages keep to the filter in both directions", func(t *testing.T) {
		page1 := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID, Limit: 2})
		assertPurchaseIDs(t, "page 1", page1.Purchases, fourth, second)
		if page1.PreviousToken != "" || page1.NextToken == "" {
			t.Fatalf("page 1 tokens = (%q, %q), want only a next one", page1.PreviousToken, page1.NextToken)
		}
		page2 := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID, Limit: 2, Token: page1.NextToken})
		assertPurchaseIDs(t, "page 2", page2.Purchases, first)
		if page2.PreviousToken == "" || page2.NextToken != "" {
			t.Fatalf("page 2 tokens = (%q, %q), want only a previous one", page2.PreviousToken, page2.NextToken)
		}
		back := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID, Limit: 2, Token: page2.PreviousToken})
		assertPurchaseIDs(t, "back to page 1", back.Purchases, fourth, second)

		_, err := f.client().ListPurchases(f.ctx(), &publiraadminv1.ListPurchasesRequest{
			Tenant: f.admin.tenantContext(),
			Limit:  2,
			Token:  page1.NextToken,
		})
		assertConnectCode(t, "a token used without its filter", err, connect.CodeInvalidArgument)
	})

	t.Run("a purchase says where it was paid and whether it can be refunded here", func(t *testing.T) {
		purchases := f.list(t, &publiraadminv1.ListPurchasesRequest{}).Purchases
		byID := map[string]*publiraadminv1.AdminPurchase{}
		for _, purchase := range purchases {
			byID[purchase.Id] = purchase
		}
		stripePurchase := byID[first.String()]
		if stripePurchase.Provider != stripe.ID || !stripePurchase.Refundable || stripePurchase.Price != 500 || stripePurchase.Currency != "JPY" {
			t.Fatalf("Stripe purchase = %+v, want a refundable 500 JPY through stripe", stripePurchase)
		}
		if stripePurchase.ReaderEmail != f.alice.Email || stripePurchase.SeriesPublicId != f.seriesA.PublicID || stripePurchase.EpisodePublicId != f.episodeA.PublicID {
			t.Fatalf("Stripe purchase names %q, %q, %q", stripePurchase.ReaderEmail, stripePurchase.SeriesPublicId, stripePurchase.EpisodePublicId)
		}
		if store := byID[third.String()]; store.Store != "app_store" || store.Provider != "" || store.Refundable {
			t.Fatalf("store purchase = %+v, want an unrefundable app_store one", store)
		}
		if grant := byID[fourth.String()]; grant.Provider != "" || grant.Store != "" || grant.Refundable {
			t.Fatalf("purchase without a payment = %+v, want neither a provider nor a store, and unrefundable", grant)
		}
	})
}

func TestDBGetPurchaseAnswersOnlyTheTenantsOwn(t *testing.T) {
	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_get"})

	res, err := f.client().GetPurchase(f.ctx(), &publiraadminv1.GetPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: purchaseID.String()})
	if err != nil {
		t.Fatalf("GetPurchase: %v", err)
	}
	if res.Purchase.Id != purchaseID.String() || res.Purchase.EpisodeTitle != f.episodeA.Title || res.Purchase.ReaderName != f.alice.Name {
		t.Fatalf("purchase = %+v", res.Purchase)
	}

	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	_, err = f.client().GetPurchase(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.GetPurchaseRequest{Tenant: other.tenantContext(), PurchaseId: purchaseID.String()})
	assertConnectCode(t, "GetPurchase from another tenant", err, connect.CodeNotFound)
	_, err = f.client().RefundPurchase(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.RefundPurchaseRequest{Tenant: other.tenantContext(), PurchaseId: purchaseID.String()})
	assertConnectCode(t, "RefundPurchase from another tenant", err, connect.CodeNotFound)
	if refunds := f.stripe.Refunds(); len(refunds) != 0 {
		t.Fatalf("refunds = %+v, want none for another tenant's request", refunds)
	}
}

// A refund is asked of Stripe under the tenant's key and revokes the purchase
// at once. Asking again changes nothing: no second refund, no second audit
// entry, and the revocation keeps its instant.
func TestDBRefundPurchaseRefundsThroughTheProviderOnce(t *testing.T) {
	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_refund"})

	refunded, err := f.refund(purchaseID)
	if err != nil {
		t.Fatalf("RefundPurchase: %v", err)
	}
	if refunded.RevokedAt == "" || refunded.RevocationReason != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_STAFF || refunded.Refundable {
		t.Fatalf("refunded purchase = %+v, want revoked by staff and no longer refundable", refunded)
	}
	refunds := f.stripe.Refunds()
	if len(refunds) != 1 {
		t.Fatalf("refunds = %+v, want one", refunds)
	}
	if refund := refunds[0]; refund.SecretKey != purchaseTestSecretKey || refund.PaymentIntentID != "pi_refund" || refund.Amount != 500 || refund.IdempotencyKey == "" {
		t.Fatalf("refund = %+v, want 500 on pi_refund under the tenant's key and an idempotency key", refund)
	}
	if got := f.refundAudits(t, purchaseID); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}

	again, err := f.refund(purchaseID)
	if err != nil {
		t.Fatalf("RefundPurchase again: %v", err)
	}
	if again.RevokedAt != refunded.RevokedAt {
		t.Fatalf("revoked_at after a repeat = %q, want %q", again.RevokedAt, refunded.RevokedAt)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 1 {
		t.Fatalf("refunds after a repeat = %+v, want still one", refunds)
	}
	if got := f.refundAudits(t, purchaseID); got != 1 {
		t.Fatalf("audit entries after a repeat = %d, want still 1", got)
	}

	// Stripe's notification of the refund then records the amount, and the
	// revocation keeps the reason staff gave it.
	recorded, err := dbmodels.New(f.env.PG.DB).RecordRefundOnPurchase(context.Background(), dbmodels.RecordRefundOnPurchaseParams{
		TenantID:          f.admin.Tenant.ID,
		Provider:          stripe.ID,
		ProviderPaymentID: "pi_refund",
		RefundedAmount:    sql.NullInt32{Int32: 500, Valid: true},
		Currency:          sql.NullString{String: "JPY", Valid: true},
	})
	if err != nil {
		t.Fatalf("record the refund notification: %v", err)
	}
	if !recorded.RefundedAt.Valid || recorded.RevocationReason.String != purchaseRevocationStaff {
		t.Fatalf("after the notification refunded_at = %v and reason = %q, want refunded and still staff", recorded.RefundedAt, recorded.RevocationReason.String)
	}
}

// A purchase refunded in the provider's dashboard already is answered as it is,
// without asking the provider again or adding an audit entry.
func TestDBRefundPurchaseLeavesAFullRefundAsItIs(t *testing.T) {
	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_done", revocationReason: purchaseRevocationRefund})

	purchase, err := f.refund(purchaseID)
	if err != nil {
		t.Fatalf("RefundPurchase: %v", err)
	}
	if purchase.RevocationReason != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_REFUND || purchase.RefundedAmount != 500 {
		t.Fatalf("purchase = %+v, want the refund it already had", purchase)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 0 {
		t.Fatalf("refunds = %+v, want none", refunds)
	}
	if got := f.refundAudits(t, purchaseID); got != 0 {
		t.Fatalf("audit entries = %d, want none", got)
	}
}

// A payment refunded in full in Stripe's dashboard, whose notification has not
// arrived yet, is no refund staff made: the purchase is left open for that
// notification, with no staff revocation and no audit entry.
func TestDBRefundPurchaseLeavesADashboardRefundToItsNotification(t *testing.T) {
	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_dashboard"})
	f.stripe.SetRefunded(purchaseTestSecretKey, "pi_dashboard", 500)

	purchase, err := f.refund(purchaseID)
	if err != nil {
		t.Fatalf("RefundPurchase: %v", err)
	}
	if purchase.RevokedAt != "" || purchase.RevocationReason != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_UNSPECIFIED {
		t.Fatalf("purchase = %+v, want it left open for the notification", purchase)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 0 {
		t.Fatalf("refunds = %+v, want none", refunds)
	}
	if got := f.refundAudits(t, purchaseID); got != 0 {
		t.Fatalf("audit entries = %d, want none", got)
	}
}

func TestDBRefundPurchaseRefusesWhatItCannotRefund(t *testing.T) {
	f := newPurchaseFixture(t)
	purchasedAt := time.Now().Add(-time.Hour)

	cases := []struct {
		name string
		seed purchaseSeed
	}{
		{name: "a store purchase", seed: purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt, store: "google_play"}},
		{name: "a purchase made without a payment", seed: purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt}},
		{name: "a disputed purchase", seed: purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt, paymentID: "pi_disputed", revocationReason: purchaseRevocationDispute}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			purchaseID := f.seedPurchase(t, tc.seed)
			_, err := f.refund(purchaseID)
			assertConnectCode(t, "RefundPurchase", err, connect.CodeFailedPrecondition)
			if got := f.refundAudits(t, purchaseID); got != 0 {
				t.Fatalf("audit entries = %d, want none", got)
			}
		})
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 0 {
		t.Fatalf("refunds = %+v, want none", refunds)
	}

	t.Run("a refund Stripe refuses leaves the purchase open", func(t *testing.T) {
		purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeB, purchasedAt: purchasedAt, paymentID: "pi_refused"})
		// Stripe has no such payment under the tenant's key.
		f.stripe.SetPaymentIntent(purchaseTestSecretKey, "pi_refused", 0, "JPY")
		_, err := f.refund(purchaseID)
		assertConnectCode(t, "RefundPurchase", err, connect.CodeFailedPrecondition)
		res, err := f.client().GetPurchase(f.ctx(), &publiraadminv1.GetPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: purchaseID.String()})
		if err != nil {
			t.Fatalf("GetPurchase: %v", err)
		}
		if res.Purchase.RevokedAt != "" || !res.Purchase.Refundable {
			t.Fatalf("purchase after a refused refund = %+v, want still open and refundable", res.Purchase)
		}
		if got := f.refundAudits(t, purchaseID); got != 0 {
			t.Fatalf("audit entries = %d, want none", got)
		}
	})

	t.Run("a refund Stripe answers as failed leaves the purchase open", func(t *testing.T) {
		purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeB, purchasedAt: purchasedAt, paymentID: "pi_failed"})
		f.stripe.FailNextRefund(purchaseTestSecretKey, "pi_failed")
		_, err := f.refund(purchaseID)
		assertConnectCode(t, "RefundPurchase", err, connect.CodeFailedPrecondition)
		res, err := f.client().GetPurchase(f.ctx(), &publiraadminv1.GetPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: purchaseID.String()})
		if err != nil {
			t.Fatalf("GetPurchase: %v", err)
		}
		if res.Purchase.RevokedAt != "" || !res.Purchase.Refundable {
			t.Fatalf("purchase after a failed refund = %+v, want still open and refundable", res.Purchase)
		}
		if got := f.refundAudits(t, purchaseID); got != 0 {
			t.Fatalf("audit entries = %d, want none", got)
		}
	})

	t.Run("a tenant whose payments are off", func(t *testing.T) {
		purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeC, purchasedAt: purchasedAt, paymentID: "pi_disabled"})
		if _, err := f.env.paymentClient().UpdateTenantPaymentSettings(f.ctx(), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
			Tenant:   f.admin.tenantContext(),
			Provider: stripe.ID,
			Enabled:  false,
		}); err != nil {
			t.Fatalf("turn payments off: %v", err)
		}
		_, err := f.refund(purchaseID)
		assertConnectCode(t, "RefundPurchase", err, connect.CodeFailedPrecondition)
		res, err := f.client().GetPurchase(f.ctx(), &publiraadminv1.GetPurchaseRequest{Tenant: f.admin.tenantContext(), PurchaseId: purchaseID.String()})
		if err != nil {
			t.Fatalf("GetPurchase: %v", err)
		}
		if res.Purchase.Refundable {
			t.Fatal("a purchase is refundable while the tenant's payments are off")
		}
		for _, refund := range f.stripe.Refunds() {
			if refund.PaymentIntentID == "pi_disabled" {
				t.Fatalf("refund = %+v, want none while payments are off", refund)
			}
		}
	})
}

// Two requests that refund the same purchase at once ask Stripe for one
// refund between them, and leave one audit entry.
func TestDBRefundPurchaseRecordsOneRefundForConcurrentRequests(t *testing.T) {
	f := newPurchaseFixture(t)
	purchaseID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_concurrent"})

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Go(func() {
			_, errs[i] = f.refund(purchaseID)
		})
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("RefundPurchase %d: %v", i+1, err)
		}
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 1 {
		t.Fatalf("refunds = %+v, want one", refunds)
	}
	if got := f.refundAudits(t, purchaseID); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}
}

// The provider's notification of a refund staff asked for can be recorded
// before the purchase is revoked, and then gives way to staff. A dispute that
// came first stays, and a purchase staff revoked already is not revoked again.
func TestDBRevokePurchaseForStaffTakesOverOnlyTheRefundsOwnNotification(t *testing.T) {
	f := newPurchaseFixture(t)
	purchasedAt := time.Now().Add(-time.Hour)
	queries := dbmodels.New(f.env.PG.DB)
	revoke := func(purchaseID uuid.UUID) error {
		_, err := queries.RevokePurchaseForStaff(context.Background(), dbmodels.RevokePurchaseForStaffParams{TenantID: f.admin.Tenant.ID, ID: purchaseID})
		return err
	}
	reason := func(purchaseID uuid.UUID) string {
		var reason sql.NullString
		if err := f.env.PG.DB.QueryRowContext(context.Background(), "SELECT revocation_reason FROM purchases WHERE id = $1", purchaseID).Scan(&reason); err != nil {
			t.Fatalf("read the revocation reason: %v", err)
		}
		return reason.String
	}

	refunded := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt, paymentID: "pi_notified_first", revocationReason: purchaseRevocationRefund})
	if err := revoke(refunded); err != nil {
		t.Fatalf("revoke a purchase whose refund was recorded first: %v", err)
	}
	if got := reason(refunded); got != purchaseRevocationStaff {
		t.Fatalf("reason after the revocation = %q, want staff", got)
	}
	if err := revoke(refunded); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("revoke a purchase staff revoked already: %v, want no row", err)
	}

	disputed := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: purchasedAt, paymentID: "pi_disputed_first", revocationReason: purchaseRevocationDispute})
	if err := revoke(disputed); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("revoke a disputed purchase: %v, want no row", err)
	}
	if got := reason(disputed); got != purchaseRevocationDispute {
		t.Fatalf("reason of a disputed purchase = %q, want dispute", got)
	}
}
