package paymentsettings

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/secretcrypto"
)

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{
		"k1": bytes.Repeat([]byte{3}, 32),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

// memoryPaymentQueries keeps a tenant's settings row and its providers apart,
// and keeps the first provider in the settings row as the database's triggers
// do.
type memoryPaymentQueries struct {
	mu       sync.Mutex
	byTenant map[uuid.UUID]dbmodels.TenantPaymentConfig
	// providers holds each tenant's providers in the order it added them.
	providers map[uuid.UUID][]dbmodels.TenantPaymentProvider
	// open holds the providers, as tenant id and provider, that still have
	// payments a refund may reach.
	open map[string]bool
	// purchased holds the tenants that have a purchase.
	purchased map[uuid.UUID]bool
	// platformCurrency is the platform's default currency.
	platformCurrency string
}

// testPlatformCurrency is the default currency of the platform the memory
// queries answer for.
const testPlatformCurrency = "JPY"

func newMemoryPaymentQueries() *memoryPaymentQueries {
	return &memoryPaymentQueries{
		byTenant:         make(map[uuid.UUID]dbmodels.TenantPaymentConfig),
		providers:        make(map[uuid.UUID][]dbmodels.TenantPaymentProvider),
		open:             make(map[string]bool),
		purchased:        make(map[uuid.UUID]bool),
		platformCurrency: testPlatformCurrency,
	}
}

func (m *memoryPaymentQueries) GetPlatformDefaultCurrency(context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.platformCurrency, nil
}

func (*memoryPaymentQueries) LockTenantCurrency(context.Context, uuid.UUID) error {
	return nil
}

func (m *memoryPaymentQueries) TenantHasPurchases(_ context.Context, tenantID uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.purchased[tenantID], nil
}

func (m *memoryPaymentQueries) GetTenantPaymentConfigByTenantID(_ context.Context, tenantID uuid.UUID) (dbmodels.TenantPaymentConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.byTenant[tenantID]
	if !ok {
		return dbmodels.TenantPaymentConfig{}, sql.ErrNoRows
	}
	return row, nil
}

func (m *memoryPaymentQueries) UpsertTenantPaymentConfig(_ context.Context, arg dbmodels.UpsertTenantPaymentConfigParams) (dbmodels.TenantPaymentConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.byTenant[arg.TenantID]
	row := dbmodels.TenantPaymentConfig{
		TenantID:             arg.TenantID,
		Provider:             arg.Provider,
		Enabled:              arg.Enabled,
		CredentialsEncrypted: arg.CredentialsEncrypted,
		CredentialHints:      arg.CredentialHints,
		Currency:             arg.Currency,
		CreatedAt:            existing.CreatedAt,
		UpdatedAt:            existing.UpdatedAt,
	}
	m.byTenant[arg.TenantID] = row
	m.replaceFirstProvider(row)
	return row, nil
}

func (m *memoryPaymentQueries) SaveTenantCurrency(_ context.Context, arg dbmodels.SaveTenantCurrencyParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.byTenant[arg.TenantID]
	if !ok {
		row = dbmodels.TenantPaymentConfig{
			TenantID:             arg.TenantID,
			Provider:             arg.Provider,
			CredentialsEncrypted: json.RawMessage(`{}`),
			CredentialHints:      json.RawMessage(`{}`),
		}
		m.byTenant[arg.TenantID] = row
		m.replaceFirstProvider(row)
	}
	row.Currency = arg.Currency
	m.byTenant[arg.TenantID] = row
	return nil
}

// replaceFirstProvider is tenant_payment_config_write_providers: row's
// provider takes the place of the first one that is not retired.
func (m *memoryPaymentQueries) replaceFirstProvider(row dbmodels.TenantPaymentConfig) {
	held := m.providers[row.TenantID]
	first := slices.IndexFunc(held, func(p dbmodels.TenantPaymentProvider) bool { return !p.RetiredAt.Valid })
	if first >= 0 && held[first].Provider != row.Provider {
		held = slices.Delete(held, first, first+1)
	}
	at := slices.IndexFunc(held, func(p dbmodels.TenantPaymentProvider) bool { return p.Provider == row.Provider })
	provider := dbmodels.TenantPaymentProvider{
		ID:                   uuid.Must(uuid.NewV7()),
		TenantID:             row.TenantID,
		Provider:             row.Provider,
		Enabled:              row.Enabled,
		CredentialsEncrypted: row.CredentialsEncrypted,
		CredentialHints:      row.CredentialHints,
	}
	switch {
	case at >= 0:
		provider.ID = held[at].ID
		held = slices.Delete(held, at, at+1)
		held = slices.Insert(held, 0, provider)
	case first >= 0:
		held = slices.Insert(held, min(first, len(held)), provider)
	default:
		held = append(held, provider)
	}
	m.providers[row.TenantID] = held
}

// writeFirstProvider is tenant_payment_providers_write_config.
func (m *memoryPaymentQueries) writeFirstProvider(tenantID uuid.UUID) {
	row, ok := m.byTenant[tenantID]
	if !ok {
		return
	}
	first := slices.IndexFunc(m.providers[tenantID], func(p dbmodels.TenantPaymentProvider) bool { return !p.RetiredAt.Valid })
	if first < 0 {
		row.Enabled = false
		row.CredentialsEncrypted = json.RawMessage(`{}`)
		row.CredentialHints = json.RawMessage(`{}`)
	} else {
		provider := m.providers[tenantID][first]
		row.Provider = provider.Provider
		row.Enabled = provider.Enabled
		row.CredentialsEncrypted = provider.CredentialsEncrypted
		row.CredentialHints = provider.CredentialHints
	}
	m.byTenant[tenantID] = row
}

func (m *memoryPaymentQueries) ListTenantPaymentProviders(_ context.Context, tenantID uuid.UUID) ([]dbmodels.TenantPaymentProvider, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.providers[tenantID]), nil
}

func (m *memoryPaymentQueries) GetTenantPaymentProvider(_ context.Context, arg dbmodels.GetTenantPaymentProviderParams) (dbmodels.TenantPaymentProvider, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, provider := range m.providers[arg.TenantID] {
		if provider.Provider == arg.Provider {
			return provider, nil
		}
	}
	return dbmodels.TenantPaymentProvider{}, sql.ErrNoRows
}

func (m *memoryPaymentQueries) UpsertTenantPaymentProvider(_ context.Context, arg dbmodels.UpsertTenantPaymentProviderParams) (dbmodels.TenantPaymentProvider, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	held := m.providers[arg.TenantID]
	row := dbmodels.TenantPaymentProvider{
		ID:                   uuid.Must(uuid.NewV7()),
		TenantID:             arg.TenantID,
		Provider:             arg.Provider,
		Enabled:              arg.Enabled,
		CredentialsEncrypted: arg.CredentialsEncrypted,
		CredentialHints:      arg.CredentialHints,
	}
	if at := slices.IndexFunc(held, func(p dbmodels.TenantPaymentProvider) bool { return p.Provider == arg.Provider }); at >= 0 {
		row.ID = held[at].ID
		held[at] = row
	} else {
		held = append(held, row)
	}
	m.providers[arg.TenantID] = held
	m.writeFirstProvider(arg.TenantID)
	return row, nil
}

func (m *memoryPaymentQueries) RetireTenantPaymentProvider(_ context.Context, arg dbmodels.RetireTenantPaymentProviderParams) (dbmodels.TenantPaymentProvider, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	held := m.providers[arg.TenantID]
	at := slices.IndexFunc(held, func(p dbmodels.TenantPaymentProvider) bool { return p.Provider == arg.Provider })
	if at < 0 {
		return dbmodels.TenantPaymentProvider{}, sql.ErrNoRows
	}
	if !held[at].RetiredAt.Valid {
		held[at].RetiredAt = sql.NullTime{Time: time.Now(), Valid: true}
	}
	m.writeFirstProvider(arg.TenantID)
	return held[at], nil
}

func (m *memoryPaymentQueries) DeleteTenantPaymentProvider(_ context.Context, arg dbmodels.DeleteTenantPaymentProviderParams) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	held := m.providers[arg.TenantID]
	at := slices.IndexFunc(held, func(p dbmodels.TenantPaymentProvider) bool { return p.Provider == arg.Provider })
	if at < 0 {
		return 0, nil
	}
	m.providers[arg.TenantID] = slices.Delete(held, at, at+1)
	m.writeFirstProvider(arg.TenantID)
	return 1, nil
}

func (m *memoryPaymentQueries) TenantPaymentProviderHasOpenPayments(_ context.Context, arg dbmodels.TenantPaymentProviderHasOpenPaymentsParams) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.open[arg.TenantID.String()+"/"+arg.Provider], nil
}

type memoryAuditQueries struct {
	mu      sync.Mutex
	entries []dbmodels.InsertAuditLogParams
}

func (m *memoryAuditQueries) InsertPlatformAuditLog(context.Context, dbmodels.InsertPlatformAuditLogParams) error {
	return nil
}

func (m *memoryAuditQueries) InsertAuditLog(_ context.Context, arg dbmodels.InsertAuditLogParams) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries = append(m.entries, arg)
	return nil
}

func (m *memoryAuditQueries) snapshot() []dbmodels.InsertAuditLogParams {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]dbmodels.InsertAuditLogParams, len(m.entries))
	copy(out, m.entries)
	return out
}

func newTestStore(t *testing.T, queries PaymentQuerier, audit *memoryAuditQueries, logs *bytes.Buffer) *Store {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(logs, nil))
	recorder := auditlog.New(audit, logger)
	return New(queries, testEncryptor(t), testRegistry(), recorder, logger)
}

// cardProviderID names a provider that takes the card on the storefront, with
// a publishable key the browser is given beside its secret key.
const (
	cardProviderID     = "card"
	cardSecretKey      = "secret_key"
	cardPublishableKey = "publishable_key"
	cardShopID         = "shop_id"
)

type declaredProvider struct {
	declaration paymentprovider.Declaration
}

func (p declaredProvider) Declaration() paymentprovider.Declaration { return p.declaration }

func (declaredProvider) StartCheckout(context.Context, paymentprovider.Credentials, paymentprovider.CheckoutRequest) (string, error) {
	return "", nil
}

func (declaredProvider) ParseNotification(context.Context, []byte, http.Header, paymentprovider.Credentials) (paymentprovider.Event, error) {
	return paymentprovider.Ignored{}, nil
}

func (declaredProvider) Refund(context.Context, paymentprovider.Credentials, paymentprovider.RefundRequest) (bool, error) {
	return false, nil
}

func (declaredProvider) RefundMade(context.Context, paymentprovider.Credentials, string, string) (bool, error) {
	return false, nil
}

func (declaredProvider) ListTransactions(context.Context, paymentprovider.Credentials, time.Time, time.Time) ([]paymentprovider.Transaction, error) {
	return nil, nil
}

func testRegistry() *paymentprovider.Registry {
	return paymentprovider.NewRegistry(
		stripe.New(),
		declaredProvider{paymentprovider.Declaration{
			ID:          cardProviderID,
			DisplayName: "Card",
			Fields: []paymentprovider.Field{
				{Name: cardSecretKey, Secret: true, Required: true},
				{Name: cardPublishableKey, Public: true, Required: true},
				{Name: cardShopID},
			},
			Currencies: []string{"JPY"},
		}},
	)
}

func containsAny(haystack string, needles ...string) bool {
	if haystack == "" {
		return false
	}
	for _, needle := range needles {
		if needle != "" && strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}
