package paymentsettings_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	integrationIssuerID            = "57246542-96fe-1a63-e053-0824d011072a"
	integrationKeyID               = "2X9R4HXF34"
	integrationBundleIdentifier    = "com.example.reader"
	integrationPackageName         = "com.example.reader"
	integrationServiceAccountEmail = "publira@example-project.iam.gserviceaccount.com"
	integrationPrivateKeyID        = "0123456789abcdef0123456789abcdef01234567"
)

func TestAppStoresRoundTripBothStoresWithoutRevealingAKey(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000001", "store-a.example.com", "Store Tenant A")
	setAppIdentities(t, ctx, pg, tenant.ID)
	appStoreKey := appStorePrivateKeyPEM(t)
	serviceAccountKey := googlePlayServiceAccountKey(t)

	stores := newIntegrationAppStores(t, pg.DB)
	saved, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteStore,
		AppStore: paymentsettings.AppStoreUpdate{
			Enabled:              true,
			IssuerID:             strings.ToUpper(integrationIssuerID),
			KeyID:                strings.ToLower(integrationKeyID),
			PrivateKey:           appStoreKey,
			PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
		},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     true,
			ServiceAccountKey:           serviceAccountKey,
			ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
		},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	read, err := stores.Get(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if read != saved {
		t.Fatalf("Get = %+v, want what Update answered, %+v", read, saved)
	}
	if read.Route != paymentsettings.RouteStore {
		t.Fatalf("route = %q, want store", read.Route)
	}
	want := paymentsettings.AppStoreConfig{
		Enabled:              true,
		IssuerID:             integrationIssuerID,
		KeyID:                integrationKeyID,
		PrivateKeyConfigured: true,
		PrivateKeyHint:       read.AppStore.PrivateKeyHint,
		BundleIdentifier:     integrationBundleIdentifier,
		Ready:                true,
	}
	if read.AppStore != want {
		t.Fatalf("app store = %+v, want %+v", read.AppStore, want)
	}
	if !strings.HasPrefix(read.AppStore.PrivateKeyHint, "••••") {
		t.Fatalf("private key hint = %q, want a masked value", read.AppStore.PrivateKeyHint)
	}
	wantPlay := paymentsettings.GooglePlayConfig{
		Enabled:                     true,
		ServiceAccountEmail:         integrationServiceAccountEmail,
		ServiceAccountKeyConfigured: true,
		ServiceAccountKeyHint:       "••••••••4567",
		PackageName:                 integrationPackageName,
		Ready:                       true,
	}
	if read.GooglePlay != wantPlay {
		t.Fatalf("google play = %+v, want %+v", read.GooglePlay, wantPlay)
	}

	var privateKeyEncrypted, serviceAccountKeyEncrypted string
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT a.private_key_encrypted, g.service_account_key_encrypted
		FROM tenant_app_store_config a
			JOIN tenant_google_play_config g ON g.tenant_id = a.tenant_id
		WHERE a.tenant_id = $1
	`, tenant.ID).Scan(&privateKeyEncrypted, &serviceAccountKeyEncrypted); err != nil {
		t.Fatalf("select stored rows: %v", err)
	}
	if !secretcrypto.IsEncryptedEnvelope(privateKeyEncrypted) || !secretcrypto.IsEncryptedEnvelope(serviceAccountKeyEncrypted) {
		t.Fatalf("stored keys are not envelopes: app store=%q google play=%q", privateKeyEncrypted, serviceAccountKeyEncrypted)
	}
	for _, stored := range []string{privateKeyEncrypted, serviceAccountKeyEncrypted, read.AppStore.PrivateKeyHint, read.GooglePlay.ServiceAccountKeyHint} {
		if strings.Contains(stored, "PRIVATE KEY") || strings.Contains(stored, "service_account") {
			t.Fatalf("a stored or answered value carries key material: %q", stored)
		}
	}

	// Saving the form again without touching a key keeps both keys, and
	// turning both stores off takes the route back to the external checkout.
	kept, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteExternalCheckout,
		AppStore: paymentsettings.AppStoreUpdate{
			IssuerID:             integrationIssuerID,
			KeyID:                integrationKeyID,
			PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeUnchanged,
		},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeUnchanged,
		},
	})
	if err != nil {
		t.Fatalf("Update keeping keys: %v", err)
	}
	if !kept.AppStore.PrivateKeyConfigured || kept.AppStore.PrivateKeyHint != read.AppStore.PrivateKeyHint {
		t.Fatalf("app store key was not kept: %+v", kept.AppStore)
	}
	if kept.AppStore.Enabled || kept.AppStore.Ready {
		t.Fatalf("app store = %+v, want disabled", kept.AppStore)
	}
	if !kept.GooglePlay.ServiceAccountKeyConfigured || kept.GooglePlay.ServiceAccountEmail != integrationServiceAccountEmail {
		t.Fatalf("google play key was not kept: %+v", kept.GooglePlay)
	}
	if kept.Route != paymentsettings.RouteExternalCheckout {
		t.Fatalf("route = %q, want external_checkout", kept.Route)
	}

	cleared, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route:    paymentsettings.RouteExternalCheckout,
		AppStore: paymentsettings.AppStoreUpdate{PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeClear},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeClear,
		},
	})
	if err != nil {
		t.Fatalf("Update clearing keys: %v", err)
	}
	if cleared.AppStore != (paymentsettings.AppStoreConfig{BundleIdentifier: integrationBundleIdentifier}) {
		t.Fatalf("app store = %+v, want nothing stored", cleared.AppStore)
	}
	if cleared.GooglePlay != (paymentsettings.GooglePlayConfig{PackageName: integrationPackageName}) {
		t.Fatalf("google play = %+v, want nothing stored", cleared.GooglePlay)
	}
}

func TestAppStoresReadATenantThatSavedNothing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000002", "store-b.example.com", "Store Tenant B")
	cfg, err := newIntegrationAppStores(t, pg.DB).Get(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if cfg != (paymentsettings.StoreConfig{Route: paymentsettings.RouteExternalCheckout}) {
		t.Fatalf("Get = %+v, want the external checkout and no store", cfg)
	}
}

func TestAppStoresRefuseTheStoreRouteWithoutAReadyStore(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000003", "store-c.example.com", "Store Tenant C")
	stores := newIntegrationAppStores(t, pg.DB)
	enabledAppStore := paymentsettings.AppStoreUpdate{
		Enabled:              true,
		IssuerID:             integrationIssuerID,
		KeyID:                integrationKeyID,
		PrivateKey:           appStorePrivateKeyPEM(t),
		PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
	}

	if _, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteStore,
	}); !errors.Is(err, paymentsettings.ErrStoreRouteRequiresReadyStore) {
		t.Fatalf("store route with no store: err = %v, want ErrStoreRouteRequiresReadyStore", err)
	}

	// An enabled store whose app the tenant has not named cannot sell yet.
	if _, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route:    paymentsettings.RouteStore,
		AppStore: enabledAppStore,
	}); !errors.Is(err, paymentsettings.ErrStoreRouteRequiresReadyStore) {
		t.Fatalf("store route with no iOS app: err = %v, want ErrStoreRouteRequiresReadyStore", err)
	}
	cfg, err := stores.Get(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if cfg.Route != paymentsettings.RouteExternalCheckout || cfg.AppStore.Enabled {
		t.Fatalf("a refused update wrote %+v", cfg)
	}

	setAppIdentities(t, ctx, pg, tenant.ID)
	cfg, err = stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route:    paymentsettings.RouteStore,
		AppStore: enabledAppStore,
	})
	if err != nil {
		t.Fatalf("store route with a ready App Store: %v", err)
	}
	if cfg.Route != paymentsettings.RouteStore || !cfg.AppStore.Ready || cfg.GooglePlay.Ready {
		t.Fatalf("Update = %+v, want the store route over the App Store alone", cfg)
	}
}

func TestAppStoresRejectCredentialsTheStoreWouldNotAccept(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000004", "store-d.example.com", "Store Tenant D")
	stores := newIntegrationAppStores(t, pg.DB)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	cases := []struct {
		name  string
		input paymentsettings.StoreUpdateInput
		want  error
	}{
		{
			name:  "no route",
			input: paymentsettings.StoreUpdateInput{},
			want:  paymentsettings.ErrInvalidAppPurchaseRoute,
		},
		{
			name: "an issuer ID that is not a UUID",
			input: paymentsettings.StoreUpdateInput{
				Route:    paymentsettings.RouteExternalCheckout,
				AppStore: paymentsettings.AppStoreUpdate{IssuerID: "issuer"},
			},
			want: paymentsettings.ErrInvalidIssuerID,
		},
		{
			name: "a key ID of the wrong length",
			input: paymentsettings.StoreUpdateInput{
				Route:    paymentsettings.RouteExternalCheckout,
				AppStore: paymentsettings.AppStoreUpdate{KeyID: "2X9R4H"},
			},
			want: paymentsettings.ErrInvalidKeyID,
		},
		{
			name: "an RSA key for the App Store",
			input: paymentsettings.StoreUpdateInput{
				Route: paymentsettings.RouteExternalCheckout,
				AppStore: paymentsettings.AppStoreUpdate{
					PrivateKey:           pkcs8PEM(t, rsaKey),
					PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
				},
			},
			want: paymentsettings.ErrInvalidAppStorePrivateKey,
		},
		{
			name: "an enabled App Store without a key",
			input: paymentsettings.StoreUpdateInput{
				Route: paymentsettings.RouteExternalCheckout,
				AppStore: paymentsettings.AppStoreUpdate{
					Enabled:  true,
					IssuerID: integrationIssuerID,
					KeyID:    integrationKeyID,
				},
			},
			want: paymentsettings.ErrAppStoreCredentialsRequired,
		},
		{
			name: "a Google Play key that is not a service account's",
			input: paymentsettings.StoreUpdateInput{
				Route: paymentsettings.RouteExternalCheckout,
				GooglePlay: paymentsettings.GooglePlayUpdate{
					ServiceAccountKey:           `{"type":"authorized_user"}`,
					ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
				},
			},
			want: paymentsettings.ErrInvalidServiceAccountKey,
		},
		{
			name: "an enabled Google Play without a key",
			input: paymentsettings.StoreUpdateInput{
				Route:      paymentsettings.RouteExternalCheckout,
				GooglePlay: paymentsettings.GooglePlayUpdate{Enabled: true},
			},
			want: paymentsettings.ErrGooglePlayCredentialsRequired,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := stores.Update(ctx, tenant.ID, tc.input); !errors.Is(err, tc.want) {
				t.Fatalf("Update err = %v, want %v", err, tc.want)
			}
		})
	}

	var rows int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM tenant_app_store_config WHERE tenant_id = $1", tenant.ID).Scan(&rows); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("a rejected update stored %d rows", rows)
	}
}

func TestAppStoresRejectPlaintextAtDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000005", "store-e.example.com", "Store Tenant E")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_app_store_config (tenant_id, private_key_encrypted)
		VALUES ($1, '-----BEGIN PRIVATE KEY-----')
	`, tenant.ID); !isCheckViolation(err) {
		t.Fatalf("plaintext App Store key insert error = %v, want check_violation", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_google_play_config (tenant_id, service_account_email, service_account_key_encrypted)
		VALUES ($1, 'a@example.com', '{"type":"service_account"}')
	`, tenant.ID); !isCheckViolation(err) {
		t.Fatalf("plaintext Google Play key insert error = %v, want check_violation", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_app_store_config (tenant_id, enabled) VALUES ($1, true)
	`, tenant.ID); !isCheckViolation(err) {
		t.Fatalf("enabled App Store without a key error = %v, want check_violation", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, app_purchase_route) VALUES ($1, 'coins')
	`, tenant.ID); !isCheckViolation(err) {
		t.Fatalf("unknown route insert error = %v, want check_violation", err)
	}
}

func TestAppStoresRLSHidesOtherTenantStores(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantA := pg.SeedTenant(t, "STRTNT00000A", "store-ra.example.com", "Store Tenant RA")
	tenantB := pg.SeedTenant(t, "STRTNT00000B", "store-rb.example.com", "Store Tenant RB")
	setAppIdentities(t, ctx, pg, tenantB.ID)
	if _, err := newIntegrationAppStores(t, pg.DB).Update(ctx, tenantB.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteStore,
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     true,
			ServiceAccountKey:           googlePlayServiceAccountKey(t),
			ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
		},
	}); err != nil {
		t.Fatalf("seed tenant B stores: %v", err)
	}

	withAdminTenant(t, pg, tenantA.ID, func(ctx context.Context, conn *sql.Conn) {
		cfg, err := newIntegrationAppStores(t, conn).Get(ctx, tenantB.ID)
		if err != nil {
			t.Fatalf("Get other tenant: %v", err)
		}
		if cfg != (paymentsettings.StoreConfig{Route: paymentsettings.RouteExternalCheckout}) {
			t.Fatalf("tenant A saw tenant B stores: %+v", cfg)
		}
	})

	adminDB := pg.OpenAdminDB(t)
	for _, table := range []string{"tenant_app_store_config", "tenant_google_play_config"} {
		var visible int
		if err := adminDB.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&visible); err != nil {
			t.Fatalf("count %s without tenant setting: %v", table, err)
		}
		if visible != 0 {
			t.Fatalf("%s rows visible without tenant setting = %d, want 0", table, visible)
		}
	}
}

func newIntegrationAppStores(t *testing.T, db dbmodels.DBTX) *paymentsettings.AppStores {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{
		"k1": bytes.Repeat([]byte{7}, 32),
	}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return paymentsettings.NewAppStores(dbmodels.New(db), mgr)
}

// setAppIdentities names the tenant's iOS and Android apps, which the stores
// sell in.
func setAppIdentities(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, tenantID uuid.UUID) {
	t.Helper()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, ios_team_id, ios_bundle_identifier, android_application_id, android_sha256_cert_fingerprints)
		VALUES ($1, 'ABCDE12345', $2, $3, ARRAY[$4])
		ON CONFLICT (tenant_id) DO UPDATE
		SET ios_team_id = EXCLUDED.ios_team_id,
			ios_bundle_identifier = EXCLUDED.ios_bundle_identifier,
			android_application_id = EXCLUDED.android_application_id,
			android_sha256_cert_fingerprints = EXCLUDED.android_sha256_cert_fingerprints
	`, tenantID, integrationBundleIdentifier, integrationPackageName, strings.Repeat("AB:", 31)+"AB"); err != nil {
		t.Fatalf("set app identities: %v", err)
	}
}

func appStorePrivateKeyPEM(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return pkcs8PEM(t, key)
}

func googlePlayServiceAccountKey(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	encoded, err := json.Marshal(map[string]string{
		"type":           "service_account",
		"project_id":     "example-project",
		"private_key_id": integrationPrivateKeyID,
		"private_key":    pkcs8PEM(t, key),
		"client_email":   integrationServiceAccountEmail,
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return string(encoded)
}

func pkcs8PEM(t *testing.T, key any) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestAppStoresLoadTheCredentialsOfAReadyStoreOnly(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "STRTNT000001", "store-a.example.com", "Store Tenant A")
	setAppIdentities(t, ctx, pg, tenant.ID)
	stores := newIntegrationAppStores(t, pg.DB)

	if _, err := stores.LoadAppStoreCredentials(ctx, tenant.ID); !errors.Is(err, paymentsettings.ErrStoreNotReady) {
		t.Fatalf("LoadAppStoreCredentials before saving = %v, want ErrStoreNotReady", err)
	}
	if _, err := stores.LoadGooglePlayCredentials(ctx, tenant.ID); !errors.Is(err, paymentsettings.ErrStoreNotReady) {
		t.Fatalf("LoadGooglePlayCredentials before saving = %v, want ErrStoreNotReady", err)
	}

	appStoreKey := appStorePrivateKeyPEM(t)
	serviceAccountKey := googlePlayServiceAccountKey(t)
	if _, err := stores.Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteStore,
		AppStore: paymentsettings.AppStoreUpdate{
			Enabled:              true,
			IssuerID:             integrationIssuerID,
			KeyID:                integrationKeyID,
			PrivateKey:           appStoreKey,
			PrivateKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
		},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     false,
			ServiceAccountKey:           serviceAccountKey,
			ServiceAccountKeyUpdateMode: paymentsettings.SecretUpdateModeReplace,
		},
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	appStore, err := stores.LoadAppStoreCredentials(ctx, tenant.ID)
	if err != nil {
		t.Fatalf("LoadAppStoreCredentials: %v", err)
	}
	want := paymentsettings.AppStoreCredentials{
		IssuerID:         integrationIssuerID,
		KeyID:            integrationKeyID,
		PrivateKey:       appStoreKey,
		BundleIdentifier: integrationBundleIdentifier,
	}
	if appStore != want {
		t.Fatal("LoadAppStoreCredentials did not answer the saved key and the app's bundle identifier")
	}
	// Stored but switched off: a disabled store verifies nothing.
	if _, err := stores.LoadGooglePlayCredentials(ctx, tenant.ID); !errors.Is(err, paymentsettings.ErrStoreNotReady) {
		t.Fatalf("LoadGooglePlayCredentials of a disabled store = %v, want ErrStoreNotReady", err)
	}
}
