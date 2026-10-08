package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

var (
	resealKey1 = bytes.Repeat([]byte{1}, 32)
	resealKey2 = bytes.Repeat([]byte{2}, 32)
	resealKey0 = bytes.Repeat([]byte{9}, 32)
)

// setResealKeys configures the keys keyIDs name, k0, k1, or k2, with primary
// as the one new values are sealed with.
func setResealKeys(t *testing.T, primary string, keyIDs ...string) *secretcrypto.Manager {
	t.Helper()
	material := map[string][]byte{"k0": resealKey0, "k1": resealKey1, "k2": resealKey2}
	keys := map[string][]byte{}
	var spec []string
	for _, id := range keyIDs {
		keys[id] = material[id]
		spec = append(spec, id+":"+base64.StdEncoding.EncodeToString(material[id]))
	}
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", strings.Join(spec, ","))
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", primary)
	mgr, err := secretcrypto.NewManager(keys, primary)
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return mgr
}

func dbCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&dbGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func TestDBResealRefusesWithoutDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_DB_URL", "")
	setResealKeys(t, "k1", "k1")
	code, _, stderr := dbCommand(t, "reseal")
	if code != 1 || !strings.Contains(stderr, "PUBLIRA_DB_URL is not set") {
		t.Fatalf("exit code = %d, want 1 naming PUBLIRA_DB_URL\n%s", code, stderr)
	}
}

// The rotation an operator runs: seal with k1, make k2 the primary key, reseal,
// and take k1 out of the configuration.
func TestDBResealLetsTheOldKeyBeRemoved(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_DB_URL", pg.URL)
	ctx := context.Background()
	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMIN0000001", "admin@example.com", "Admin")

	old := setResealKeys(t, "k1", "k1")
	sealed, err := old.EncryptString("TOTPSECRET")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx,
		`INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted) VALUES ($1, $2, $3)`,
		admin.ID, tenant.ID, sealed); err != nil {
		t.Fatalf("seed user_mfa_totp: %v", err)
	}

	setResealKeys(t, "k2", "k1", "k2")
	code, stdout, stderr := dbCommand(t, "reseal", "--dry-run")
	if code != 0 {
		t.Fatalf("reseal --dry-run: exit code = %d\n%s", code, stderr)
	}
	if want := "KEY ID  TO RESEAL  ON PRIMARY  UNREADABLE\nk1      1          0           0\n"; stdout != want {
		t.Fatalf("reseal --dry-run printed\n%s\nwant\n%s", stdout, want)
	}
	code, stdout, stderr = dbCommand(t, "reseal")
	if code != 0 {
		t.Fatalf("reseal: exit code = %d\n%s", code, stderr)
	}
	if want := "KEY ID  RESEALED  ON PRIMARY  UNREADABLE\nk1      1         0           0\n"; stdout != want {
		t.Fatalf("reseal printed\n%s\nwant\n%s", stdout, want)
	}

	retired := setResealKeys(t, "k2", "k2")
	code, stdout, stderr = dbCommand(t, "reseal")
	if code != 0 {
		t.Fatalf("reseal without k1: exit code = %d\n%s", code, stderr)
	}
	if want := "KEY ID        RESEALED  ON PRIMARY  UNREADABLE\nk2 (primary)  0         1           0\n"; stdout != want {
		t.Fatalf("reseal without k1 printed\n%s\nwant\n%s", stdout, want)
	}
	var stored string
	if err := pg.DB.QueryRowContext(ctx, `SELECT secret_encrypted FROM user_mfa_totp`).Scan(&stored); err != nil {
		t.Fatalf("read user_mfa_totp: %v", err)
	}
	if plaintext, err := retired.DecryptString(stored); err != nil || plaintext != "TOTPSECRET" {
		t.Fatalf("the secret opens with k2 alone as %q, %v", plaintext, err)
	}
}

func TestDBResealExitsOneOnAValueNoKeyOpens(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_DB_URL", pg.URL)
	tenant := pg.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMIN0000001", "admin@example.com", "Admin")

	lost := setResealKeys(t, "k0", "k0")
	sealed, err := lost.EncryptString("TOTPSECRET")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := pg.DB.ExecContext(context.Background(),
		`INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted) VALUES ($1, $2, $3)`,
		admin.ID, tenant.ID, sealed); err != nil {
		t.Fatalf("seed user_mfa_totp: %v", err)
	}

	setResealKeys(t, "k2", "k1", "k2")
	code, stdout, stderr := dbCommand(t, "reseal")
	if code != 1 {
		t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
	}
	if want := "KEY ID  RESEALED  ON PRIMARY  UNREADABLE\nk0      0         0           1\n"; stdout != want {
		t.Fatalf("reseal printed\n%s\nwant\n%s", stdout, want)
	}
	for _, want := range []string{"user_mfa_totp.secret_encrypted", "1 sealed values open with no configured key"} {
		if !strings.Contains(stderr, want) {
			t.Fatalf("stderr does not name %q:\n%s", want, stderr)
		}
	}
}
