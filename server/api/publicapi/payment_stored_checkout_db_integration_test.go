package publicapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

// storedCheckoutEnv is a tenant that sells one episode through the fake of a
// provider that carries nothing on its payments.
type storedCheckoutEnv struct {
	pg          *testutil.PostgresEnv
	tenant      testutil.Tenant
	reader      testutil.TenantUser
	episode     testutil.Episode
	fixture     *readbacktest.Fixture
	registry    *paymentprovider.Registry
	encryptor   paymentsettings.SecretManager
	purchases   publirav1connect.PurchaseServiceClient
	token       string
	credentials paymentprovider.Credentials
}

func newStoredCheckoutEnv(t *testing.T) storedCheckoutEnv {
	t.Helper()
	return newStoredCheckoutEnvOf(t, readbacktest.NewFixture)
}

// newStoredCheckoutEnvOf answers the tenant of newStoredCheckoutEnv selling
// through the fake newFixture answers.
func newStoredCheckoutEnvOf(t *testing.T, newFixture func(testing.TB) *readbacktest.Fixture) storedCheckoutEnv {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	encryptor := newPublicTestEncryptor(t)
	tenant := pg.SeedTenant(t, "STORED", "stored-checkout.example.com", "Stored checkout tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "STOREDBUYR01", "stored-buyer@example.com", "Stored buyer")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	fixture := newFixture(t)
	registry := paymentprovider.NewRegistry(fixture.Provider())
	credentials := fixture.Credentials()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: fixture.Provider().Declaration().ID,
		Enabled:  true,
		Fields:   []paymentsettings.FieldUpdate{{Name: readbacktest.FieldAPIKey, Mode: secretupdate.Replace, Value: credentials[readbacktest.FieldAPIKey]}},
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	server.paymentProviders = registry
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)
	return storedCheckoutEnv{
		pg:          pg,
		tenant:      tenant,
		reader:      reader,
		episode:     episode,
		fixture:     fixture,
		registry:    registry,
		encryptor:   encryptor,
		purchases:   publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL))),
		token:       tokenFor(t, tenant, reader),
		credentials: credentials,
	}
}

// start starts the reader's checkout of the episode and answers the id the
// provider was given for it.
func (e storedCheckoutEnv) start(t *testing.T) string {
	t.Helper()
	if _, err := e.purchases.StartEpisodeCheckout(testutil.WithBearer(t.Context(), e.token), &publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: e.episode.ID.String(),
		Tenant:    tenantContext(e.tenant),
	}); err != nil {
		t.Fatalf("StartEpisodeCheckout: %v", err)
	}
	started := e.fixture.API().Started()
	return started[len(started)-1].CheckoutID
}

func (e storedCheckoutEnv) deliver(t *testing.T, payload []byte) error {
	t.Helper()
	_, err := e.purchases.ProcessPaymentWebhook(t.Context(), paymentWebhookRequest(e.tenant.ID.String(), e.fixture.Provider().Declaration().ID, payload, http.Header{}))
	return err
}

func (e storedCheckoutEnv) count(t *testing.T, query string) int {
	t.Helper()
	var n int
	if err := e.pg.DB.QueryRowContext(t.Context(), query, e.tenant.ID).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// A provider that carries nothing on its payments is handed the id its
// purchase was written down under, and its notification of the payment opens
// the episode the checkout sold.
func TestDBAStoredCheckoutIsFoundAgainByItsNotification(t *testing.T) {
	t.Parallel()

	env := newStoredCheckoutEnv(t)
	checkoutID := env.start(t)
	if checkoutID == "" {
		t.Fatal("the provider was given no checkout id")
	}
	if again := env.start(t); again != checkoutID {
		t.Fatalf("a retried checkout was started as %q, want %q", again, checkoutID)
	}
	if got := env.count(t, "SELECT count(*) FROM payment_checkouts WHERE tenant_id = $1"); got != 1 {
		t.Fatalf("stored checkouts = %d, want 1", got)
	}
	// The retry may be what makes the provider's checkout, so it is the
	// latest start that bounds when the checkout can be paid.
	if got := env.count(t, "SELECT count(*) FROM payment_checkouts WHERE tenant_id = $1 AND last_started_at > created_at"); got != 1 {
		t.Fatalf("stored checkouts started again since = %d, want 1", got)
	}

	payload := env.fixture.API().Pay(env.credentials, checkoutID, "payment_stored", 500, "JPY", false, time.Now())
	for delivery := range 2 {
		if err := env.deliver(t, payload); err != nil {
			t.Fatalf("delivery %d: %v", delivery+1, err)
		}
	}
	var (
		episodeID, readerID string
		price               int32
		storedCheckoutID    string
	)
	if err := env.pg.DB.QueryRowContext(t.Context(),
		`SELECT episode_id::text, user_id::text, price_at_purchase, provider_checkout_id FROM purchases WHERE tenant_id = $1`, env.tenant.ID,
	).Scan(&episodeID, &readerID, &price, &storedCheckoutID); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if episodeID != env.episode.ID.String() || readerID != env.reader.ID.String() || price != 500 || storedCheckoutID != checkoutID {
		t.Fatalf("purchase = (%s, %s, %d, %s), want (%s, %s, 500, %s)", episodeID, readerID, price, storedCheckoutID, env.episode.ID, env.reader.ID, checkoutID)
	}
}

func TestDBAStoredCheckoutPaidAnotherAmountCreatesNothing(t *testing.T) {
	t.Parallel()

	env := newStoredCheckoutEnv(t)
	checkoutID := env.start(t)
	payload := env.fixture.API().Pay(env.credentials, checkoutID, "payment_short", 400, "JPY", false, time.Now())
	if err := env.deliver(t, payload); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("delivery error = %v, want InvalidArgument", err)
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1"); got != 0 {
		t.Fatalf("purchases = %d, want 0", got)
	}
}

func TestDBANotificationOfACheckoutTheTenantDidNotStartCreatesNothing(t *testing.T) {
	t.Parallel()

	env := newStoredCheckoutEnv(t)
	payload := env.fixture.API().Pay(env.credentials, paymentprovider.StoredCheckoutID("never started"), "payment_unknown", 500, "JPY", false, time.Now())
	if err := env.deliver(t, payload); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("delivery error = %v, want InvalidArgument", err)
	}
	if got := env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1"); got != 0 {
		t.Fatalf("purchases = %d, want 0", got)
	}
}

// An expiry of a stored checkout moves the reader's next checkout onto a new
// one, as the expiry of a checkout another provider carried does.
func TestDBAStoredCheckoutThatExpiredIsStartedAfresh(t *testing.T) {
	t.Parallel()

	env := newStoredCheckoutEnv(t)
	first := env.start(t)
	if err := env.deliver(t, env.fixture.API().Expire(env.credentials, first, "JPY")); err != nil {
		t.Fatalf("expiry: %v", err)
	}
	if got := env.count(t, "SELECT count(*) FROM expired_checkouts WHERE tenant_id = $1"); got != 1 {
		t.Fatalf("expired checkouts = %d, want 1", got)
	}
	if second := env.start(t); second == first {
		t.Fatal("the checkout after an expiry was started under the expired one's id")
	}
}

// A refund asked of a provider that notifies none is read back by the
// follow-up the worker runs, and waits while the provider has not settled it,
// whether the provider names the payment by an id of its own or by its
// checkout's.
func TestDBARefundFollowUpRecordsWhatTheProviderSettled(t *testing.T) {
	t.Parallel()

	for id, newFixture := range map[string]func(testing.TB) *readbacktest.Fixture{
		readbacktest.ID:           readbacktest.NewFixture,
		readbacktest.IDByCheckout: readbacktest.NewFixtureByCheckout,
	} {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			testRefundFollowUpRecordsWhatTheProviderSettled(t, newStoredCheckoutEnvOf(t, newFixture))
		})
	}
}

func testRefundFollowUpRecordsWhatTheProviderSettled(t *testing.T, env storedCheckoutEnv) {
	t.Helper()
	checkoutID := env.start(t)
	if err := env.deliver(t, env.fixture.API().Pay(env.credentials, checkoutID, "payment_followed", 500, "JPY", false, time.Now())); err != nil {
		t.Fatalf("checkout: %v", err)
	}
	// The payment as the purchase recorded it, which is the id the provider
	// reports.
	paymentID := env.fixture.API().PaymentID(checkoutID, "payment_followed")
	var recorded string
	if err := env.pg.DB.QueryRowContext(t.Context(),
		`SELECT provider_payment_id FROM purchases WHERE tenant_id = $1`, env.tenant.ID,
	).Scan(&recorded); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	if recorded != paymentID {
		t.Fatalf("the purchase records the payment %q, want %q", recorded, paymentID)
	}
	env.fixture.API().HoldNextRefund(env.credentials, paymentID)
	if _, err := env.fixture.Provider().Refund(t.Context(), env.credentials, paymentprovider.RefundRequest{PaymentID: paymentID, IdempotencyKey: "refund_followed"}); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	if err := outbox.QueuePaymentRefundFollow(t.Context(), dbmodels.New(env.pg.DB), env.tenant.ID, env.fixture.Provider().Declaration().ID, paymentID); err != nil {
		t.Fatalf("QueuePaymentRefundFollow: %v", err)
	}
	var eventID uuid.UUID
	if err := env.pg.DB.QueryRowContext(t.Context(),
		`SELECT id FROM outbox_events WHERE tenant_id = $1 AND event_type = $2`, env.tenant.ID, outbox.EventTypePaymentRefundFollow,
	).Scan(&eventID); err != nil {
		t.Fatalf("find the follow-up: %v", err)
	}
	event, err := dbmodels.New(env.pg.DB).GetOutboxEvent(t.Context(), eventID)
	if err != nil {
		t.Fatalf("read the follow-up: %v", err)
	}
	handle := NewPaymentRefundFollowHandler(PaymentRefundFollowConfig{
		DB:        env.pg.OpenOutboxDB(t),
		Encryptor: env.encryptor,
		Providers: env.registry,
		Logger:    slog.Default(),
	})
	refunded := func() int {
		return env.count(t, "SELECT count(*) FROM purchases WHERE tenant_id = $1 AND refunded_at IS NOT NULL")
	}

	if err := handle(t.Context(), event); !outbox.IsBlocked(err) {
		t.Fatalf("follow-up of a pending refund = %v, want it blocked", err)
	}
	if got := refunded(); got != 0 {
		t.Fatalf("refunded purchases while the refund is pending = %d, want 0", got)
	}
	env.fixture.API().SettleRefunds(env.credentials, paymentID, false)
	if err := handle(t.Context(), event); err != nil {
		t.Fatalf("follow-up of a settled refund: %v", err)
	}
	if got := refunded(); got != 1 {
		t.Fatalf("refunded purchases = %d, want 1", got)
	}
}
