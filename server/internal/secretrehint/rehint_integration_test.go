package secretrehint

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider/paypay"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secrethint"
	"github.com/publira/publira/server/internal/testutil"
)

func manager(t *testing.T, id string) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{id: bytes.Repeat([]byte{id[len(id)-1]}, 32)}, id)
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return mgr
}

func seal(t *testing.T, mgr *secretcrypto.Manager, plaintext string) string {
	t.Helper()
	sealed, err := mgr.EncryptString(plaintext)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	return sealed
}

func document(t *testing.T, fields map[string]string) string {
	t.Helper()
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return string(raw)
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func privateKeyPEM(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// stored is the credentials a tenant saved, and the hints an earlier release
// stored for them, which kept everything before the last underscore of a
// secret and, for a .p8 key, the end of the key itself.
type stored struct {
	tenant        testutil.Tenant
	paypayKey     string
	paypaySecret  string
	resendKey     string
	appStoreKey   string
	appleKey      string
	webhookSecret string
	webhookID     uuid.UUID
}

func seed(t *testing.T, pg *testutil.PostgresEnv, sealer *secretcrypto.Manager) stored {
	t.Helper()
	db := pg.DB
	s := stored{
		tenant:        pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant"),
		paypayKey:     "a_0123456789_abcd",
		paypaySecret:  "c2VjcmV0_with_under_scores_inside",
		resendKey:     "re_abc123_defghijklmnopqrstuvwxyz",
		appStoreKey:   privateKeyPEM(t),
		appleKey:      privateKeyPEM(t),
		webhookSecret: "whsec_abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnop",
		webhookID:     uuid.Must(uuid.NewV7()),
	}
	// The trigger on tenant_payment_config adds the provider to
	// tenant_payment_providers, as a save of the previous release does.
	exec(t, db, `INSERT INTO tenant_payment_config (tenant_id, provider, currency, credentials_encrypted, credential_hints)
		VALUES ($1, 'paypay', 'JPY', $2, $3)`, s.tenant.ID,
		document(t, map[string]string{
			paypay.FieldAPIKey:     seal(t, sealer, s.paypayKey),
			paypay.FieldAPISecret:  seal(t, sealer, s.paypaySecret),
			paypay.FieldMerchantID: seal(t, sealer, "123456789"),
		}),
		document(t, map[string]string{
			paypay.FieldAPIKey:     "a_0123456789_••••",
			paypay.FieldAPISecret:  "c2VjcmV0_with_under_scores_••••••••side",
			paypay.FieldMerchantID: "123456789",
		}))
	exec(t, db, `INSERT INTO tenant_inbound_email_config (tenant_id, provider, credentials_encrypted, credential_hints)
		VALUES ($1, 'resend', $2, $3)`, s.tenant.ID,
		document(t, map[string]string{"api_key": seal(t, sealer, s.resendKey)}),
		document(t, map[string]string{"api_key": "re_abc123_••••••••wxyz"}))
	exec(t, db, `INSERT INTO tenant_app_store_config (tenant_id, private_key_encrypted, private_key_hint) VALUES ($1, $2, '••••••••wIBAQQg')`,
		s.tenant.ID, seal(t, sealer, s.appStoreKey))
	exec(t, db, `INSERT INTO tenant_apple_sign_in_config (tenant_id, private_key_encrypted, private_key_hint) VALUES ($1, $2, '••••••••wIBAQQg')`,
		s.tenant.ID, seal(t, sealer, strings.TrimSpace(s.appleKey)))
	exec(t, db, `INSERT INTO tenant_google_play_config (tenant_id, service_account_email, service_account_key_encrypted, service_account_key_hint)
		VALUES ($1, 'play@example.iam.gserviceaccount.com', $2, '••••••••4567')`,
		s.tenant.ID, seal(t, sealer, `{"type":"service_account","private_key_id":"0123456789abcdef0123456789abcdef01234567"}`))
	exec(t, db, `INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', $3, $4, ARRAY['purchase.completed'])`,
		s.webhookID, s.tenant.ID, seal(t, sealer, s.webhookSecret), secrethint.Mask(s.webhookSecret))
	return s
}

// hints is every hint the tenant's rows hold, keyed by table and field.
func hints(t *testing.T, db *sql.DB, tenantID uuid.UUID) map[string]string {
	t.Helper()
	ctx := context.Background()
	out := map[string]string{}
	for _, table := range []string{"tenant_payment_config", "tenant_payment_providers", "tenant_inbound_email_config"} {
		var raw string
		if err := db.QueryRowContext(ctx, `SELECT credential_hints::text FROM `+table+` WHERE tenant_id = $1`, tenantID).Scan(&raw); err != nil {
			t.Fatalf("read %s: %v", table, err)
		}
		var fields map[string]string
		if err := json.Unmarshal([]byte(raw), &fields); err != nil {
			t.Fatalf("decode %s: %v", table, err)
		}
		for field, hint := range fields {
			out[table+"."+field] = hint
		}
	}
	for _, q := range []struct{ name, query string }{
		{"tenant_app_store_config", `SELECT private_key_hint FROM tenant_app_store_config WHERE tenant_id = $1`},
		{"tenant_apple_sign_in_config", `SELECT private_key_hint FROM tenant_apple_sign_in_config WHERE tenant_id = $1`},
		{"tenant_google_play_config", `SELECT service_account_key_hint FROM tenant_google_play_config WHERE tenant_id = $1`},
		{"tenant_webhook_endpoints", `SELECT secret_hint FROM tenant_webhook_endpoints WHERE tenant_id = $1`},
	} {
		var hint string
		if err := db.QueryRowContext(ctx, q.query, tenantID).Scan(&hint); err != nil {
			t.Fatalf("read %s: %v", q.name, err)
		}
		out[q.name] = hint
	}
	return out
}

func TestRunDerivesEveryHintAgain(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	sealer := manager(t, "k1")
	s := seed(t, pg, sealer)

	report, err := Run(context.Background(), pg.DB, sealer, Options{BatchSize: 1})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := map[string]Counts{
		"tenant_payment_providers":    {Rewritten: 2},
		"tenant_inbound_email_config": {Rewritten: 1},
		"tenant_app_store_config":     {Rewritten: 1},
		"tenant_apple_sign_in_config": {Rewritten: 1},
		"tenant_google_play_config":   {Current: 1},
		"tenant_webhook_endpoints":    {Current: 1},
	}
	if !maps.Equal(report.Tables, want) {
		t.Fatalf("report = %+v, want %+v", report.Tables, want)
	}

	got := hints(t, pg.DB, s.tenant.ID)
	wantHints := map[string]string{
		"tenant_payment_config.api_key":        "••••••••abcd",
		"tenant_payment_config.api_secret":     "••••••••side",
		"tenant_payment_config.merchant_id":    "123456789",
		"tenant_payment_providers.api_key":     "••••••••abcd",
		"tenant_payment_providers.api_secret":  "••••••••side",
		"tenant_payment_providers.merchant_id": "123456789",
		"tenant_inbound_email_config.api_key":  "re_••••••••wxyz",
		"tenant_app_store_config":              secrethint.PrivateKey(s.appStoreKey),
		"tenant_apple_sign_in_config":          secrethint.PrivateKey(s.appleKey),
		"tenant_google_play_config":            "••••••••4567",
		"tenant_webhook_endpoints":             "whsec_••••••••mnop",
	}
	if !maps.Equal(got, wantHints) {
		t.Fatalf("hints = %v, want %v", got, wantHints)
	}

	again, err := Run(context.Background(), pg.DB, sealer, Options{})
	if err != nil {
		t.Fatalf("Run again: %v", err)
	}
	for table, c := range again.Tables {
		if c.Rewritten != 0 || c.Unreadable != 0 {
			t.Fatalf("a second run on %s = %+v, want every hint current", table, c)
		}
	}
}

func TestRunDryRunWritesNothing(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	sealer := manager(t, "k1")
	s := seed(t, pg, sealer)
	before := hints(t, pg.DB, s.tenant.ID)

	report, err := Run(context.Background(), pg.DB, sealer, Options{DryRun: true})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if c := report.Tables["tenant_payment_providers"]; c.Rewritten != 2 {
		t.Fatalf("dry run on tenant_payment_providers = %+v, want 2 to rewrite", c)
	}
	if after := hints(t, pg.DB, s.tenant.ID); !maps.Equal(after, before) {
		t.Fatalf("a dry run changed the hints from %v to %v", before, after)
	}
}

// A secret no configured key opens keeps its hint, is counted, and does not
// stop the others.
func TestRunLeavesTheHintOfWhatNoKeyOpens(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	s := seed(t, pg, manager(t, "k2"))
	sealer := manager(t, "k1")
	exec(t, pg.DB, `UPDATE tenant_app_store_config SET private_key_encrypted = $1 WHERE tenant_id = $2`,
		seal(t, sealer, s.appStoreKey), s.tenant.ID)

	report, err := Run(context.Background(), pg.DB, sealer, Options{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if c := report.Tables["tenant_app_store_config"]; c.Rewritten != 1 {
		t.Fatalf("tenant_app_store_config = %+v, want its hint rewritten", c)
	}
	if n := report.Unreadable(); n != 6 {
		t.Fatalf("unreadable = %d, want the 6 other secrets", n)
	}
	got := hints(t, pg.DB, s.tenant.ID)
	if got["tenant_payment_providers.api_key"] != "a_0123456789_••••" || got["tenant_apple_sign_in_config"] != "••••••••wIBAQQg" {
		t.Fatalf("hints of secrets no key opens = %v, want them as they were", got)
	}
}

// Every column that holds a hint is one a run derives again, or the copy
// tenant_payment_config keeps of tenant_payment_providers, so a column added
// later fails here until it is listed.
func TestColumnsCoverEveryHintColumn(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	rows, err := pg.DB.QueryContext(context.Background(), `
		SELECT c.relname || '.' || a.attname
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
		JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
		WHERE a.attnum > 0 AND NOT a.attisdropped AND (a.attname LIKE '%\_hint' OR a.attname LIKE '%\_hints')
		ORDER BY 1`)
	if err != nil {
		t.Fatalf("list hint columns: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	listed := []string{"tenant_payment_config.credential_hints"}
	for _, c := range columns {
		listed = append(listed, c.table+"."+c.hint)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("list hint columns: %v", err)
		}
		if !slices.Contains(listed, name) {
			t.Errorf("%s holds hints that no run derives again", name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list hint columns: %v", err)
	}
}
