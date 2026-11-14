package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentprovider/providers/providerstest"
	"github.com/publira/publira/server/internal/paymentsettings"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBEveryRegisteredPaymentProviderPassesTheContract(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	encryptor := newPublicTestEncryptor(t)
	db := pg.OpenPublicDB(t)
	server := newAPIServer(db, dbmodels.New(db), encryptor, testutil.TokenManager(), nil, slog.Default(), readerGuards{}, nil, nil)
	ts := httptest.NewServer(handlerFromServer(server))
	t.Cleanup(ts.Close)

	harness := &contractHarness{
		pg:        pg,
		encryptor: encryptor,
		client:    publirav1connect.NewPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL))),
	}
	for _, provider := range providers.Registry().Providers() {
		id := provider.Declaration().ID
		t.Run(id, func(t *testing.T) {
			fixture, ok := providerstest.Fixture(t, id)
			if !ok {
				t.Fatalf("provider %q has no contract fixture in providerstest", id)
			}
			// The server has to read the fixture's fake of the provider's API.
			server.paymentProviders = paymentprovider.NewRegistry(fixture.Provider())
			harness.registry = server.paymentProviders
			paymentprovidertest.Run(t, harness, fixture)
		})
	}
	// No registered provider carries nothing on its payments, signs nothing,
	// and notifies no refund yet, nor names its payments by their checkouts,
	// so the fakes of one hold the purchase flow to those shapes.
	for id, newFixture := range map[string]func(testing.TB) *readbacktest.Fixture{
		readbacktest.ID:           readbacktest.NewFixture,
		readbacktest.IDByCheckout: readbacktest.NewFixtureByCheckout,
	} {
		t.Run(id, func(t *testing.T) {
			fixture := newFixture(t)
			server.paymentProviders = paymentprovider.NewRegistry(fixture.Provider())
			harness.registry = server.paymentProviders
			paymentprovidertest.Run(t, harness, fixture)
		})
	}
}

// contractHarness delivers notifications to the public API over a real
// database, one fresh tenant per scenario.
type contractHarness struct {
	pg        *testutil.PostgresEnv
	encryptor paymentsettings.SecretManager
	client    publirav1connect.PurchaseServiceClient
	// registry holds the provider of the run, whose settings each tenant
	// saves.
	registry *paymentprovider.Registry
	tenants  int
}

func (h *contractHarness) NewTenant(t *testing.T, provider paymentprovider.Provider, credentials paymentprovider.Credentials, currency string) paymentprovidertest.Tenant {
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

	var fields []paymentsettings.FieldUpdate
	for _, field := range provider.Declaration().Fields {
		if value, ok := credentials[field.Name]; ok {
			fields = append(fields, paymentsettings.FieldUpdate{Name: field.Name, Mode: secretupdate.Replace, Value: value})
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store := paymentsettings.New(dbmodels.New(h.pg.DB), h.encryptor, h.registry, nil, slog.Default())
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: provider.Declaration().ID,
		Enabled:  true,
		Currency: currency,
		Fields:   fields,
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
			Currency:  currency,
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

func (c *contractTenant) RecordCheckout(t *testing.T, checkoutID string, purchase paymentprovider.Purchase) {
	t.Helper()
	encoded, err := json.Marshal(purchase)
	if err != nil {
		t.Fatalf("encode the purchase of a checkout: %v", err)
	}
	if err := dbmodels.New(c.harness.pg.DB).RecordPaymentCheckout(context.Background(), dbmodels.RecordPaymentCheckoutParams{
		TenantID:   purchase.TenantID,
		Provider:   c.provider,
		CheckoutID: checkoutID,
		Purchase:   encoded,
	}); err != nil {
		t.Fatalf("RecordPaymentCheckout: %v", err)
	}
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

func (c *contractTenant) TestPurchases(t *testing.T) int {
	t.Helper()
	var count int
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM purchases WHERE tenant_id = $1 AND is_test`, c.purchase.TenantID,
	).Scan(&count); err != nil {
		t.Fatalf("count test purchases: %v", err)
	}
	return count
}

func (c *contractTenant) OpensEpisode(t *testing.T) bool {
	t.Helper()
	opens, err := dbmodels.New(c.harness.pg.DB).UserHasEpisodeContentAccess(context.Background(), dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  c.purchase.TenantID,
		UserID:    c.purchase.ReaderID,
		EpisodeID: c.purchase.EpisodeID,
	})
	if err != nil {
		t.Fatalf("UserHasEpisodeContentAccess: %v", err)
	}
	return opens
}

func (c *contractTenant) SalesGross(t *testing.T) int64 {
	t.Helper()
	return c.salesTotals(t).TotalGross
}

func (c *contractTenant) SalesRefunded(t *testing.T) int64 {
	t.Helper()
	return c.salesTotals(t).TotalRefunded
}

func (c *contractTenant) salesTotals(t *testing.T) dbmodels.GetRoyaltySalesTotalsForPeriodRow {
	t.Helper()
	now := time.Now().UTC()
	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	totals, err := dbmodels.New(c.harness.pg.DB).GetRoyaltySalesTotalsForPeriod(context.Background(), dbmodels.GetRoyaltySalesTotalsForPeriodParams{
		TenantID: c.purchase.TenantID,
		Currency: c.purchase.Currency,
		StartsAt: month,
		EndsAt:   month.AddDate(0, 1, 0),
	})
	if err != nil {
		t.Fatalf("GetRoyaltySalesTotalsForPeriod: %v", err)
	}
	return totals
}

func (c *contractTenant) DiscountedPurchase(t *testing.T) paymentprovider.Purchase {
	t.Helper()
	codeID := uuid.Must(uuid.NewV7())
	if _, err := c.harness.pg.DB.ExecContext(context.Background(),
		`INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id)
		VALUES ($1, $2, 'CONTRACT20', 'percent', 20, 'episode', $3)`,
		codeID, c.purchase.TenantID, c.purchase.EpisodeID,
	); err != nil {
		t.Fatalf("create a promotion code: %v", err)
	}
	purchase := c.purchase
	purchase.Price = 400
	purchase.ListPrice = 500
	purchase.PromotionCodeID = codeID
	return purchase
}

func (c *contractTenant) Redemptions(t *testing.T) int {
	t.Helper()
	var count int
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM promotion_code_redemptions WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&count); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	return count
}

func (c *contractTenant) ListPrice(t *testing.T) int32 {
	t.Helper()
	var price sql.NullInt32
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT list_price FROM purchases WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&price); err != nil {
		t.Fatalf("read list price: %v", err)
	}
	return price.Int32
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

func (c *contractTenant) RevokeAsStaff(t *testing.T) {
	t.Helper()
	if _, err := dbmodels.New(c.harness.pg.DB).RevokePurchaseForStaff(context.Background(), dbmodels.RevokePurchaseForStaffParams{
		TenantID: c.purchase.TenantID,
		ID:       c.purchaseID(t),
	}); err != nil {
		t.Fatalf("revoke the purchase as staff: %v", err)
	}
}

// purchaseID answers the id of the tenant's only purchase.
func (c *contractTenant) purchaseID(t *testing.T) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT id FROM purchases WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&id); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	return id
}

func (c *contractTenant) HeldRefunds(t *testing.T) int {
	t.Helper()
	var count int
	if err := c.harness.pg.DB.QueryRowContext(context.Background(),
		`SELECT count(*) FROM unapplied_refunds WHERE tenant_id = $1`, c.purchase.TenantID,
	).Scan(&count); err != nil {
		t.Fatalf("count held refunds: %v", err)
	}
	return count
}
