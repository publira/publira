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

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBProcessStripeWebhookIsolatesTenantSigningSecrets(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", testEnvSecretKey)
	t.Setenv("STRIPE_WEBHOOK_SECRET", testEnvWebhookSecret)

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
	t.Setenv("STRIPE_SECRET_KEY", testEnvSecretKey)
	t.Setenv("PUBLIRA_WEB_HOST_URL", "https://host.example")

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
