package paymentsettings

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

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

type memoryPaymentQueries struct {
	mu       sync.Mutex
	byTenant map[uuid.UUID]dbmodels.TenantPaymentConfig
}

func newMemoryPaymentQueries() *memoryPaymentQueries {
	return &memoryPaymentQueries{byTenant: make(map[uuid.UUID]dbmodels.TenantPaymentConfig)}
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

func (m *memoryPaymentQueries) GetEnabledTenantPaymentConfigByTenantID(_ context.Context, tenantID uuid.UUID) (dbmodels.TenantPaymentConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.byTenant[tenantID]
	if !ok || !row.Enabled {
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
		CreatedAt:            existing.CreatedAt,
		UpdatedAt:            existing.UpdatedAt,
	}
	m.byTenant[arg.TenantID] = row
	return row, nil
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
