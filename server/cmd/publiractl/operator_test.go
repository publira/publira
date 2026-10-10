package main

import (
	"bytes"
	"context"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// operatorCommand runs one operator command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func operatorCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&operatorGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func TestOperatorResetMFA(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	operator := pg.SeedPlatformSuperAdmin(t, "PLATRESET01", "operator@example.com", "Operator")
	ctx := context.Background()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_user_mfa_totp (platform_user_id, secret_encrypted, enabled_at)
		VALUES ($1, 'enc:v1:k1:nonce:ciphertext', now())
	`, operator.ID); err != nil {
		t.Fatalf("insert platform_user_mfa_totp: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_user_mfa_recovery_codes (id, platform_user_id, code_hash)
		VALUES (gen_random_uuid(), $1, '$2a$10$notarealhash')
	`, operator.ID); err != nil {
		t.Fatalf("insert platform_user_mfa_recovery_codes: %v", err)
	}

	code, stdout, stderr := operatorCommand(t, "reset-mfa", "--email", "operator@example.com")
	if code != 0 {
		t.Fatalf("operator reset-mfa: exit code = %d\n%s", code, stderr)
	}
	if stdout != "Removed two-step verification from operator@example.com (PLATRESET01)\n" {
		t.Fatalf("operator reset-mfa = %q", stdout)
	}

	var rows int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT (SELECT count(*) FROM platform_user_mfa_totp WHERE platform_user_id = $1) + (SELECT count(*) FROM platform_user_mfa_recovery_codes WHERE platform_user_id = $1)
	`, operator.ID).Scan(&rows); err != nil {
		t.Fatalf("count mfa rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("mfa rows after reset-mfa = %d, want 0", rows)
	}
	if got := platformActions(t, pg); got != "operator_mfa_reset" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestOperatorCommandsNameTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	pg.SeedPlatformOperator(t, "PLATRESET01", "operator@example.com", "Operator")

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "reset the two-step verification of no operator", args: []string{"reset-mfa"}, want: "--user or --email: user_public_id or email is required"},
		{name: "reset an operator named twice", args: []string{"reset-mfa", "--user", "PLATRESET01", "--email", "operator@example.com"}, want: "--user or --email: user_public_id and email cannot both be set"},
		{name: "reset a malformed email", args: []string{"reset-mfa", "--email", "nobody"}, want: "--email: invalid email"},
		{name: "reset an operator that does not exist", args: []string{"reset-mfa", "--user", "NOBODY"}, want: "operator not found"},
		{name: "reset two-step verification nobody set up", args: []string{"reset-mfa", "--user", "PLATRESET01"}, want: "operator has no two-step verification set up"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, _, stderr := operatorCommand(t, tc.args...)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
			}
			if want := "publiractl: " + tc.want + "\n"; stderr != want {
				t.Fatalf("stderr = %q, want %q", stderr, want)
			}
		})
	}

	if got := platformActions(t, pg); got != "" {
		t.Fatalf("audit actions = %s, want none", got)
	}
}
