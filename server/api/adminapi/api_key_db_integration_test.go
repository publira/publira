package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) apiKeyClient() publiraadminv1connect.AdminApiKeyServiceClient {
	return publiraadminv1connect.NewAdminApiKeyServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

func (e *adminDBEnv) purchaseClient() publiraadminv1connect.AdminPurchaseServiceClient {
	return publiraadminv1connect.NewAdminPurchaseServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

func createAPIKey(t *testing.T, env *adminDBEnv, admin adminDBTenant, scopes ...publiraadminv1.ApiKeyScope) *publiraadminv1.CreateApiKeyResponse {
	t.Helper()
	res, err := env.apiKeyClient().CreateApiKey(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.CreateApiKeyRequest{
		Tenant: admin.tenantContext(),
		Name:   "Data warehouse",
		Scopes: scopes,
	})
	if err != nil {
		t.Fatalf("CreateApiKey: %v", err)
	}
	return res
}

// A key with catalog:read reads the catalog and nothing else, a key with
// purchases:read reads the purchases, a revoked key opens nothing, and a key
// names one tenant alone.
func TestDBAnAPIKeyReadsWhatItsScopesAdmit(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "KEYTENANT01", "keys.example.com", "Key Tenant", "KEYADMIN01", "admin@keys.example.com")
	other := env.seedTenantWithAdmin(t, "KEYTENANT02", "keys-b.example.com", "Other Tenant", "KEYADMIN02", "admin@keys-b.example.com")
	env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "KEYSERIES001", Title: "Key Series"})

	catalog := createAPIKey(t, env, admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ)
	purchases := createAPIKey(t, env, admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_PURCHASES_READ)
	if got := catalog.ApiKey.Prefix; len(got) != len("pbk_")+12 || got != catalog.Key[:len(got)] {
		t.Fatalf("prefix = %q, want the start of the key %q", got, catalog.Key)
	}

	withKey := func(key string) context.Context {
		return testutil.WithBearer(context.Background(), key)
	}
	listSeries := func(key string, tenant adminDBTenant) (*publiraadminv1.ListSeriesResponse, error) {
		return env.seriesClient().ListSeries(withKey(key), &publiraadminv1.ListSeriesRequest{Tenant: tenant.tenantContext()})
	}
	listPurchases := func(key string) error {
		_, err := env.purchaseClient().ListPurchases(withKey(key), &publiraadminv1.ListPurchasesRequest{Tenant: admin.tenantContext()})
		return err
	}

	res, err := listSeries(catalog.Key, admin)
	if err != nil {
		t.Fatalf("ListSeries with a catalog:read key: %v", err)
	}
	if got := len(res.Series); got != 1 {
		t.Fatalf("ListSeries answered %d series, want the tenant's 1", got)
	}
	if code := connect.CodeOf(listPurchases(catalog.Key)); code != connect.CodePermissionDenied {
		t.Fatalf("ListPurchases with a catalog:read key = %v, want %v", code, connect.CodePermissionDenied)
	}
	if err := listPurchases(purchases.Key); err != nil {
		t.Fatalf("ListPurchases with a purchases:read key: %v", err)
	}
	if _, err := listSeries(purchases.Key, admin); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListSeries with a purchases:read key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	// No scope admits a write, or a read that is not listed.
	if _, err := env.apiKeyClient().ListApiKeys(withKey(catalog.Key), &publiraadminv1.ListApiKeysRequest{Tenant: admin.tenantContext()}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListApiKeys with a key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	if _, err := env.seriesClient().CreateSeries(withKey(catalog.Key), &publiraadminv1.CreateSeriesRequest{Tenant: admin.tenantContext(), Title: "Written by a key"}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateSeries with a key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	// A key of one tenant's names nothing of another's.
	if _, err := listSeries(catalog.Key, other); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries for another tenant = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	// A key changed by one character does not open.
	tampered := catalog.Key[:len(catalog.Key)-1] + "a"
	if tampered == catalog.Key {
		tampered = catalog.Key[:len(catalog.Key)-1] + "b"
	}
	if _, err := listSeries(tampered, admin); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries with a tampered key = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}

	revoked, err := env.apiKeyClient().RevokeApiKey(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.RevokeApiKeyRequest{
		Tenant:   admin.tenantContext(),
		ApiKeyId: catalog.ApiKey.Id,
	})
	if err != nil {
		t.Fatalf("RevokeApiKey: %v", err)
	}
	if revoked.ApiKey.RevokedAt == "" {
		t.Fatal("RevokeApiKey answered a key with no revoked_at")
	}
	if _, err := listSeries(catalog.Key, admin); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries with a revoked key = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}

	listed, err := env.apiKeyClient().ListApiKeys(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.ListApiKeysRequest{Tenant: admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListApiKeys: %v", err)
	}
	if got := len(listed.ApiKeys); got != 2 {
		t.Fatalf("ListApiKeys answered %d keys, want 2", got)
	}
	for _, key := range listed.ApiKeys {
		if key.Id == catalog.ApiKey.Id && key.LastUsedAt == "" {
			t.Fatal("the catalog key's last_used_at is empty after it was used")
		}
	}
	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND target_type = 'api_key' AND action IN ('api_key_created', 'api_key_revoked')`, admin.Tenant.ID); got != 3 {
		t.Fatalf("audit entries = %d, want two creations and a revocation", got)
	}
	// Only the hash is kept.
	if got := env.countRows(t, `SELECT count(*) FROM tenant_api_keys WHERE key_hash = convert_to($1, 'UTF8')`, catalog.Key); got != 0 {
		t.Fatal("the key is stored as it was answered")
	}
}

// A key is charged per request against the platform policy, and refused with
// resource_exhausted past it.
func TestDBAnAPIKeyPastItsAllowanceIsRefused(t *testing.T) {
	t.Parallel()

	policy := platformpolicy.Defaults()
	policy.APIKeyRequest = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 10}
	env := newAdminDBEnvWith(t, &testStorageProvider{}, openMailGuard(), nil, nil, func(server *adminServer) {
		server.policy = platformpolicy.Fixed(policy)
	})
	admin := env.seedTenantWithAdmin(t, "KEYTENANT03", "keys-c.example.com", "Key Tenant", "KEYADMIN03", "admin@keys-c.example.com")
	key := createAPIKey(t, env, admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ)

	call := func() error {
		_, err := env.seriesClient().ListSeries(testutil.WithBearer(context.Background(), key.Key), &publiraadminv1.ListSeriesRequest{Tenant: admin.tenantContext()})
		return err
	}
	for i := range 2 {
		if err := call(); err != nil {
			t.Fatalf("request %d within the allowance: %v", i+1, err)
		}
	}
	if code := connect.CodeOf(call()); code != connect.CodeResourceExhausted {
		t.Fatalf("request past the allowance = %v, want %v", code, connect.CodeResourceExhausted)
	}
}

// A key is named and scoped on creation, and a request that names neither is
// refused field by field.
func TestDBCreateApiKeyChecksItsFields(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "KEYTENANT04", "keys-d.example.com", "Key Tenant", "KEYADMIN04", "admin@keys-d.example.com")
	ctx := testutil.WithBearer(context.Background(), admin.token())
	for name, req := range map[string]*publiraadminv1.CreateApiKeyRequest{
		"no name":       {Name: " ", Scopes: []publiraadminv1.ApiKeyScope{publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ}},
		"no scope":      {Name: "Warehouse"},
		"unknown scope": {Name: "Warehouse", Scopes: []publiraadminv1.ApiKeyScope{publiraadminv1.ApiKeyScope_API_KEY_SCOPE_UNSPECIFIED}},
	} {
		req.Tenant = admin.tenantContext()
		if _, err := env.apiKeyClient().CreateApiKey(ctx, req); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: CreateApiKey = %v, want %v", name, connect.CodeOf(err), connect.CodeInvalidArgument)
		}
	}
}
