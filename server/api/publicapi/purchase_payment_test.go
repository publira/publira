package publicapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testCheckoutSecretKey     = "sk_test_51TenantALeakXXXX"
	testCheckoutWebhookSecret = "whsec_TenantALeakYYYY"
	testOtherWebhookSecret    = "whsec_TenantBLeakZZZZ"
)

// capturingCheckoutProvider is the Stripe provider with its checkout captured
// instead of created.
type capturingCheckoutProvider struct {
	*stripe.Provider
	secretKey string
	input     paymentprovider.CheckoutRequest
	url       string
}

func (p *capturingCheckoutProvider) StartCheckout(_ context.Context, credentials paymentprovider.Credentials, input paymentprovider.CheckoutRequest) (string, error) {
	p.secretKey = credentials[stripe.FieldSecretKey]
	p.input = input
	return p.url, nil
}

func newCapturingCheckoutProvider() *capturingCheckoutProvider {
	return &capturingCheckoutProvider{Provider: stripe.New(), url: "https://checkout.stripe.test/cs_test"}
}

// paymentWebhookRequest is the request web-host makes for a provider's
// delivery.
func paymentWebhookRequest(tenantID, provider string, payload []byte, headers http.Header) *connect.Request[publirav1.ProcessPaymentWebhookRequest] {
	forwarded := make(map[string]string, len(headers))
	for name := range headers {
		forwarded[strings.ToLower(name)] = headers.Get(name)
	}
	return connect.NewRequest(&publirav1.ProcessPaymentWebhookRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID},
		Provider: provider,
		Payload:  payload,
		Headers:  forwarded,
	})
}

func stripeWebhookRequest(tenantID string, payload []byte, headers http.Header) *connect.Request[publirav1.ProcessPaymentWebhookRequest] {
	return paymentWebhookRequest(tenantID, stripe.ID, payload, headers)
}

// stripeSettings enables Stripe with the given secret key and webhook secret.
func stripeSettings(secretKey, webhookSecret string) paymentsettings.UpdateInput {
	return paymentsettings.UpdateInput{
		Provider: stripe.ID,
		Enabled:  true,
		Fields: []paymentsettings.FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: secretKey},
			{Name: stripe.FieldWebhookSecret, Mode: secretupdate.Replace, Value: webhookSecret},
		},
	}
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
		"created_at", "updated_at",
		"credentials_encrypted", "credential_hints",
	}
}

// stripePaymentConfigRow is an enabled Stripe settings row holding the given
// ciphertexts and hints for its secret key and webhook secret.
func stripePaymentConfigRow(t *testing.T, tenantID uuid.UUID, secretEnc, webhookEnc, secretHint, webhookHint string, now time.Time) *sqlmock.Rows {
	t.Helper()
	fields := func(secretKey, webhookSecret string) []byte {
		encoded, err := json.Marshal(map[string]string{
			stripe.FieldSecretKey:     secretKey,
			stripe.FieldWebhookSecret: webhookSecret,
		})
		if err != nil {
			t.Fatalf("json.Marshal: %v", err)
		}
		return encoded
	}
	return sqlmock.NewRows(publicPaymentColumns()).AddRow(
		tenantID,
		stripe.ID,
		true,
		now,
		now,
		fields(secretEnc, webhookEnc),
		fields(secretHint, webhookHint),
	)
}

type publicPaymentServer struct {
	ts       *httptest.Server
	mock     sqlmock.Sqlmock
	logs     *bytes.Buffer
	checkout *capturingCheckoutProvider
}

func newPublicPaymentServer(t *testing.T, encryptor *secretcrypto.Manager) publicPaymentServer {
	t.Helper()
	// The links asserted below are on the default origin, whatever the shell
	// running the tests exports.
	t.Setenv(tenantorigin.SchemeEnv, "")
	t.Setenv(tenantorigin.PortEnv, "")
	if encryptor == nil {
		encryptor = newPublicTestEncryptor(t)
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	var logs bytes.Buffer
	checkout := newCapturingCheckoutProvider()
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.New(slog.NewTextHandler(&logs, nil)), readerGuards{}, nil, nil)
	server.paymentProviders = paymentprovider.NewRegistry(checkout)
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(stripePaymentConfigRow(t, tenantID, secretEnc, webhookEnc,
			paymentsettings.MaskSecret(secretKey), paymentsettings.MaskSecret(webhookSecret), now))
}

func TestStartEpisodeCheckoutRefusesWhenTenantSettingsMissing(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectAuthSession(env.mock, tenantID, userID, now)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: uuid.NewString(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT", "", "Tenant", nil, now, "active", nil, "UTC", "ja"))
	expectAuthSession(env.mock, tenantID, userID, now)

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: uuid.NewString(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if env.checkout.secretKey != "" {
		t.Fatalf("checkout used secret %q, want none", env.checkout.secretKey)
	}
	assertPublicExpectations(t, env.mock)
}

// expectPurchasableEpisode stands in for the checkout's read of a paid episode
// the named surface may show, sold where purchaseAvailability says.
// expectAppPurchaseRoute stands in for the route read a checkout from the app
// makes before anything else about the purchase.
func expectAppPurchaseRoute(mock sqlmock.Sqlmock, tenantID uuid.UUID, route string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantAppPurchaseRoute)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"app_purchase_route"}).AddRow(route))
}

func expectPurchasableEpisode(mock sqlmock.Sqlmock, tenantID, episodeID uuid.UUID, surface, purchaseAvailability string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPurchasableEpisodeForTenant)).
		WithArgs(episodeID, tenantID, surface).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "series_public_id", "price", "reading_period_hours", "purchase_availability"}).
			AddRow(episodeID, "EPISODE001", "Paid episode", "SERIES001", int32(500), sql.NullInt32{}, purchaseAvailability))
}

// expectNoEpisodeGrant answers that the reader holds no grant on the episode,
// so they are not credited on it.
func expectNoEpisodeGrant(mock sqlmock.Sqlmock, tenantID, userID, episodeID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeEntitlementSource)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnError(sql.ErrNoRows)
}

func TestStartEpisodeCheckoutRefusesASurfaceThatMayNotSellTheEpisode(t *testing.T) {
	cases := []struct {
		name                 string
		client               publirav1.StartEpisodeCheckoutRequest_Client
		surface              string
		purchaseAvailability string
	}{
		{name: "an app-only episode from the storefront", client: publirav1.StartEpisodeCheckoutRequest_CLIENT_WEB, surface: "web", purchaseAvailability: "app"},
		{name: "an app-only episode from an unnamed client", client: publirav1.StartEpisodeCheckoutRequest_CLIENT_UNSPECIFIED, surface: "web", purchaseAvailability: "app"},
		{name: "a web-only episode from the app", client: publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE, surface: "app", purchaseAvailability: "web"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			encryptor := newPublicTestEncryptor(t)
			env := newPublicPaymentServer(t, encryptor)

			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			episodeID := uuid.Must(uuid.NewV7())
			expectTenantLookup(env.mock, tenantID, "TENANT", now)
			expectAuthSession(env.mock, tenantID, userID, now)
			if tc.client == publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE {
				expectAppPurchaseRoute(env.mock, tenantID, paymentsettings.RouteExternalCheckout)
			}
			expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
			expectPurchasableEpisode(env.mock, tenantID, episodeID, tc.surface, tc.purchaseAvailability)

			client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
			_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
				EpisodeId: episodeID.String(),
				Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Client:    tc.client,
			}, tenantID.String()))
			if connect.CodeOf(err) != connect.CodeFailedPrecondition {
				t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
			}
			if env.checkout.input.SuccessURL != "" {
				t.Fatalf("checkout created a Stripe session returning to %q, want none", env.checkout.input.SuccessURL)
			}
			assertPublicExpectations(t, env.mock)
		})
	}
}

func TestStartEpisodeCheckoutSellsAnAppOnlyEpisodeInTheApp(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	expectTenantLookupWithDefaultLocale(env.mock, tenantID, "TENANT", now, "en")
	expectAuthSession(env.mock, tenantID, userID, now)
	expectAppPurchaseRoute(env.mock, tenantID, paymentsettings.RouteExternalCheckout)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	expectPurchasableEpisode(env.mock, tenantID, episodeID, "app", "app")
	expectNoEpisodeGrant(env.mock, tenantID, userID, episodeID)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UserHasValidPurchaseForEpisode)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"has_purchase"}).AddRow(false))

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	resp, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episodeID.String(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Client:    publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE,
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	if resp.Msg.CheckoutUrl != "https://checkout.stripe.test/cs_test" {
		t.Fatalf("checkout_url = %q", resp.Msg.CheckoutUrl)
	}
	assertPublicExpectations(t, env.mock)
}

func TestStartEpisodeCheckoutRefusesTheAppOfATenantSellingThroughTheStore(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectAuthSession(env.mock, tenantID, userID, now)
	expectAppPurchaseRoute(env.mock, tenantID, paymentsettings.RouteStore)

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: uuid.NewString(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Client:    publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE,
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("StartEpisodeCheckout code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if env.checkout.input.SuccessURL != "" {
		t.Fatalf("checkout created a Stripe session returning to %q, want none", env.checkout.input.SuccessURL)
	}
	assertPublicExpectations(t, env.mock)
}

func TestStartEpisodeCheckoutSellsOnTheWebOfATenantWhoseAppSellsThroughTheStore(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectAuthSession(env.mock, tenantID, userID, now)
	// No route read: the route decides only what the app offers.
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	expectPurchasableEpisode(env.mock, tenantID, episodeID, "web", "all")
	expectNoEpisodeGrant(env.mock, tenantID, userID, episodeID)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UserHasValidPurchaseForEpisode)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"has_purchase"}).AddRow(false))

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	if _, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episodeID.String(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Client:    publirav1.StartEpisodeCheckoutRequest_CLIENT_WEB,
	}, tenantID.String())); err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
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
	expectPurchasableEpisode(env.mock, tenantID, episodeID, "web", "all")
	expectNoEpisodeGrant(env.mock, tenantID, userID, episodeID)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UserHasValidPurchaseForEpisode)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"has_purchase"}).AddRow(false))

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	resp, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episodeID.String(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Client:    publirav1.StartEpisodeCheckoutRequest_CLIENT_WEB,
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
	if env.checkout.input.SuccessURL != "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=success" {
		t.Fatalf("successURL = %q, want web return URL", env.checkout.input.SuccessURL)
	}
	if env.checkout.input.CancelURL != "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=cancelled" {
		t.Fatalf("cancelURL = %q, want web return URL", env.checkout.input.CancelURL)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestStartEpisodeCheckoutReturnsMobileCheckoutToApp(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	expectTenantLookupWithDefaultLocale(env.mock, tenantID, "TENANT", now, "en")
	expectAuthSession(env.mock, tenantID, userID, now)
	expectAppPurchaseRoute(env.mock, tenantID, paymentsettings.RouteExternalCheckout)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)
	expectPurchasableEpisode(env.mock, tenantID, episodeID, "app", "all")
	expectNoEpisodeGrant(env.mock, tenantID, userID, episodeID)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UserHasValidPurchaseForEpisode)).
		WithArgs(tenantID, userID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"has_purchase"}).AddRow(false))

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.StartEpisodeCheckout(context.Background(), newAuthedPublicRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: episodeID.String(),
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Client:    publirav1.StartEpisodeCheckoutRequest_CLIENT_MOBILE,
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	if env.checkout.input.SuccessURL != "https://tenant.example/en/checkout/return?episode=EPISODE001&status=success" {
		t.Fatalf("successURL = %q, want mobile success return URL", env.checkout.input.SuccessURL)
	}
	if env.checkout.input.CancelURL != "https://tenant.example/en/checkout/return?episode=EPISODE001&status=cancelled" {
		t.Fatalf("cancelURL = %q, want mobile cancellation return URL", env.checkout.input.CancelURL)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookRefusesWhenTenantSettingsMissing(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	payload, header := stripetest.SignedEvent(t, testOtherWebhookSecret, "ping", map[string]any{"object": "checkout.session"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantID.String(), payload, header))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ProcessPaymentWebhook code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookRejectsOtherTenantSigningSecret(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := stripetest.SignedEvent(t, testOtherWebhookSecret, "ping", map[string]any{"id": "cs_other"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantID.String(), payload, header))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ProcessPaymentWebhook code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if strings.Contains(err.Error(), testCheckoutWebhookSecret) || strings.Contains(err.Error(), testOtherWebhookSecret) {
		t.Fatalf("error leaked a webhook secret: %v", err)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookAcceptsTenantSigningSecret(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_ok"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantID.String(), payload, header))
	if err != nil {
		t.Fatalf("ProcessPaymentWebhook: %v", err)
	}
	assertNoSecretLeak(t, env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookAnswersNotFoundForAnUnregisteredProvider(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	tenantID := uuid.Must(uuid.NewV7())

	payload, header := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_unknown"})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), paymentWebhookRequest(tenantID.String(), "unknown", payload, header))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ProcessPaymentWebhook code = %v, want not_found", connect.CodeOf(err))
	}
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookReadsTheSignatureHeaderWhateverItsCase(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, tenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "ping", map[string]any{"id": "cs_case"})
	req := stripeWebhookRequest(tenantID.String(), payload, nil)
	req.Msg.Headers = map[string]string{"STRIPE-SIGNATURE": header.Get(stripe.SignatureHeader)}
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	if _, err := client.ProcessPaymentWebhook(context.Background(), req); err != nil {
		t.Fatalf("ProcessPaymentWebhook: %v", err)
	}
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookDecryptFailureDoesNotFulfillPurchase(t *testing.T) {
	env := newPublicPaymentServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, tenantID, "TENANT", now)
	env.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEnabledTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(stripePaymentConfigRow(t, tenantID,
			"enc:v1:other:dGVzdA:dGVzdA", "enc:v1:other:dGVzdA:dGVzdA",
			"sk_test_••••••••XXXX", "whsec_••••••••YYYY", now))

	payload, header := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":             "cs_decrypt",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
	})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(tenantID.String(), payload, header))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ProcessPaymentWebhook code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
}

func TestProcessPaymentWebhookRejectsCheckoutTenantMismatch(t *testing.T) {
	encryptor := newPublicTestEncryptor(t)
	env := newPublicPaymentServer(t, encryptor)

	now := time.Now()
	pathTenantID := uuid.Must(uuid.NewV7())
	metadataTenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(env.mock, pathTenantID, "TENANT", now)
	expectEnabledPaymentConfig(t, env.mock, pathTenantID, encryptor, testCheckoutSecretKey, testCheckoutWebhookSecret, now)

	payload, header := stripetest.SignedEvent(t, testCheckoutWebhookSecret, "checkout.session.completed", map[string]any{
		"id":             "cs_mismatch",
		"object":         "checkout.session",
		"amount_total":   500,
		"currency":       "jpy",
		"payment_status": "paid",
		"metadata": map[string]string{
			stripe.MetadataTenantID:  metadataTenantID.String(),
			stripe.MetadataUserID:    uuid.Must(uuid.NewV7()).String(),
			stripe.MetadataEpisodeID: uuid.Must(uuid.NewV7()).String(),
			stripe.MetadataPrice:     "500",
		},
	})
	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	_, err := client.ProcessPaymentWebhook(context.Background(), stripeWebhookRequest(pathTenantID.String(), payload, header))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ProcessPaymentWebhook code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertNoSecretLeak(t, err.Error()+"\n"+env.logs.String())
	assertPublicExpectations(t, env.mock)
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
