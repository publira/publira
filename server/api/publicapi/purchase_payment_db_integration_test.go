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
	"github.com/stripe/stripe-go/v86"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBProcessStripeWebhookIsolatesTenantSigningSecrets(t *testing.T) {
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
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert tenant A: %v", err)
	}
	if _, err := store.Upsert(ctx, tenantB.ID, paymentsettings.UpdateInput{
		Enabled:                 true,
		SecretKey:               "sk_test_51TenantBLeakXXXX",
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testOtherWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert tenant B: %v", err)
	}

	var logs bytes.Buffer
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), &testStorageProvider{}, encryptor, nil, testutil.TokenManager(), slog.New(slog.NewTextHandler(&logs, nil)))
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)

	payload, headerA := signedStripeEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_a"})
	if _, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: headerA,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantA.ID.String()},
	})); err != nil {
		t.Fatalf("tenant A with own secret: %v", err)
	}

	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: headerA,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantB.ID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("tenant B with tenant A secret code = %v, want invalid_argument", connect.CodeOf(err))
	}

	_, err = client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: headerA,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantC.ID.String()},
	}))
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
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert disabled settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	ts := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, encryptor, nil, testutil.TokenManager()))
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

func TestDBProcessStripeWebhookProjectsPurchaseEventIdempotently(t *testing.T) {
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
		SecretKeyUpdateMode:     paymentsettings.SecretUpdateModeReplace,
		WebhookSecret:           testCheckoutWebhookSecret,
		WebhookSecretUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), &testStorageProvider{}, encryptor, nil, testutil.TokenManager(), slog.Default())
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	client := publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL)

	payload, signature := signedStripeEvent(t, testCheckoutWebhookSecret, string(stripe.EventTypeCheckoutSessionCompleted), map[string]any{
		"id":             "cs_purchase_projection",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"metadata": map[string]string{
			stripeMetadataTenantID:  tenant.ID.String(),
			stripeMetadataUserID:    user.ID.String(),
			stripeMetadataEpisodeID: episode.ID.String(),
			stripeMetadataPrice:     "500",
		},
	})
	req := func() *connect.Request[publirav1.ProcessStripeWebhookRequest] {
		return connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
			Payload:         payload,
			StripeSignature: signature,
			Tenant:          &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		})
	}
	if _, err := client.ProcessStripeWebhook(context.Background(), req()); err != nil {
		t.Fatalf("first ProcessStripeWebhook: %v", err)
	}
	if _, err := client.ProcessStripeWebhook(context.Background(), req()); err != nil {
		t.Fatalf("retry ProcessStripeWebhook: %v", err)
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
