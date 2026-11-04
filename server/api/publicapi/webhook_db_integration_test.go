package publicapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// A purchase recorded from the provider's notification owes the endpoint that
// subscribed to purchase.completed one event, however often the notification
// is delivered, and an endpoint that subscribed to something else none. The
// worker's handler POSTs it signed so that the documented check accepts it.
func TestDBAPurchaseOwesItsWebhookEndpointOneSignedEvent(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)

	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "PAYHOOK", "pay-hook.example.com", "Pay Hook")
	user := pg.SeedEndUser(t, tenant.ID, "PAYHOOKUSER", "hook@example.com", "Hook buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "HOOKSERIES01", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "HOOKEPISODE1",
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(pg.DB), encryptor, providers.Registry(), nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, stripeSettings(testCheckoutSecretKey, testCheckoutWebhookSecret), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	type received struct {
		signature string
		event     string
		body      []byte
	}
	got := make(chan received, 4)
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got <- received{signature: r.Header.Get(tenantwebhooks.HeaderSignature), event: r.Header.Get(tenantwebhooks.HeaderEvent), body: body}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(receiver.Close)

	secret, err := tenantwebhooks.NewSecret()
	if err != nil {
		t.Fatalf("NewSecret: %v", err)
	}
	sealed, err := encryptor.EncryptString(secret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	insertEndpoint := func(eventType string) uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
			VALUES ($1, $2, $3, $4, 'whsec_••••', ARRAY[$5])
		`, id, tenant.ID, receiver.URL+"/publira", sealed, eventType); err != nil {
			t.Fatalf("insert webhook endpoint: %v", err)
		}
		return id
	}
	subscribed := insertEndpoint(tenantwebhooks.EventPurchaseCompleted)
	insertEndpoint(tenantwebhooks.EventReaderSignedUp)

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))

	payload, signature := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":             "cs_purchase_hook",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"payment_intent": "pi_purchase_hook",
		"metadata": map[string]string{
			stripe.MetadataTenantID:  tenant.ID.String(),
			stripe.MetadataUserID:    user.ID.String(),
			stripe.MetadataEpisodeID: episode.ID.String(),
			stripe.MetadataPrice:     "500",
		},
	})
	for attempt := range 3 {
		if _, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenant.ID.String(), payload, signature)); err != nil {
			t.Fatalf("delivery %d of ProcessPaymentWebhook: %v", attempt+1, err)
		}
	}

	var purchaseID uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, `SELECT id FROM purchases WHERE tenant_id = $1`, tenant.ID).Scan(&purchaseID); err != nil {
		t.Fatalf("read purchase: %v", err)
	}
	var deliveries, endpointDeliveries int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE endpoint_id = $2) FROM webhook_deliveries WHERE tenant_id = $1`, tenant.ID, subscribed).Scan(&deliveries, &endpointDeliveries); err != nil {
		t.Fatalf("count webhook deliveries: %v", err)
	}
	if deliveries != 1 || endpointDeliveries != 1 {
		t.Fatalf("webhook deliveries = %d (%d to the subscribed endpoint), want the one to the endpoint that subscribed", deliveries, endpointDeliveries)
	}

	queries := dbmodels.New(pg.DB)
	var event dbmodels.OutboxEvent
	if err := pg.DB.QueryRowContext(ctx, `SELECT id FROM outbox_events WHERE event_type = $1`, outbox.EventTypeWebhookDelivery).Scan(&event.ID); err != nil {
		t.Fatalf("read the webhook delivery event: %v", err)
	}
	if event, err = queries.GetOutboxEvent(ctx, event.ID); err != nil {
		t.Fatalf("GetOutboxEvent: %v", err)
	}
	handler := outbox.NewWebhookDeliveryHandler(outbox.WebhookDeliveryHandlerConfig{
		DB:        pg.DB,
		Encryptor: encryptor,
		Client:    receiver.Client(),
	})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("deliver the webhook: %v", err)
	}

	select {
	case delivery := <-got:
		if delivery.event != tenantwebhooks.EventPurchaseCompleted {
			t.Fatalf("X-Publira-Event = %q, want %q", delivery.event, tenantwebhooks.EventPurchaseCompleted)
		}
		if err := tenantwebhooks.Verify(secret, delivery.signature, delivery.body, time.Now(), 5*time.Minute); err != nil {
			t.Fatalf("the documented check refused the delivery: %v", err)
		}
		var body struct {
			ID       string                  `json:"id"`
			Type     string                  `json:"type"`
			TenantID string                  `json:"tenant_id"`
			Data     tenantwebhooks.Purchase `json:"data"`
		}
		if err := json.Unmarshal(delivery.body, &body); err != nil {
			t.Fatalf("decode the delivery: %v", err)
		}
		want := tenantwebhooks.Purchase{
			PurchaseID:      purchaseID.String(),
			Kind:            "purchase",
			Item:            "episode",
			SeriesPublicID:  "HOOKSERIES01",
			EpisodePublicID: "HOOKEPISODE1",
			ReaderPublicID:  "PAYHOOKUSER",
			ReaderEmail:     "hook@example.com",
			Price:           500,
			ListPrice:       500,
			Currency:        body.Data.Currency,
			PurchasedAt:     body.Data.PurchasedAt,
			Provider:        "stripe",
			Test:            body.Data.Test,
		}
		if body.Type != tenantwebhooks.EventPurchaseCompleted || body.TenantID != "PAYHOOK" || body.ID == "" || body.Data != want {
			t.Fatalf("delivery body = %+v, want a purchase.completed of the tenant carrying %+v", body, want)
		}
	case <-ctx.Done():
		t.Fatal("the endpoint received nothing")
	}

	var status string
	var attempts int
	if err := pg.DB.QueryRowContext(ctx, `SELECT status, attempts FROM webhook_deliveries WHERE endpoint_id = $1`, subscribed).Scan(&status, &attempts); err != nil {
		t.Fatalf("read the delivery: %v", err)
	}
	if status != tenantwebhooks.StatusDelivered || attempts != 1 {
		t.Fatalf("delivery = %s after %d attempts, want delivered after 1", status, attempts)
	}
}

// Each refund recorded on a purchase is an event of its own, and a
// notification of the same refund delivered again is not another.
func TestDBEachRefundOfAPurchaseOwesItsWebhookEndpointOneEvent(t *testing.T) {
	t.Parallel()

	env := newUnpaidRefundWebhookEnv(t, "REFUNDHOOK", "refund-hook.example.com")
	if _, err := env.pg.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', ARRAY['purchase.refunded'])
	`, uuid.Must(uuid.NewV7()), env.tenant.ID); err != nil {
		t.Fatalf("insert webhook endpoint: %v", err)
	}
	env.deliverCheckout(t, "pi_refund_hook")
	for range 2 {
		env.deliver(t, "charge.refunded", refundedCharge("pi_refund_hook", 500, 200))
	}
	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_hook", 500, 500))

	rows, err := env.pg.DB.QueryContext(context.Background(), `
		SELECT event_type, (payload->'data'->>'refunded_amount')::integer, payload->'data' ? 'refunded_at'
		FROM webhook_deliveries
		WHERE tenant_id = $1
		ORDER BY created_at, id
	`, env.tenant.ID)
	if err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []string
	for rows.Next() {
		var (
			eventType string
			refunded  int
			full      bool
		)
		if err := rows.Scan(&eventType, &refunded, &full); err != nil {
			t.Fatalf("scan webhook delivery: %v", err)
		}
		got = append(got, fmt.Sprintf("%s:%d:%t", eventType, refunded, full))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read webhook deliveries: %v", err)
	}
	want := []string{"purchase.refunded:200:false", "purchase.refunded:500:true"}
	if !slices.Equal(got, want) {
		t.Fatalf("webhook deliveries = %v, want %v", got, want)
	}
}
