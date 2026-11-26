package main

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func TestDBRehintRefusesWithoutDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_DB_URL", "")
	setResealKeys(t, "k1", "k1")
	code, _, stderr := dbCommand(t, "rehint")
	if code != 1 || !strings.Contains(stderr, "PUBLIRA_DB_URL is not set") {
		t.Fatalf("exit code = %d, want 1 naming PUBLIRA_DB_URL\n%s", code, stderr)
	}
}

// An operator upgrading an install runs it once to bring the hints an earlier
// release stored in line with what a save stores now.
func TestDBRehintWritesTheHintsAgain(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_DB_URL", pg.URL)
	ctx := context.Background()
	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")

	sealer := setResealKeys(t, "k1", "k1")
	sealed, err := sealer.EncryptString("my_webhook_token_2026")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	endpoint := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', $3, 'my_webhook_token_••••', ARRAY['purchase.completed'])`,
		endpoint, tenant.ID, sealed); err != nil {
		t.Fatalf("seed tenant_webhook_endpoints: %v", err)
	}

	code, stdout, stderr := dbCommand(t, "rehint", "--dry-run")
	if code != 0 {
		t.Fatalf("rehint --dry-run: exit code = %d\n%s", code, stderr)
	}
	if want := "TABLE                     TO REWRITE  CURRENT  UNREADABLE\ntenant_webhook_endpoints  1           0        0\n"; stdout != want {
		t.Fatalf("rehint --dry-run printed\n%s\nwant\n%s", stdout, want)
	}
	code, stdout, stderr = dbCommand(t, "rehint")
	if code != 0 {
		t.Fatalf("rehint: exit code = %d\n%s", code, stderr)
	}
	if want := "TABLE                     REWRITTEN  CURRENT  UNREADABLE\ntenant_webhook_endpoints  1          0        0\n"; stdout != want {
		t.Fatalf("rehint printed\n%s\nwant\n%s", stdout, want)
	}
	var hint string
	if err := pg.DB.QueryRowContext(ctx, `SELECT secret_hint FROM tenant_webhook_endpoints WHERE id = $1`, endpoint).Scan(&hint); err != nil {
		t.Fatalf("read tenant_webhook_endpoints: %v", err)
	}
	if hint != "••••••••2026" {
		t.Fatalf("hint = %q, want ••••••••2026", hint)
	}
}

func TestDBRehintExitsOneOnASecretNoKeyOpens(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_DB_URL", pg.URL)
	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")

	sealed, err := setResealKeys(t, "k0", "k0").EncryptString("whsec_abcdefghijklmnopqrstuvwxyz")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := pg.DB.ExecContext(context.Background(), `INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://crm.example.com/publira', $3, 'whsec_••••••••wxyz', ARRAY['purchase.completed'])`,
		uuid.Must(uuid.NewV7()), tenant.ID, sealed); err != nil {
		t.Fatalf("seed tenant_webhook_endpoints: %v", err)
	}

	setResealKeys(t, "k1", "k1")
	code, stdout, stderr := dbCommand(t, "rehint")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
	}
	if want := "TABLE                     REWRITTEN  CURRENT  UNREADABLE\ntenant_webhook_endpoints  0          0        1\n"; stdout != want {
		t.Fatalf("rehint printed\n%s\nwant\n%s", stdout, want)
	}
	for _, want := range []string{"tenant_webhook_endpoints", "1 hints were left as they are"} {
		if !strings.Contains(stderr, want) {
			t.Fatalf("stderr does not name %q:\n%s", want, stderr)
		}
	}
}
