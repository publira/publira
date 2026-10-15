package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// seedMFA writes an authenticator for userID, confirmed when enabled, and two
// recovery codes beside it, as the superuser the test seeds with.
func seedMFA(t *testing.T, pg *testutil.PostgresEnv, tenantID, userID uuid.UUID, enabled bool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted, enabled_at)
		VALUES ($1, $2, 'enc:v1:k1:nonce:ciphertext', CASE WHEN $3 THEN now() END)
	`, userID, tenantID, enabled); err != nil {
		t.Fatalf("insert user_mfa_totp: %v", err)
	}
	for range 2 {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO user_mfa_recovery_codes (id, tenant_id, user_id, code_hash)
			VALUES ($1, $2, $3, '$2a$10$notarealhash')
		`, uuid.Must(uuid.NewV7()), tenantID, userID); err != nil {
			t.Fatalf("insert user_mfa_recovery_codes: %v", err)
		}
	}
}

// mfaRows counts what userID still holds in each of the two MFA tables.
func mfaRows(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID) (totp, codes int) {
	t.Helper()
	if err := pg.DB.QueryRowContext(context.Background(), `
		SELECT (SELECT count(*) FROM user_mfa_totp WHERE user_id = $1),
		       (SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1)
	`, userID).Scan(&totp, &codes); err != nil {
		t.Fatalf("count mfa rows: %v", err)
	}
	return totp, codes
}

func TestResetMFARemovesTheAuthenticatorAndEveryRecoveryCode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "TAADMIN", "admin@tenant-a.example.com", "Admin")
	other := pg.SeedTenantAdmin(t, tenant.ID, "TAOTHER", "other@tenant-a.example.com", "Other")
	seedMFA(t, pg, tenant.ID, admin.ID, true)
	seedMFA(t, pg, tenant.ID, other.ID, true)

	var member Member
	if err := inPlatformTx(t, pg, func(tx *sql.Tx) (err error) {
		member, err = ResetMFA(context.Background(), tx, ResetMFAParams{TenantID: tenant.ID, Email: " Admin@Tenant-A.example.com "})
		return err
	}); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if member.UserID != admin.ID || member.PublicID != "TAADMIN" {
		t.Fatalf("member = %+v, want the admin the address names", member)
	}
	if totp, codes := mfaRows(t, pg, admin.ID); totp != 0 || codes != 0 {
		t.Fatalf("admin's mfa rows = %d authenticator, %d recovery codes; want none", totp, codes)
	}
	if totp, codes := mfaRows(t, pg, other.ID); totp != 1 || codes != 2 {
		t.Fatalf("other admin's mfa rows = %d authenticator, %d recovery codes; want them untouched", totp, codes)
	}
}

// An enrollment that was started and never confirmed is removed as well, so
// the next one starts from nothing.
func TestResetMFARemovesAnUnconfirmedEnrollment(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "TAADMIN", "admin@tenant-a.example.com", "Admin")
	seedMFA(t, pg, tenant.ID, admin.ID, false)

	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := ResetMFA(context.Background(), tx, ResetMFAParams{TenantID: tenant.ID, UserPublicID: "TAADMIN"})
		return err
	}); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if totp, codes := mfaRows(t, pg, admin.ID); totp != 0 || codes != 0 {
		t.Fatalf("mfa rows = %d authenticator, %d recovery codes; want none", totp, codes)
	}
}

func TestResetMFARefusals(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	otherTenant := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	pg.SeedTenantAdmin(t, tenant.ID, "TAADMIN", "admin@tenant-a.example.com", "Admin")
	outsider := pg.SeedTenantAdmin(t, otherTenant.ID, "TBADMIN", "admin@tenant-b.example.com", "Admin")
	seedMFA(t, pg, otherTenant.ID, outsider.ID, true)

	for _, tc := range []struct {
		name string
		p    ResetMFAParams
		want error
	}{
		{name: "nobody named", p: ResetMFAParams{TenantID: tenant.ID}, want: ErrUserOrEmailRequired},
		{name: "named twice", p: ResetMFAParams{TenantID: tenant.ID, UserPublicID: "TAADMIN", Email: "admin@tenant-a.example.com"}, want: ErrUserAndEmailBothSet},
		{name: "nothing set up", p: ResetMFAParams{TenantID: tenant.ID, UserPublicID: "TAADMIN"}, want: ErrMFANotSetUp},
		{name: "another tenant's user", p: ResetMFAParams{TenantID: tenant.ID, UserPublicID: "TBADMIN"}, want: ErrMemberNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
				_, err := ResetMFA(context.Background(), tx, tc.p)
				return err
			})
			if !errors.Is(err, tc.want) {
				t.Fatalf("ResetMFA = %v, want %v", err, tc.want)
			}
		})
	}
	if totp, codes := mfaRows(t, pg, outsider.ID); totp != 1 || codes != 2 {
		t.Fatalf("other tenant's mfa rows = %d authenticator, %d recovery codes; want them untouched", totp, codes)
	}
}

// seedPasskey writes a passkey for userID registered for rpID, as the
// superuser the test seeds with.
func seedPasskey(t *testing.T, pg *testutil.PostgresEnv, tenantID, userID uuid.UUID, publicID, rpID string) {
	t.Helper()
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO user_webauthn_credentials (
			id, public_id, tenant_id, user_id, rp_id, credential_id, public_key, aaguid, backup_eligible, backed_up
		) VALUES ($1, $2, $3, $4, $5, $6, '\x00', '00000000-0000-0000-0000-000000000000', false, false)
	`, uuid.Must(uuid.NewV7()), publicID, tenantID, userID, rpID, []byte(publicID)); err != nil {
		t.Fatalf("insert user_webauthn_credentials: %v", err)
	}
}

func countRows(t *testing.T, pg *testutil.PostgresEnv, query string, args ...any) int {
	t.Helper()
	var count int
	if err := pg.DB.QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

// An account whose only factor is a passkey is reset like one with an
// authenticator. The tenant's console is served outside its storefront's
// domain, so a passkey registered for the storefront is no factor of the
// console's and stays; the count of refused attempts goes with the factors.
func TestResetMFARemovesTheConsolePasskeysAndTheLock(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "TAADMIN", "admin@tenant-a.example.com", "Admin")
	seedPasskey(t, pg, tenant.ID, admin.ID, "PASSKEY00001", "admin-tenant-a.example.com")
	seedPasskey(t, pg, tenant.ID, admin.ID, "PASSKEY00002", "tenant-a.example.com")
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO user_mfa_lockouts (user_id, tenant_id, failed_attempts, locked_until)
		VALUES ($1, $2, 0, now() + interval '15 minutes')
	`, admin.ID, tenant.ID); err != nil {
		t.Fatalf("insert user_mfa_lockouts: %v", err)
	}

	if err := inPlatformTx(t, pg, func(tx *sql.Tx) error {
		_, err := ResetMFA(context.Background(), tx, ResetMFAParams{TenantID: tenant.ID, UserPublicID: "TAADMIN"})
		return err
	}); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if got := countRows(t, pg, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1 AND rp_id = 'admin-tenant-a.example.com'", admin.ID); got != 0 {
		t.Fatalf("console passkeys = %d, want none", got)
	}
	if got := countRows(t, pg, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1 AND rp_id = 'tenant-a.example.com'", admin.ID); got != 1 {
		t.Fatalf("storefront passkeys = %d, want the one untouched", got)
	}
	if got := countRows(t, pg, "SELECT count(*) FROM user_mfa_lockouts WHERE user_id = $1", admin.ID); got != 0 {
		t.Fatalf("lockout rows = %d, want none", got)
	}
}
