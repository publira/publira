package main

import (
	"bytes"
	"encoding/base64"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// A set command repeated with the values already saved, a secret given again
// included, leaves the row's revision where it was and files nothing; a changed
// secret still writes.
func TestRepeatingASetCommandChangesNoRow(t *testing.T) {
	pg := startPlatformDB(t)
	setEncryptionKeys(t)

	revision := func(table string) int {
		t.Helper()
		return countPlatformRows(t, pg, `SELECT revision FROM `+table)
	}
	entries := func(action string) int {
		t.Helper()
		return countPlatformRows(t, pg, `SELECT count(*) FROM platform_audit_logs WHERE action = '`+action+`'`)
	}

	storage := []string{"set", "--bucket", "publira-objects", "--region", "us-east-1", "--endpoint", "https://s3.example.com", "--access-key-id", "AKIAEXAMPLE", "--secret-access-key-stdin"}
	mustStorageCommand(t, testSecretValue, storage...)
	mustStorageCommand(t, testSecretValue, storage...)
	if got, want := revision("platform_storage_config"), 1; got != want {
		t.Fatalf("storage revision = %d, want %d", got, want)
	}
	mustStorageCommand(t, "another-secret", storage...)
	if got, want := revision("platform_storage_config"), 2; got != want {
		t.Fatalf("storage revision after a new secret = %d, want %d", got, want)
	}

	smtp := smtpSetArgs(&testutil.SMTPServer{Host: "smtp.example.com", Port: 587}, "--password-stdin")
	mustSMTPCommand(t, testSecretValue, smtp...)
	mustSMTPCommand(t, testSecretValue, smtp...)
	if got, want := revision("platform_smtp_config"), 1; got != want {
		t.Fatalf("smtp revision = %d, want %d", got, want)
	}
	mustSMTPCommand(t, "another-secret", smtp...)
	if got, want := revision("platform_smtp_config"), 2; got != want {
		t.Fatalf("smtp revision after a new password = %d, want %d", got, want)
	}

	mustWebPushCommand(t, "init", "--subject", "mailto:push@example.com")
	mustWebPushCommand(t, "init", "--subject", " mailto:push@example.com ")
	if got, want := entries("platform_webpush_subject_updated"), 1; got != want {
		t.Fatalf("web push entries = %d, want %d", got, want)
	}

	mustPolicyCommand(t, "set", "--comment-post-per-minute", "3")
	mustPolicyCommand(t, "set", "--comment-post-per-minute", "3")
	if got, want := revision("platform_policy_config"), 1; got != want {
		t.Fatalf("policy revision = %d, want %d", got, want)
	}

	mustRetentionCommand(t, "set", "--content-event-days", "30")
	mustRetentionCommand(t, "set", "--content-event-days", "30")
	if got, want := revision("platform_retention_config"), 1; got != want {
		t.Fatalf("retention revision = %d, want %d", got, want)
	}

	for action, want := range map[string]int{
		"platform_storage_settings_updated":   2,
		"platform_email_settings_updated":     2,
		"platform_policy_updated":             1,
		"platform_retention_defaults_updated": 1,
	} {
		if got := entries(action); got != want {
			t.Fatalf("%s entries = %d, want %d", action, got, want)
		}
	}
}

// After a key rotation, saving the same password again is how it gets
// re-encrypted under the new primary key, so that save still writes.
func TestRepeatingASecretAfterAKeyRotationReEncryptsIt(t *testing.T) {
	pg := startPlatformDB(t)
	setEncryptionKeys(t)
	smtp := smtpSetArgs(&testutil.SMTPServer{Host: "smtp.example.com", Port: 587}, "--password-stdin")
	mustSMTPCommand(t, testSecretValue, smtp...)

	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", "k1:"+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))+
		",k2:"+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k2")
	mustSMTPCommand(t, testSecretValue, smtp...)

	if got := countPlatformRows(t, pg, `SELECT revision FROM platform_smtp_config`); got != 2 {
		t.Fatalf("revision after re-storing under the new key = %d, want 2", got)
	}
	if got := countPlatformRows(t, pg, `SELECT count(*) FROM platform_smtp_config WHERE password_encrypted LIKE 'enc:v1:k2:%'`); got != 1 {
		t.Fatal("the password is not sealed with the new primary key")
	}
	if got := storedSMTPPassword(t, pg); got != testSecretValue {
		t.Fatalf("stored password = %q", got)
	}
}
