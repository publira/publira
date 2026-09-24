package publicapi

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/providers/providerstest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBEveryRegisteredPaymentProviderPassesTheContract(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newPublicTestEncryptor(t)
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), slog.Default(), readerGuards{}, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	harness := &contractHarness{
		pg:        pg,
		encryptor: encryptor,
		client:    publirav1connect.NewPurchaseServiceClient(ts.Client(), ts.URL),
	}
	for _, provider := range providers.Registry().Providers() {
		id := provider.Declaration().ID
		t.Run(id, func(t *testing.T) {
			fixture, ok := providerstest.Fixture(id)
			if !ok {
				t.Fatalf("provider %q has no contract fixture in providerstest", id)
			}
			paymentprovidertest.Run(t, harness, provider, fixture)
		})
	}
}

// contractHarness delivers notifications to the public API over a real
// database, one fresh tenant per scenario.
type contractHarness struct {
	pg        *testutil.PostgresEnv
	encryptor paymentsettings.SecretManager
	client    publirav1connect.PurchaseServiceClient
	tenants   int
}

func (h *contractHarness) NewTenant(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials) paymentprovidertest.Tenant {
	t.Helper()
	h.tenants++
	n := h.tenants
	tenant := h.pg.SeedTenant(t, fmt.Sprintf("CONTRACT%02d", n), fmt.Sprintf("contract-%d.example.com", n), "Contract tenant")
	reader := h.pg.SeedEndUser(t, tenant.ID, fmt.Sprintf("CONTRACTUS%02d", n), fmt.Sprintf("contract-%d@example.com", n), "Contract reader")
	series := h.pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: fmt.Sprintf("CONTRACTSR%02d", n), Published: true})
	episode := h.pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    fmt.Sprintf("CONTRACTEP%02d", n),
		Price:       500,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	// The settings hold a secret key and a webhook secret until they store
	// each provider's own fields.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := paymentsettings.New(dbmodels.New(h.pg.DB), h.encryptor, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider:                provider.Declaration().ID,
		Enabled:                 true,
		SecretKey:               credentials[stripe.FieldSecretKey],
		SecretKeyUpdateMode:     secretupdate.Replace,
		WebhookSecret:           credentials[stripe.FieldWebhookSecret],
		WebhookSecretUpdateMode: secretupdate.Replace,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("upsert payment settings: %v", err)
	}

	return &contractTenant{
		harness:  h,
		provider: provider.Declaration().ID,
		purchase: paymentprovider.Purchase{
			TenantID:  tenant.ID,
			ReaderID:  reader.ID,
			EpisodeID: episode.ID,
			Price:     500,
		},
	}
}

type contractTenant struct {
	harness  *contractHarness
	provider string
	purchase paymentprovider.Purchase
}

func (c *contractTenant) Purchase() paymentprovider.Purchase {
	return c.purchase
}

func (c *contractTenant) Deliver(t *testing.T, payload []byte, headers http.Header) error {
	t.Helper()
	_, err := c.harness.client.ProcessPaymentWebhook(context.Background(), paymentWebhookRequest(c.purchase.TenantID.String(), c.provider, payload, headers))
	return err
}

func (c *contractTenant) Purchases(t *testing.T) int {
	t.Helper()
	var count int
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM purchases WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&count); err != nil {
		t.Fatalf("count purchases: %v", err)
	}
	return count
}

func (c *contractTenant) RefundedAmount(t *testing.T) int32 {
	t.Helper()
	var amount sql.NullInt32
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT refunded_amount FROM purchases WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&amount); err != nil {
		t.Fatalf("read refunded amount: %v", err)
	}
	return amount.Int32
}

func (c *contractTenant) HeldRefunds(t *testing.T) int {
	t.Helper()
	var count int
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM unapplied_stripe_refunds WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&count); err != nil {
		t.Fatalf("count held refunds: %v", err)
	}
	return count
}
