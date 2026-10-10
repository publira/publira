package platformoperators

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// seedMFA writes an authenticator for userID, confirmed when enabled, and two
// recovery codes beside it, as the superuser the test seeds with.
func seedMFA(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID, enabled bool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_user_mfa_totp (platform_user_id, secret_encrypted, enabled_at)
		VALUES ($1, 'enc:v1:k1:nonce:ciphertext', CASE WHEN $2 THEN now() END)
	`, userID, enabled); err != nil {
		t.Fatalf("insert platform_user_mfa_totp: %v", err)
	}
	for range 2 {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO platform_user_mfa_recovery_codes (id, platform_user_id, code_hash)
			VALUES ($1, $2, '$2a$10$notarealhash')
		`, uuid.Must(uuid.NewV7()), userID); err != nil {
			t.Fatalf("insert platform_user_mfa_recovery_codes: %v", err)
		}
	}
}

// mfaRows counts what userID still holds in each of the two MFA tables.
func mfaRows(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID) (totp, codes int) {
	t.Helper()
	if err := pg.DB.QueryRowContext(context.Background(), `
		SELECT (SELECT count(*) FROM platform_user_mfa_totp WHERE platform_user_id = $1),
		       (SELECT count(*) FROM platform_user_mfa_recovery_codes WHERE platform_user_id = $1)
	`, userID).Scan(&totp, &codes); err != nil {
		t.Fatalf("count mfa rows: %v", err)
	}
	return totp, codes
}

// resetMFA runs ResetMFA as publira_platform, the role publiractl connects
// as, and commits what it wrote.
func resetMFA(t *testing.T, pg *testutil.PostgresEnv, p ResetMFAParams) (dbmodels.PlatformUser, error) {
	t.Helper()
	ctx := context.Background()
	tx, err := pg.OpenPlatformDB(t).BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	operator, err := ResetMFA(ctx, tx, slog.Default(), auditlog.SystemPlatformActor, p)
	if err != nil {
		return dbmodels.PlatformUser{}, err
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return operator, nil
}

func TestResetMFARemovesTheAuthenticatorAndEveryRecoveryCode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	operator := pg.SeedPlatformSuperAdmin(t, "PLATRESET01", "operator@example.com", "Operator")
	other := pg.SeedPlatformOperator(t, "PLATRESET02", "other@example.com", "Other")
	seedMFA(t, pg, operator.ID, true)
	seedMFA(t, pg, other.ID, true)

	got, err := resetMFA(t, pg, ResetMFAParams{Email: " Operator@Example.com "})
	if err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if got.ID != operator.ID || got.PublicID != "PLATRESET01" {
		t.Fatalf("operator = %s (%s), want the one the address names", got.PublicID, got.ID)
	}
	if totp, codes := mfaRows(t, pg, operator.ID); totp != 0 || codes != 0 {
		t.Fatalf("operator's mfa rows = %d authenticator, %d recovery codes; want none", totp, codes)
	}
	if totp, codes := mfaRows(t, pg, other.ID); totp != 1 || codes != 2 {
		t.Fatalf("other operator's mfa rows = %d authenticator, %d recovery codes; want them untouched", totp, codes)
	}

	var actorID uuid.UUID
	var actorRole, action, targetType, targetID, outcome string
	if err := pg.DB.QueryRowContext(context.Background(), `
		SELECT actor_platform_user_id, actor_role, action, target_type, target_id, outcome FROM platform_audit_logs
	`).Scan(&actorID, &actorRole, &action, &targetType, &targetID, &outcome); err != nil {
		t.Fatalf("read platform_audit_logs: %v", err)
	}
	if actorID != uuid.Nil || actorRole != auditlog.RoleSystem || action != "operator_mfa_reset" || targetType != "operator" || targetID != operator.ID.String() || outcome != auditlog.OutcomeSuccess {
		t.Fatalf("audit entry = actor %v %s, %s on %s %s, %s; want the system actor's operator_mfa_reset naming the operator", actorID, actorRole, action, targetType, targetID, outcome)
	}
}

// An enrollment that was started and never confirmed is removed as well, and a
// suspended operator may be named, so the factor is not asked for again the
// day the account is reactivated.
func TestResetMFARemovesASuspendedOperatorsUnconfirmedEnrollment(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	operator := pg.SeedPlatformOperator(t, "PLATRESET01", "operator@example.com", "Operator")
	seedMFA(t, pg, operator.ID, false)
	if _, err := pg.DB.ExecContext(context.Background(), `UPDATE platform_users SET status = 'suspended' WHERE id = $1`, operator.ID); err != nil {
		t.Fatalf("suspend operator: %v", err)
	}

	if _, err := resetMFA(t, pg, ResetMFAParams{UserPublicID: "PLATRESET01"}); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	if totp, codes := mfaRows(t, pg, operator.ID); totp != 0 || codes != 0 {
		t.Fatalf("mfa rows = %d authenticator, %d recovery codes; want none", totp, codes)
	}
}

func TestResetMFARefusals(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedPlatformOperator(t, "PLATRESET01", "operator@example.com", "Operator")

	for _, tc := range []struct {
		name string
		p    ResetMFAParams
		want error
	}{
		{name: "nobody named", p: ResetMFAParams{}, want: ErrUserOrEmailRequired},
		{name: "named twice", p: ResetMFAParams{UserPublicID: "PLATRESET01", Email: "operator@example.com"}, want: ErrUserAndEmailBothSet},
		{name: "a malformed address", p: ResetMFAParams{Email: "nobody"}, want: ErrInvalidEmail},
		{name: "nothing set up", p: ResetMFAParams{UserPublicID: "PLATRESET01"}, want: ErrMFANotSetUp},
		{name: "no such operator", p: ResetMFAParams{Email: "nobody@example.com"}, want: ErrOperatorNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := resetMFA(t, pg, tc.p); !errors.Is(err, tc.want) {
				t.Fatalf("ResetMFA = %v, want %v", err, tc.want)
			}
		})
	}

	var entries int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM platform_audit_logs`).Scan(&entries); err != nil {
		t.Fatalf("count platform_audit_logs: %v", err)
	}
	if entries != 0 {
		t.Fatalf("audit entries after refusals = %d, want none", entries)
	}
}
