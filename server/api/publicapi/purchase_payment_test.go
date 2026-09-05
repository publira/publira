package publicapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	getEnabledTenantPaymentConfigByTenantIDQuery  = "-- name: GetEnabledTenantPaymentConfigByTenantID :one\n"
	getPurchasableEpisodeByPublicIDForTenantQuery = "-- name: GetPurchasableEpisodeByPublicIDForTenant :one\n"
	userHasValidPurchaseForEpisodeQuery           = "-- name: UserHasValidPurchaseForEpisode :one\n"

	testCheckoutSecretKey     = "sk_test_51TenantALeakXXXX"
	testCheckoutWebhookSecret = "whsec_TenantALeakYYYY"
	testOtherWebhookSecret    = "whsec_TenantBLeakZZZZ"
)

type capturingCheckoutProvider struct {
	secretKey string
	input     stripeCheckoutInput
	url       string
}

func (p *capturingCheckoutProvider) create(_ context.Context, input stripeCheckoutInput) (string, error) {
	p.input = input
	return p.url, nil
}

func newPublicTestEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{5}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func publicPaymentColumns() []string {
	return []string{
		"tenant_id", "provider", "enabled",
		"secret_key_encrypted", "webhook_secret_encrypted",
		"secret_key_hint", "webhook_secret_hint",
		"created_at", "updated_at",
	}
}

type publicPaymentServer struct {
	ts       *httptest.Server
	mock     sqlmock.Sqlmock
	logs     *bytes.Buffer
	checkout *capturingCheckoutProvider
}

func newPublicPaymentServer(t *testing.T, encryptor *secretcrypto.Manager) publicPaymentServer {
	t.Helper()
	if encryptor == nil {
		encryptor = newPublicTestEncryptor(t)
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	var logs bytes.Buffer
	checkout := &capturingCheckoutProvider{url: "https://checkout.stripe.test/cs_test"}
	server := newAPIServer(db, dbmodels.New(db), &testStorageProvider{}, encryptor, nil, testutil.TokenManager(), slog.New(slog.NewTextHandler(&logs, nil)))
	server.newStripeProvider = func(secretKey string) stripeSessionCreator {
		checkout.secretKey = secretKey
		return checkout
	}
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	return publicPaymentServer{ts: ts, mock: mock, logs: &logs, checkout: checkout}
}

func expectEnabledPaymentConfig(t *testing.T, mock sqlmock.Sqlmock, tenantID uuid.UUID, encryptor *secretcrypto.Manager, secretKey, webhookSecret string, now time.Time) {
	t.Helper()
	secretEnc, err := encryptor.EncryptString(secretKey)
	if err != nil {
		t.Fatalf("EncryptString secret: %v", err)
	}
	webhookEnc, err := encryptor.EncryptString(webhookSecret)
	if err != nil {
		t.Fatalf("EncryptString webhook: %v", err)
	}
	mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicPaymentColumns()).AddRow(
			tenantID,
			paymentsettings.ProviderStripe,
			true,
			sql.NullString{String: secretEnc, Valid: true},
			sql.NullString{String: webhookEnc, Valid: true},
			sql.NullString{String: paymentsettings.MaskSecret(secretKey), Valid: true},
			sql.NullString{String: paymentsettings.MaskSecret(webhookSecret), Valid: true},
			now,
			now,
		))
}

func TestStartEpisodeCheckoutRefusesWhenTenantSettingsMissing(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectAuthSession(env.mock, tenantID, userID, now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodePublicId: "EPISODE001",
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if env.checkout.secretKey != "" {
		t.Fatalf("checkout used secret %q, want none", env.checkout.secretKey)
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestStartEpisodeCheckoutRefusesWhenTenantDomainMissing(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	env.mock.ExpectQuery(regexp.QuoteMeta(getTenantByIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT", "", "Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))
	expectAuthSession(env.mock, tenantID, userID, now)

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodePublicId: "EPISODE001",
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if env.checkout.secretKey != "" {
		t.Fatalf("checkout used secret %q, want none", env.checkout.secretKey)
	}
	assertPublicExpectations(t, env.mock)
}

func TestStartEpisodeCheckoutUsesTenantSecret(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectAuthSession(env.mock, tenantID, userID, now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getPurchasableEpisodeByPublicIDForTenantQuery)).
		WithArgs("EPISODE001", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "series_public_id", "price", "reading_period_hours"}).
			AddRow(episodeID, "EPISODE001", "Paid episode", "SERIES001", int32(500), sql.NullInt32{}))
	env.mock.ExpectQuery(regexp.QuoteMeta(userHasValidPurchaseForEpisodeQuery)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"has_purchase"}).AddRow(false))

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	resp, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodePublicId: "EPISODE001",
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	if resp.Msg.CheckoutUrl != "https://checkout.stripe.test/cs_test" {
		t.Fatalf("checkout_url = %q", resp.Msg.CheckoutUrl)
	}
	if env.checkout.secretKey != testCheckoutSecretKey {
		t.Fatalf("checkout secret = %q, want tenant secret", env.checkout.secretKey)
	}
	if !strings.HasPrefix(env.checkout.input.successURL, "https://tenant.example/series/SERIES001/episodes/EPISODE001") {
		t.Fatalf("successURL = %q, want tenant domain return URL", env.checkout.input.successURL)
	}
	if !strings.Contains(env.checkout.input.successURL, "checkout=success") {
		t.Fatalf("successURL = %q, want checkout=success", env.checkout.input.successURL)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessStripeWebhookRefusesWhenTenantSettingsMissing(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	payload, header := signedStripeEvent(t, testOtherWebhookSecret, "ping", map[string]any{"object": "checkout.session"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: header,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ProcessStripeWebhook code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessStripeWebhookRejectsOtherTenantSigningSecret(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := signedStripeEvent(t, testOtherWebhookSecret, "ping", map[string]any{"id": "cs_other"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: header,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ProcessStripeWebhook code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if strings.Contains(err.Error(), testCheckoutWebhookSecret) || strings.Contains(err.Error(), testOtherWebhookSecret) {
		t.Fatalf("error leaked a webhook secret: %v", err)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessStripeWebhookAcceptsTenantSigningSecret(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := signedStripeEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_ok"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: header,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ProcessStripeWebhook: %v", err)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessStripeWebhookDecryptFailureDoesNotFulfillPurchase(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(getEnabledTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicPaymentColumns()).AddRow(
			tenantID,
			paymentsettings.ProviderStripe,
			true,
			sql.NullString{String: "enc:v1:other:dGVzdA:dGVzdA", Valid: true},
			sql.NullString{String: "enc:v1:other:dGVzdA:dGVzdA", Valid: true},
			sql.NullString{String: "sk_test_••••••••XXXX", Valid: true},
			sql.NullString{String: "whsec_••••••••YYYY", Valid: true},
			now,
			now,
		))

	payload, header := signedStripeEvent(t, testCheckoutWebhookSecret, string(stripe.EventTypeCheckoutSessionCompleted), map[string]any{
		"id":             "cs_decrypt",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
	})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: header,
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ProcessStripeWebhook code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessStripeWebhookRejectsCheckoutTenantMismatch(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	pathTenantID := uuid.Must(uuid.NewV7())
	metadataTenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, pathTenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, pathTenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := signedStripeEvent(t, testCheckoutWebhookSecret, string(stripe.EventTypeCheckoutSessionCompleted), map[string]any{
		"id":             "cs_mismatch",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"metadata": map[string]string{
			stripeMetadataTenantID:  metadataTenantID.String(),
			stripeMetadataUserID:    uuid.Must(uuid.NewV7()).String(),
			stripeMetadataEpisodeID: uuid.Must(uuid.NewV7()).String(),
			stripeMetadataPrice:     "500",
		},
	})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessStripeWebhook(context.Background(), connect.NewRequest(&publirav1.ProcessStripeWebhookRequest{
		Payload:         payload,
		StripeSignature: header,
		Tenant:          &publirattypesv1.TenantContext{TenantId: pathTenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ProcessStripeWebhook code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func signedStripeEvent(t *testing.T, secret, eventType string, session map[string]any) ([]byte, string) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":          "evt_test",
		"object":      "event",
		"api_version": stripe.APIVersion,
		"type":        eventType,
		"data":        map[string]any{"object": session},
	})
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: secret})
	return payload, signed.Header
}

func assertNoSecretLeak(t *testing.T, haystack string) {
	t.Helper()
	for _, secret := range []string{
		testCheckoutSecretKey,
		testCheckoutWebhookSecret,
		testOtherWebhookSecret,
	} {
		if strings.Contains(haystack, secret) {
			t.Fatalf("leaked secret %q in %s", secret, haystack)
		}
	}
}
