package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// seedReaderAuthenticator leaves user with a confirmed authenticator and its
// recovery codes, as an enrollment on the site does.
func seedReaderAuthenticator(t *testing.T, env *adminDBEnv, tenantID uuid.UUID, user testutil.TenantUser) {
	t.Helper()
	ctx := context.Background()
	q := dbmodels.New(env.PG.DB)
	if _, err := q.UpsertUserMfaTotpSecret(ctx, dbmodels.UpsertUserMfaTotpSecretParams{UserID: user.ID, TenantID: tenantID, SecretEncrypted: "sealed"}); err != nil {
		t.Fatalf("store the authenticator: %v", err)
	}
	if _, err := q.EnableUserMfaTotp(ctx, user.ID); err != nil {
		t.Fatalf("enable the authenticator: %v", err)
	}
	for range mfa.RecoveryCodeCount {
		if err := q.CreateUserMfaRecoveryCode(ctx, dbmodels.CreateUserMfaRecoveryCodeParams{ID: uuid.Must(uuid.NewV7()), TenantID: tenantID, UserID: user.ID, CodeHash: "hash"}); err != nil {
			t.Fatalf("store a recovery code: %v", err)
		}
	}
	if _, err := q.RecordUserMfaFailure(ctx, dbmodels.RecordUserMfaFailureParams{UserID: user.ID, TenantID: tenantID, MaxFailedAttempts: mfa.MaxFailedAttempts}); err != nil {
		t.Fatalf("count a refused code: %v", err)
	}
}

func (e *adminDBEnv) resetReaderMfa(admin adminDBTenant, readerID string) (*publiraadminv1.ResetReaderMfaResponse, error) {
	return e.userClient().ResetReaderMfa(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.ResetReaderMfaRequest{
		Tenant:   admin.tenantContext(),
		ReaderId: readerID,
	})
}

// The acceptance criterion: a Tenant admin removes a reader's two-step
// verification, which leaves the account behind its password alone, and the
// removal is audited.
func TestDBAdminResetReaderMfaRemovesEveryFactor(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RMFTENANT001", "reader-mfa.example.com", "Reader MFA", "RMFADMIN0001", "admin@reader-mfa.example.com")
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, "RMFREADER001", "reader@reader-mfa.example.com", "Reader")
	seedReaderAuthenticator(t, env, admin.Tenant.ID, reader)

	reset, err := env.resetReaderMfa(admin, reader.ID.String())
	if err != nil {
		t.Fatalf("ResetReaderMfa: %v", err)
	}
	if reset.Reader.GetPublicId() != reader.PublicID {
		t.Fatalf("ResetReaderMfa = %+v, want the reader", reset.Reader)
	}
	for table, query := range map[string]string{
		"user_mfa_totp":           "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1",
		"user_mfa_recovery_codes": "SELECT count(*) FROM user_mfa_recovery_codes WHERE user_id = $1",
		"user_mfa_lockouts":       "SELECT count(*) FROM user_mfa_lockouts WHERE user_id = $1",
	} {
		if got := env.countRows(t, query, reader.ID); got != 0 {
			t.Fatalf("%s rows after the reset = %d, want 0", table, got)
		}
	}
	logs := env.readerAuditLogs(t, admin)
	if len(logs) != 1 {
		t.Fatalf("audit log count = %d, want 1 (%+v)", len(logs), logs)
	}
	assertReaderAuditLog(t, logs[0], "reader_mfa_reset", admin, reader.PublicID)

	// Nothing is left to remove.
	if _, err := env.resetReaderMfa(admin, reader.ID.String()); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ResetReaderMfa with nothing set up = %v, want failed_precondition", err)
	}
	if logs := env.readerAuditLogs(t, admin); len(logs) != 1 {
		t.Fatalf("audit log count after the refusal = %d, want 1", len(logs))
	}
}

// A Tenant admin's own factor comes off through DisableMfa, with a code: a
// stolen session must not be able to take it away.
func TestDBAdminResetReaderMfaRefusesTheCallersOwnAccount(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RMOTENANT001", "reader-mfa-own.example.com", "Own", "RMOADMIN0001", "admin@reader-mfa-own.example.com")
	seedReaderAuthenticator(t, env, admin.Tenant.ID, testutil.TenantUser{ID: admin.User.ID})

	_, err := env.resetReaderMfa(admin, admin.User.ID.String())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoReason(t, err) != rpcerrors.ReasonOwnAccount {
		t.Fatalf("ResetReaderMfa of the caller = %v, want failed_precondition with %s", err, rpcerrors.ReasonOwnAccount)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", admin.User.ID); got != 1 {
		t.Fatalf("authenticators after the refusal = %d, want the caller's kept", got)
	}
}

// A member of staff is one of the readers, and the reset takes the passkeys
// they registered in the console as well, as publiractl's does.
func TestDBAdminResetReaderMfaTakesAStaffAccountsConsolePasskeys(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RMSTENANT001", "reader-mfa-staff.example.com", "Staff", "RMSADMIN0001", "admin@reader-mfa-staff.example.com")
	editor := env.PG.SeedTenantUser(t, admin.Tenant.ID, "RMSEDITOR001", "editor@reader-mfa-staff.example.com", "Editor", auth.RoleTenantEditor)
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO user_webauthn_credentials (
			id, public_id, tenant_id, user_id, relying_party, rp_id, credential_id, public_key, sign_count, aaguid, backup_eligible, backed_up
		) VALUES (gen_random_uuid(), 'RMSPASSKEY01', $1, $2, 'admin_console', 'admin.reader-mfa-staff.example.com', '\x01', '\x01', 0, gen_random_uuid(), false, false)
	`, admin.Tenant.ID, editor.ID); err != nil {
		t.Fatalf("seed a console passkey: %v", err)
	}

	if _, err := env.resetReaderMfa(admin, editor.ID.String()); err != nil {
		t.Fatalf("ResetReaderMfa: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_webauthn_credentials WHERE user_id = $1", editor.ID); got != 0 {
		t.Fatalf("console passkeys after the reset = %d, want 0", got)
	}
}

func TestDBAdminResetReaderMfaLeavesOtherTenantsAlone(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RMXTENANT001", "reader-mfa-scope.example.com", "Scope", "RMXADMIN0001", "admin@reader-mfa-scope.example.com")
	other := env.seedTenantWithAdmin(t, "RMYTENANT001", "reader-mfa-scope-other.example.com", "Other", "RMYADMIN0001", "admin@reader-mfa-scope-other.example.com")
	outsider := env.PG.SeedEndUser(t, other.Tenant.ID, "RMYREADER001", "reader@reader-mfa-scope-other.example.com", "Outsider")
	seedReaderAuthenticator(t, env, other.Tenant.ID, outsider)

	for _, readerID := range []string{outsider.ID.String(), uuid.Must(uuid.NewV7()).String()} {
		if _, err := env.resetReaderMfa(admin, readerID); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("ResetReaderMfa %s = %v, want not_found", readerID, err)
		}
	}
	if got := env.countRows(t, "SELECT count(*) FROM user_mfa_totp WHERE user_id = $1", outsider.ID); got != 1 {
		t.Fatalf("authenticators of the other tenant's reader = %d, want it untouched", got)
	}
}
