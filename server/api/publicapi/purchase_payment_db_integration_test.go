package publicapi

import (
	"bytes"
	"context"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBProcessPaymentWebhookIsolatesTenantSigningSecrets(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenantA := pg.SeedTenant(t, "PAYISOLA", "pay-iso-a.example.com", "Pay Iso A")
	tenantB := pg.SeedTenant(t, "PAYISOLB", "pay-iso-b.example.com", "Pay Iso B")
	tenantC := pg.SeedTenant(t, "PAYISOLC", "pay-iso-c.example.com", "Pay Iso C")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenantA.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert tenant A: %v", err)
	}
	if _, err := store.Upsert(ctx, tenantB.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               "sk_test_51TenantBLeakXXXX",
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testOtherWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert tenant B: %v", err)
	}

	var logs bytes.Buffer
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.New(slog.NewTextHandler(&logs, nil)), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)

	payload, headerA := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_a"})
	if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantA.ID.String(), payload, headerA)); err != nil {
		t.Fatalf("tenant A with own secret: %v", err)
	}

	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantB.ID.String(), payload, headerA))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("tenant B with tenant A secret code = %v, want invalid_argument", connect.CodeOf(err))
	}

	_, err = client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantC.ID.String(), payload, headerA))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("tenant C without settings code = %v, want failed_precondition", connect.CodeOf(err))
	}

	dump := logs.String()
	if err != nil {
		dump += err.Error()
	}
	assertNoSecretLeak(t, dump)
	if strings.Contains(dump, "sk_test_51TenantBLeakXXXX") {
		t.Fatalf("logs leaked tenant B secret: %s", dump)
	}
}

func TestDBStartEpisodeCheckoutRefusesDisabledTenantSettings(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYDISAB", "pay-disabled.example.com", "Pay Disabled")
	user := pg.SeedEndUser(t, tenant.ID, "PAYUSR000001", "buyer@example.com", "Buyer")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 false,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert disabled settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	ts := httptest.NewServer(mustPublicHandler(t, db, dbmodels.New(db), encryptor))
	t.Cleanup(ts.Close)

	token, _, err := testutil.TokenManager().Issue(
		user.PublicID,
		auth.AudiencePublic,
		tenant.ID.String(),
		user.Role,
		user.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)
	_, err = client.StartEpisodeCheckout(context.Background(), newBearerRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodePublicId: "EPISODE001",
		Tenant:          tenantContext(tenant),
	}, token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
	}
}

func TestDBProcessPaymentWebhookProjectsPurchaseEventIdempotently(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYPROJ", "pay-projection.example.com", "Pay Projection")
	user := pg.SeedEndUser(t, tenant.ID, "PAYPROJUSER", "projection@example.com", "Projection buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)

	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":             "cs_purchase_projection",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		// The payment intent is stored alongside the session and carries a
		// unique index of its own, so the redelivery below also proves the
		// second insert conflicts on the session rather than on that index.
		"payment_intent": "pi_purchase_projection",
		"metadata": map[string]string{
			stripe.MetadataTenantID:  tenant.ID.String(),
			stripe.MetadataUserID:    user.ID.String(),
			stripe.MetadataEpisodeID: episode.ID.String(),
			stripe.MetadataPrice:     "500",
		},
	})
	if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("first ProcessPaymentWebhook: %v", err)
	}
	if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("retry ProcessPaymentWebhook: %v", err)
	}

	var (
		purchaseID   uuid.UUID
		eventType    string
		eventUser    uuid.UUID
		eventSeries  uuid.UUID
		eventEpisode uuid.UUID
		sourceTable  string
		sourceID     uuid.UUID
	)
	err := pg.DB.QueryRowContext(ctx, `
		SELECT p.id, ce.event_type, ce.user_id, ce.series_id, ce.episode_id, ce.source_table, ce.source_id
		FROM purchases p
		JOIN content_events ce
			ON ce.tenant_id = p.tenant_id
			AND ce.source_table = 'purchases'
			AND ce.source_id = p.id
		WHERE p.tenant_id = $1
	`, tenant.ID).Scan(&purchaseID, &eventType, &eventUser, &eventSeries, &eventEpisode, &sourceTable, &sourceID)
	if err != nil {
		t.Fatalf("read projected purchase event: %v", err)
	}
	if eventType != "purchase" || eventUser != user.ID || eventSeries != series.ID || eventEpisode != episode.ID || sourceTable != "purchases" || sourceID != purchaseID {
		t.Fatalf("projected event = type=%q user=%s series=%s episode=%s source=%s/%s, want purchase SoT projection", eventType, eventUser, eventSeries, eventEpisode, sourceTable, sourceID)
	}

	var eventCount int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*)
		FROM content_events
		WHERE tenant_id = $1 AND source_table = 'purchases' AND source_id = $2
	`, tenant.ID, purchaseID).Scan(&eventCount); err != nil {
		t.Fatalf("count projected purchase events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("projected purchase events = %d, want 1", eventCount)
	}
}

func TestDBProcessPaymentWebhookCreatesADelayedPurchaseOnceItIsPaid(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYDELAY", "pay-delayed.example.com", "Pay Delayed")
	user := pg.SeedEndUser(t, tenant.ID, "PAYDELAYUSER", "delayed@example.com", "Delayed buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               testCheckoutSecretKey,
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)

	session := func(paymentStatus string) map[string]any {
		return map[string]any{
			"id":             "cs_delayed_payment",
			"object":         "checkout.session",
			"amount_total":   500,
			"currency":       "jpy",
			"payment_status": paymentStatus,
			"payment_intent": "pi_delayed_payment",
			"metadata": map[string]string{
				stripe.MetadataTenantID:  tenant.ID.String(),
				stripe.MetadataUserID:    user.ID.String(),
				stripe.MetadataEpisodeID: episode.ID.String(),
				stripe.MetadataPrice:     "500",
			},
		}
	}
	countPurchases := func() int {
		t.Helper()
		var count int
		if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM purchases WHERE tenant_id = $1`, tenant.ID).Scan(&count); err != nil {
			t.Fatalf("count purchases: %v", err)
		}
		return count
	}

	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", session("unpaid"))
	if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("unpaid checkout.session.completed: %v", err)
	}
	if got := countPurchases(); got != 0 {
		t.Fatalf("purchases after the unpaid session = %d, want 0", got)
	}

	payload, signature = stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.async_payment_succeeded", session("paid"))
	if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
		t.Fatalf("checkout.session.async_payment_succeeded: %v", err)
	}
	if got := countPurchases(); got != 1 {
		t.Fatalf("purchases after the payment succeeded = %d, want 1", got)
	}
}
