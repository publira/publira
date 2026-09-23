package adminapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	testStoreIssuerID    = "57246542-96fe-1a63-e053-0824d011072a"
	testStoreKeyID       = "2X9R4HXF34"
	testStoreAccount     = "publira@example-project.iam.gserviceaccount.com"
	testStoreAppIdentity = "com.example.reader"

	routeExternalCheckout = publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT
	routeStore            = publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE
)

func (e *adminDBEnv) paymentClient() publiraadminv1connect.AdminPaymentSettingsServiceClient {
	return publiraadminv1connect.NewAdminPaymentSettingsServiceClient(e.Server.Client(), e.Server.URL)
}

func updateDBStorePaymentSettings(env *adminDBEnv, tenant adminDBTenant, req *publiraadminv1.UpdateTenantStorePaymentSettingsRequest) (*publiraadminv1.TenantStorePaymentSettings, error) {
	req.Tenant = tenant.tenantContext()
	resp, err := env.paymentClient().UpdateTenantStorePaymentSettings(context.Background(), newAdminDBRequest(tenant, req))
	if err != nil {
		return nil, err
	}
	return resp.Msg.Settings, nil
}

func getDBStorePaymentSettings(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantStorePaymentSettings {
	t.Helper()
	resp, err := env.paymentClient().GetTenantStorePaymentSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantStorePaymentSettingsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantStorePaymentSettings: %v", err)
	}
	return resp.Msg.Settings
}

// An administrator stores both stores' keys, reads them back as hints, and
// chooses to sell through the store; no key comes back in any response.
func TestDBStorePaymentSettingsAreStoredAndReadBackMasked(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if _, err := updateDBTenantMobileAppAssociation(env, tenant, &publiraadminv1.TenantMobileAppAssociation{
		Android: &publiraadminv1.TenantAndroidAppAssociation{ApplicationId: testStoreAppIdentity, Sha256CertFingerprints: []string{testFingerprintA}},
		Ios:     &publiraadminv1.TenantIosAppAssociation{TeamId: "ABCDE12345", BundleIdentifier: testStoreAppIdentity},
	}); err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation: %v", err)
	}

	initial := getDBStorePaymentSettings(t, env, tenant)
	if initial.AppPurchaseRoute != routeExternalCheckout || initial.AppStore.Enabled || initial.GooglePlay.Enabled {
		t.Fatalf("initial settings = %v, want the external checkout and no store", initial)
	}
	if initial.AppStore.BundleIdentifier != testStoreAppIdentity || initial.GooglePlay.PackageName != testStoreAppIdentity {
		t.Fatalf("initial settings = %v, want the apps the association names", initial)
	}

	appStoreKey := testAppStorePrivateKey(t)
	serviceAccountKey, serviceAccountPrivateKey := testServiceAccountKey(t)
	saved, err := updateDBStorePaymentSettings(env, tenant, &publiraadminv1.UpdateTenantStorePaymentSettingsRequest{
		AppPurchaseRoute: routeStore,
		AppStore: &publiraadminv1.AppStorePaymentSettingsUpdate{
			Enabled:              true,
			IssuerId:             testStoreIssuerID,
			KeyId:                testStoreKeyID,
			PrivateKeyUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
			PrivateKey:           appStoreKey,
		},
		GooglePlay: &publiraadminv1.GooglePlayPaymentSettingsUpdate{
			Enabled:                     true,
			ServiceAccountKeyUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
			ServiceAccountKey:           serviceAccountKey,
		},
	})
	if err != nil {
		t.Fatalf("UpdateTenantStorePaymentSettings: %v", err)
	}
	read := getDBStorePaymentSettings(t, env, tenant)
	for label, got := range map[string]*publiraadminv1.TenantStorePaymentSettings{"update": saved, "read": read} {
		if got.AppPurchaseRoute != routeStore {
			t.Fatalf("%s: route = %s, want STORE", label, got.AppPurchaseRoute)
		}
		if !got.AppStore.Ready || got.AppStore.IssuerId != testStoreIssuerID || got.AppStore.KeyId != testStoreKeyID || got.AppStore.PrivateKeyHint == "" {
			t.Fatalf("%s: app store = %v, want a ready App Store with its IDs and a hint", label, got.AppStore)
		}
		if !got.GooglePlay.Ready || got.GooglePlay.ServiceAccountEmail != testStoreAccount || got.GooglePlay.ServiceAccountKeyHint == "" {
			t.Fatalf("%s: google play = %v, want a ready Google Play with its account and a hint", label, got.GooglePlay)
		}
		assertNoKeyMaterial(t, label, got.String(), appStoreKey, serviceAccountPrivateKey)
	}

	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2`, tenant.Tenant.ID, paymentsettings.ActionUpdated); got != 1 {
		t.Fatalf("audit rows = %d, want 1", got)
	}
}

// The store route needs a store that can sell: an enabled one whose app the
// tenant names. A refused save stores nothing.
func TestDBStorePaymentSettingsRefuseTheStoreRouteWithoutAReadyStore(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	enabledAppStore := &publiraadminv1.AppStorePaymentSettingsUpdate{
		Enabled:              true,
		IssuerId:             testStoreIssuerID,
		KeyId:                testStoreKeyID,
		PrivateKeyUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		PrivateKey:           testAppStorePrivateKey(t),
	}

	for label, req := range map[string]*publiraadminv1.UpdateTenantStorePaymentSettingsRequest{
		"no store":            {AppPurchaseRoute: routeStore},
		"a store with no app": {AppPurchaseRoute: routeStore, AppStore: enabledAppStore},
	} {
		if _, err := updateDBStorePaymentSettings(env, tenant, req); connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("%s: code = %v, want failed_precondition (err=%v)", label, connect.CodeOf(err), err)
		}
	}
	if _, err := updateDBStorePaymentSettings(env, tenant, &publiraadminv1.UpdateTenantStorePaymentSettingsRequest{}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no route: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if got := getDBStorePaymentSettings(t, env, tenant); got.AppPurchaseRoute != routeExternalCheckout || got.AppStore.Enabled {
		t.Fatalf("settings after refused saves = %v, want nothing stored", got)
	}
	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2`, tenant.Tenant.ID, paymentsettings.ActionUpdated); got != 0 {
		t.Fatalf("audit rows after refused saves = %d, want 0", got)
	}
}

func TestDBStorePaymentSettingsRequireTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)

	if _, err := env.paymentClient().GetTenantStorePaymentSettings(context.Background(), newAdminDBRequest(tenant.as(editor), &publiraadminv1.GetTenantStorePaymentSettingsRequest{
		Tenant: tenant.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("get: code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := updateDBStorePaymentSettings(env, tenant.as(editor), &publiraadminv1.UpdateTenantStorePaymentSettingsRequest{
		AppPurchaseRoute: routeExternalCheckout,
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("update: code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
}

func assertNoKeyMaterial(t *testing.T, label, response string, keys ...string) {
	t.Helper()
	for _, key := range keys {
		for line := range strings.SplitSeq(key, "\n") {
			if strings.HasPrefix(line, "-----") || len(line) < 16 {
				continue
			}
			if strings.Contains(response, line) {
				t.Fatalf("%s: response carries key material %q", label, line)
			}
		}
	}
	if strings.Contains(response, "PRIVATE KEY") {
		t.Fatalf("%s: response carries a PEM block", label)
	}
}

func testAppStorePrivateKey(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return testPKCS8PEM(t, key)
}

// testServiceAccountKey answers the JSON key file and the private key inside it.
func testServiceAccountKey(t *testing.T) (string, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	privateKey := testPKCS8PEM(t, key)
	encoded, err := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     "example-project",
		"private_key_id": "0123456789abcdef0123456789abcdef01234567",
		"private_key":    privateKey,
		"client_email":   testStoreAccount,
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return string(encoded), privateKey
}

func testPKCS8PEM(t *testing.T, key any) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}
