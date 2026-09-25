package main

import (
	"bytes"
	"context"
	"database/sql"
	"strconv"
	"strings"
	"testing"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

// smtpCommand runs one smtp command against the database PUBLIRA_PLATFORM_DB_URL
// names, and returns its exit code and what it printed.
func smtpCommand(t *testing.T, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&smtpGroup, args, pipedConsole(stdin, &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustSMTPCommand(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	code, stdout, stderr := smtpCommand(t, stdin, args...)
	if code != 0 {
		t.Fatalf("smtp %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

// smtpSetArgs saves the plaintext server at host:port.
func smtpSetArgs(server *testutil.SMTPServer, extra ...string) []string {
	return append([]string{
		"set",
		"--host", server.Host,
		"--port", strconv.Itoa(int(server.Port)),
		"--encryption", "none",
		"--username", "mailer",
		"--from-address", "no-reply@example.com",
	}, extra...)
}

func storedSMTPPassword(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	var encrypted string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT password_encrypted FROM platform_smtp_config`).Scan(&encrypted); err != nil {
		t.Fatalf("read platform_smtp_config: %v", err)
	}
	cfg, err := config.New()
	if err != nil {
		t.Fatalf("config.New: %v", err)
	}
	servers, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := servers.DecryptString(encrypted)
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	return password
}

func TestSMTPSetKeepsThePasswordAndShowNeverPrintsIt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	server := testutil.StartSMTPServer(t)

	if got := mustSMTPCommand(t, "", "show"); got != "No SMTP settings are saved\n" {
		t.Fatalf("show before a save = %q", got)
	}
	if got := mustSMTPCommand(t, testSecretValue+"\n", smtpSetArgs(server, "--password-stdin")...); got != "Saved the SMTP settings for "+server.Host+":"+strconv.Itoa(int(server.Port))+", revision 1\n" {
		t.Fatalf("set = %q", got)
	}
	// No --password-stdin and no terminal to prompt on keeps the saved one.
	mustSMTPCommand(t, "", smtpSetArgs(server, "--reply-to", "support@example.com")...)
	if got := storedSMTPPassword(t, pg); got != testSecretValue {
		t.Fatalf("stored password = %q, want the one saved first", got)
	}

	show := mustSMTPCommand(t, "", "show")
	if strings.Contains(show, testSecretValue) {
		t.Fatalf("show printed the password:\n%s", show)
	}
	for _, want := range []string{
		"Host:          " + server.Host + "\n",
		"Encryption:    none\n",
		"Password:      saved\n",
		"Reply-To:      support@example.com\n",
		"Revision:      2\n",
	} {
		if !strings.Contains(show, want) {
			t.Fatalf("show = \n%s\nwant a line %q", show, want)
		}
	}
	if got := platformActions(t, pg); got != "platform_email_settings_updated,platform_email_settings_updated" {
		t.Fatalf("audit actions = %s", got)
	}
}

// A refusal names the flag the Connect adapter names as a field, and nothing is
// written.
func TestSMTPSetNamesTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	valid := map[string]string{
		"--host": "smtp.example.com", "--port": "587", "--encryption": "starttls",
		"--username": "mailer", "--from-address": "no-reply@example.com",
	}
	args := func(overrides ...string) []string {
		values := map[string]string{}
		for k, v := range valid {
			values[k] = v
		}
		for i := 0; i < len(overrides); i += 2 {
			values[overrides[i]] = overrides[i+1]
		}
		out := []string{"set"}
		for _, flag := range []string{"--host", "--port", "--encryption", "--username", "--from-address", "--reply-to"} {
			if v, ok := values[flag]; ok {
				out = append(out, flag, v)
			}
		}
		return out
	}

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "missing host", args: args("--host", ""), want: "publiractl: --host: host is required\n"},
		{name: "port out of range", args: args("--port", "70000"), want: "publiractl: --port: port must be between 1 and 65535\n"},
		{name: "unknown encryption", args: args("--encryption", "ssl"), want: "publiractl: --encryption: encryption must be one of tls, starttls, none\n"},
		{name: "missing username", args: args("--username", ""), want: "publiractl: --username: username is required\n"},
		{name: "malformed sender", args: args("--from-address", "nobody"), want: "publiractl: --from-address: from_address must be a valid email address\n"},
		{name: "malformed reply-to", args: args("--reply-to", "nobody"), want: "publiractl: --reply-to: reply_to must be a valid email address\n"},
		{name: "no password to keep", args: args(), want: "publiractl: --password-stdin: password is required\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, _, stderr := smtpCommand(t, "", tc.args...)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
			}
			if stderr != tc.want {
				t.Fatalf("stderr = %q, want %q", stderr, tc.want)
			}
		})
	}

	code, _, stderr := smtpCommand(t, "", args("--port", "twenty-five")...)
	if code != 2 || !strings.HasPrefix(stderr, `publiractl: invalid value "twenty-five" for flag --port:`) {
		t.Fatalf("a malformed port: exit code = %d, stderr = %q; want a usage error naming --port", code, stderr)
	}

	var rows int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM platform_smtp_config`).Scan(&rows); err != nil {
		t.Fatalf("count platform_smtp_config: %v", err)
	}
	if rows != 0 {
		t.Fatalf("platform_smtp_config rows = %d, want none", rows)
	}
}

func TestSMTPTestSendsTheTestMessageThroughTheSavedSettings(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	server := testutil.StartSMTPServer(t)

	code, _, stderr := smtpCommand(t, "", "test", "--to", "operator@example.com")
	if code != 1 || stderr != "publiractl: platform SMTP settings are not saved\n" {
		t.Fatalf("test before a save: exit code = %d, stderr = %q", code, stderr)
	}

	mustSMTPCommand(t, testSecretValue, smtpSetArgs(server, "--password-stdin")...)
	if got := mustSMTPCommand(t, "", "test", "--to", "operator@example.com"); got != "Sent the test message to operator@example.com\n" {
		t.Fatalf("test = %q", got)
	}
	messages := server.Messages()
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(messages))
	}
	for _, want := range []string{"From: no-reply@example.com\r\n", "To: operator@example.com\r\n", "Subject: Publira SMTP test\r\n", "Publira SMTP connection test message."} {
		if !strings.Contains(messages[0], want) {
			t.Fatalf("message = %q, want %q in it", messages[0], want)
		}
	}

	code, _, stderr = smtpCommand(t, "", "test", "--to", "nobody")
	if code != 1 || stderr != "publiractl: --to: invalid recipient\n" {
		t.Fatalf("a malformed --to: exit code = %d, stderr = %q", code, stderr)
	}
}

func TestSMTPTestExitsOneWhenTheServerRefuses(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	// Nothing listens on the loopback's port 1, so the connection is refused.
	mustSMTPCommand(t, testSecretValue, "set", "--host", "127.0.0.1", "--port", "1", "--encryption", "none",
		"--username", "mailer", "--from-address", "no-reply@example.com", "--password-stdin")

	code, _, stderr := smtpCommand(t, "", "test", "--to", "operator@example.com")
	// The audit entry's log line precedes the failure on stderr.
	if code != 1 || !strings.Contains(stderr, "\npubliractl: the test message was not sent (SMTP_TEST_CONNECTION): ") {
		t.Fatalf("exit code = %d, stderr = %q; want the connection failure", code, stderr)
	}
	var outcome, reason string
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT outcome, reason FROM platform_audit_logs WHERE action = 'platform_smtp_test_email_sent'`,
	).Scan(&outcome, &reason); err != nil {
		t.Fatalf("read the test's audit entry: %v", err)
	}
	if outcome != "failure" || reason != "SMTP_TEST_CONNECTION" {
		t.Fatalf("audit entry = %s (%s), want a connection failure", outcome, reason)
	}
}

type invitationRenderer struct{}

func (invitationRenderer) Render(context.Context, emailrenderer.Request) (emailrenderer.Email, error) {
	return emailrenderer.Email{HTML: "<p>Invitation</p>"}, nil
}

// The worker resolves the platform's settings for every mail it sends, so a
// handler built before a save sends the next mail through what was saved.
func TestSMTPSetReachesARunningWorker(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	first, second := testutil.StartSMTPServer(t), testutil.StartSMTPServer(t)

	mustSMTPCommand(t, testSecretValue, smtpSetArgs(first, "--password-stdin")...)
	tenantCommand(t, "", "create", "--name", "Example Comics", "--domain", "comics.example.com", "--default-locale", "en",
		"--initial-admin-email", "owner@comics.example.com", "--initial-admin-email", "editor@comics.example.com")

	cfg, err := config.New()
	if err != nil {
		t.Fatalf("config.New: %v", err)
	}
	encryptor, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	db := pg.OpenOutboxDB(t)
	handler := outbox.NewTenantAdminInvitationHandler(outbox.EmailHandlerConfig{
		DB: db, Encryptor: encryptor, Mailer: internalsmtp.NewClient(), Renderer: invitationRenderer{},
	})
	events := invitationEvents(t, pg.DB)

	if err := handler(context.Background(), events[0]); err != nil {
		t.Fatalf("deliver the first invitation: %v", err)
	}
	mustSMTPCommand(t, "", smtpSetArgs(second)...)
	if err := handler(context.Background(), events[1]); err != nil {
		t.Fatalf("deliver the second invitation: %v", err)
	}

	if len(first.Messages()) != 1 || len(second.Messages()) != 1 {
		t.Fatalf("messages = %d on the first server and %d on the second, want one each", len(first.Messages()), len(second.Messages()))
	}
	if !strings.Contains(second.Messages()[0], "To: editor@comics.example.com\r\n") {
		t.Fatalf("the second server got %q, want the second invitation", second.Messages()[0])
	}
}

func invitationEvents(t *testing.T, db *sql.DB) []dbmodels.OutboxEvent {
	t.Helper()
	rows, err := db.QueryContext(context.Background(),
		`SELECT id, tenant_id, event_type, payload, idempotency_key FROM outbox_events WHERE event_type = $1 ORDER BY created_at, id`,
		outbox.EventTypeTenantAdminInvitationEmail)
	if err != nil {
		t.Fatalf("read outbox_events: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var events []dbmodels.OutboxEvent
	for rows.Next() {
		var e dbmodels.OutboxEvent
		if err := rows.Scan(&e.ID, &e.TenantID, &e.EventType, &e.Payload, &e.IdempotencyKey); err != nil {
			t.Fatalf("scan outbox_events: %v", err)
		}
		events = append(events, e)
	}
	if len(events) != 2 {
		t.Fatalf("invitation events = %d, want 2", len(events))
	}
	return events
}

func TestSMTPSetHelpSaysABlankPasswordKeepsTheSavedOne(t *testing.T) {
	code, _, stderr := smtpCommand(t, "", "set", "--help")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	for _, want := range []string{"\n  --port number\n", "\n  --password-stdin\n", "The saved SMTP password is kept when it is left blank at the prompt"} {
		if !strings.Contains(stderr, want) {
			t.Fatalf("usage = %q, want %q in it", stderr, want)
		}
	}
}
