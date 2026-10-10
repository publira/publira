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
