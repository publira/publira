package platformsmtp_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/platformsmtp"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

func newEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{1}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func settingsFor(server *testutil.SMTPServer) emailsettings.SMTPSettings {
	return emailsettings.SMTPSettings{
		Host:        server.Host,
		Port:        server.Port,
		Username:    "mailer",
		Encryption:  "none",
		FromAddress: "no-reply@example.com",
		ReplyTo:     "support@example.com",
	}
}

// The Platform Console tests the settings on its form, and publiractl smtp test
// the saved ones; given the same settings, the server receives the same message
// from each.
func TestTheConsoleAndTheSavedSettingsSendTheSameTestMessage(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	server := testutil.StartSMTPServer(t)
	ctx := context.Background()

	if _, err := platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, platformsmtp.SaveParams{
		Settings:     settingsFor(server),
		PasswordMode: secretupdate.Replace,
		Password:     "smtp-password",
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	q := dbmodels.New(db)
	tester := platformsmtp.Tester{Encryptor: encryptor, SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, slog.Default())}
	operator := auditlog.PlatformActor{UserID: pg.SeedPlatformOperator(t, "PLATSMTP0001", "operator@example.com", "Operator").ID, Role: "platform_operator"}
	recipient, err := tester.Send(ctx, q, operator, platformsmtp.TestParams{
		Settings:      settingsFor(server),
		PasswordMode:  secretupdate.Unchanged,
		RecipientType: emailsettings.TestRecipientTypeSelf,
		SelfEmail:     "operator@example.com",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if recipient != "operator@example.com" {
		t.Fatalf("recipient = %q, want the operator's address", recipient)
	}
	if err := tester.SendSaved(ctx, q, auditlog.SystemPlatformActor, "operator@example.com"); err != nil {
		t.Fatalf("SendSaved: %v", err)
	}

	messages := server.Messages()
	if len(messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(messages))
	}
	if messages[0] != messages[1] {
		t.Fatalf("the console sent\n%q\nand the saved settings sent\n%q", messages[0], messages[1])
	}

	var entries int
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT count(*) FROM platform_audit_logs WHERE action = 'platform_smtp_test_email_sent' AND outcome = 'success'`,
	).Scan(&entries); err != nil {
		t.Fatalf("count audit entries: %v", err)
	}
	if entries != 2 {
		t.Fatalf("test entries = %d, want one per message", entries)
	}
}

// A save that states no revision writes over whatever is stored, and keeps the
// stored password when it states none.
func TestSaveWithoutARevisionWritesOverTheStoredRow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	server := testutil.StartSMTPServer(t)
	ctx := context.Background()

	save := func(p platformsmtp.SaveParams) (dbmodels.PlatformSmtpConfig, error) {
		return platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, p)
	}
	if _, err := save(platformsmtp.SaveParams{Settings: settingsFor(server), PasswordMode: secretupdate.Unchanged}); !errors.Is(err, emailsettings.ErrPasswordRequired) {
		t.Fatalf("a first save with no password: %v, want ErrPasswordRequired", err)
	}
	if _, err := save(platformsmtp.SaveParams{Settings: settingsFor(server), PasswordMode: secretupdate.Replace, Password: "smtp-password"}); err != nil {
		t.Fatalf("first Save: %v", err)
	}
	stale := int64(0)
	if _, err := save(platformsmtp.SaveParams{Settings: settingsFor(server), ExpectedRevision: &stale}); !errors.Is(err, platformsmtp.ErrConflict) {
		t.Fatalf("a save at revision 0 over revision 1: %v, want ErrConflict", err)
	}

	moved := settingsFor(server)
	moved.Host = "smtp.example.net"
	saved, err := save(platformsmtp.SaveParams{Settings: moved})
	if err != nil {
		t.Fatalf("second Save: %v", err)
	}
	if saved.Host != "smtp.example.net" || saved.Revision != 2 {
		t.Fatalf("saved = %s at revision %d, want smtp.example.net at 2", saved.Host, saved.Revision)
	}
	if password, err := encryptor.DecryptString(saved.PasswordEncrypted); err != nil || password != "smtp-password" {
		t.Fatalf("stored password = %q, %v; want the first one kept", password, err)
	}

	// The refused saves filed nothing.
	var entries int
	if err := pg.DB.QueryRowContext(ctx,
		`SELECT count(*) FROM platform_audit_logs WHERE action = 'platform_email_settings_updated'`,
	).Scan(&entries); err != nil {
		t.Fatalf("count audit entries: %v", err)
	}
	if entries != 2 {
		t.Fatalf("save entries = %d, want one per save that landed", entries)
	}
}

func TestSendSavedWithNothingSaved(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	q := dbmodels.New(pg.OpenPlatformDB(t))
	tester := platformsmtp.Tester{Encryptor: newEncryptor(t), SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, slog.Default())}

	if err := tester.SendSaved(context.Background(), q, auditlog.SystemPlatformActor, "operator@example.com"); !errors.Is(err, platformsmtp.ErrNotSaved) {
		t.Fatalf("SendSaved = %v, want ErrNotSaved", err)
	}
}
