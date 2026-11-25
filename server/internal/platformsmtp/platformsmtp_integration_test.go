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
	"github.com/publira/publira/server/internal/fielderr"
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

	resent := settingsFor(server)
	resent.FromAddress = "mail@example.net"
	saved, err := save(platformsmtp.SaveParams{Settings: resent})
	if err != nil {
		t.Fatalf("second Save: %v", err)
	}
	if saved.FromAddress != "mail@example.net" || saved.Revision != 2 {
		t.Fatalf("saved = %s at revision %d, want mail@example.net at 2", saved.FromAddress, saved.Revision)
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

// A relay that takes no credentials is saved with no username and no password,
// and both test sends go through it without authenticating.
func TestSettingsWithoutAUsernameSendThroughARelay(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	relay := testutil.StartSMTPRelay(t)
	ctx := context.Background()

	settings := settingsFor(relay)
	settings.Username = ""
	saved, err := platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, platformsmtp.SaveParams{Settings: settings})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Username != "" || platformsmtp.HasPassword(saved) {
		t.Fatalf("saved username %q with a password %v, want neither", saved.Username, platformsmtp.HasPassword(saved))
	}

	q := dbmodels.New(db)
	tester := platformsmtp.Tester{SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, slog.Default())}
	if _, err := tester.Send(ctx, q, auditlog.SystemPlatformActor, platformsmtp.TestParams{
		Settings:       settings,
		RecipientType:  emailsettings.TestRecipientTypeCustom,
		RecipientEmail: "operator@example.com",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := tester.SendSaved(ctx, q, auditlog.SystemPlatformActor, "operator@example.com"); err != nil {
		t.Fatalf("SendSaved: %v", err)
	}
	if got := len(relay.Messages()); got != 2 {
		t.Fatalf("messages = %d, want 2", got)
	}
}

// A password is refused without a username whether it is given with the save
// or kept from the stored row, and clearing it lets the username go.
func TestAPasswordWithoutAUsernameIsRefusedOnTheUsername(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	server := testutil.StartSMTPServer(t)
	ctx := context.Background()

	save := func(p platformsmtp.SaveParams) (dbmodels.PlatformSmtpConfig, error) {
		return platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, p)
	}
	refusedOnUsername := func(name string, err error) {
		t.Helper()
		if !errors.Is(err, emailsettings.ErrPasswordWithoutUsername) || fielderr.Field(err) != emailsettings.FieldUsername {
			t.Fatalf("%s: %v on %q, want ErrPasswordWithoutUsername on username", name, err, fielderr.Field(err))
		}
	}
	anonymous := settingsFor(server)
	anonymous.Username = ""

	_, err := save(platformsmtp.SaveParams{Settings: anonymous, PasswordMode: secretupdate.Replace, Password: "smtp-password"})
	refusedOnUsername("a password given with no username", err)

	if _, err := save(platformsmtp.SaveParams{Settings: settingsFor(server), PasswordMode: secretupdate.Replace, Password: "smtp-password"}); err != nil {
		t.Fatalf("Save with a username: %v", err)
	}
	_, err = save(platformsmtp.SaveParams{Settings: anonymous})
	refusedOnUsername("the stored password kept with no username", err)

	saved, err := save(platformsmtp.SaveParams{Settings: anonymous, PasswordMode: secretupdate.Clear})
	if err != nil {
		t.Fatalf("Save clearing the password: %v", err)
	}
	if saved.Username != "" || platformsmtp.HasPassword(saved) {
		t.Fatalf("saved username %q with a password %v, want neither", saved.Username, platformsmtp.HasPassword(saved))
	}

	q := dbmodels.New(db)
	tester := platformsmtp.Tester{Encryptor: encryptor, SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, slog.Default())}
	_, err = tester.Send(ctx, q, auditlog.SystemPlatformActor, platformsmtp.TestParams{
		Settings:       anonymous,
		PasswordMode:   secretupdate.Replace,
		Password:       "smtp-password",
		RecipientType:  emailsettings.TestRecipientTypeCustom,
		RecipientEmail: "operator@example.com",
	})
	refusedOnUsername("a test with a password and no username", err)
	if got := len(server.Messages()); got != 0 {
		t.Fatalf("messages = %d, want none", got)
	}
}

// The saved password goes only to the server it was saved for: a test that
// names another host, port, username, or encryption and states no password of
// its own is refused on the password, and no server is dialled.
func TestATestOfAnotherServerKeepsTheSavedPassword(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	saved := testutil.StartSMTPServer(t)
	elsewhere := testutil.StartSMTPServer(t)
	ctx := context.Background()

	if _, err := platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, platformsmtp.SaveParams{
		Settings:     settingsFor(saved),
		PasswordMode: secretupdate.Replace,
		Password:     "smtp-password",
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	q := dbmodels.New(db)
	tester := platformsmtp.Tester{Encryptor: encryptor, SMTP: internalsmtp.NewClient(), Recorder: auditlog.New(q, slog.Default())}
	with := func(server *testutil.SMTPServer, change func(*emailsettings.SMTPSettings)) emailsettings.SMTPSettings {
		settings := settingsFor(server)
		change(&settings)
		return settings
	}
	for _, tc := range []struct {
		name     string
		settings emailsettings.SMTPSettings
	}{
		// Both servers listen on the same address, so the host is told apart
		// by its name.
		{name: "another host", settings: with(saved, func(s *emailsettings.SMTPSettings) { s.Host = "localhost" })},
		{name: "another port", settings: with(saved, func(s *emailsettings.SMTPSettings) { s.Port = elsewhere.Port })},
		{name: "another username", settings: with(saved, func(s *emailsettings.SMTPSettings) { s.Username = "someone-else" })},
		{name: "another encryption", settings: with(saved, func(s *emailsettings.SMTPSettings) { s.Encryption = "starttls" })},
	} {
		for _, mode := range []secretupdate.Mode{secretupdate.Unspecified, secretupdate.Unchanged} {
			_, err := tester.Send(ctx, q, auditlog.SystemPlatformActor, platformsmtp.TestParams{
				Settings:       tc.settings,
				PasswordMode:   mode,
				RecipientType:  emailsettings.TestRecipientTypeCustom,
				RecipientEmail: "operator@example.com",
			})
			if !errors.Is(err, emailsettings.ErrServerChanged) || fielderr.Field(err) != emailsettings.FieldPassword {
				t.Fatalf("%s, mode %d: Send = %v on %q, want ErrServerChanged on password", tc.name, mode, err, fielderr.Field(err))
			}
		}
	}
	for name, server := range map[string]*testutil.SMTPServer{"the saved server": saved, "the other server": elsewhere} {
		if logins, messages := server.Logins(), server.Messages(); len(logins) != 0 || len(messages) != 0 {
			t.Fatalf("%s saw %d logins and %d messages, want none", name, len(logins), len(messages))
		}
	}

	// A password of its own is sent where the test names.
	if _, err := tester.Send(ctx, q, auditlog.SystemPlatformActor, platformsmtp.TestParams{
		Settings:       settingsFor(elsewhere),
		PasswordMode:   secretupdate.Replace,
		Password:       "its-own-password",
		RecipientType:  emailsettings.TestRecipientTypeCustom,
		RecipientEmail: "operator@example.com",
	}); err != nil {
		t.Fatalf("Send with a password of its own: %v", err)
	}
	if logins := elsewhere.Logins(); len(logins) != 1 || logins[0].Password != "its-own-password" {
		t.Fatalf("logins = %+v, want one with the stated password", logins)
	}
}

// A save keeps the saved password only for the server it was saved for: one
// that names another host, port, username, or encryption and states no
// password is refused on the password and leaves the row as it was, and the
// password stated again moves it.
func TestASaveOfAnotherServerKeepsTheSavedPassword(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPlatformDB(t)
	encryptor := newEncryptor(t)
	saved := testutil.StartSMTPServer(t)
	elsewhere := testutil.StartSMTPServer(t)
	ctx := context.Background()
	save := func(p platformsmtp.SaveParams) (dbmodels.PlatformSmtpConfig, error) {
		return platformsmtp.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, p)
	}

	stored, err := save(platformsmtp.SaveParams{Settings: settingsFor(saved), PasswordMode: secretupdate.Replace, Password: "smtp-password"})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	with := func(change func(*emailsettings.SMTPSettings)) emailsettings.SMTPSettings {
		settings := settingsFor(saved)
		change(&settings)
		return settings
	}
	for _, tc := range []struct {
		name     string
		settings emailsettings.SMTPSettings
	}{
		{name: "another host", settings: with(func(s *emailsettings.SMTPSettings) { s.Host = "localhost" })},
		{name: "another port", settings: with(func(s *emailsettings.SMTPSettings) { s.Port = elsewhere.Port })},
		{name: "another username", settings: with(func(s *emailsettings.SMTPSettings) { s.Username = "someone-else" })},
		{name: "another encryption", settings: with(func(s *emailsettings.SMTPSettings) { s.Encryption = "starttls" })},
	} {
		for _, mode := range []secretupdate.Mode{secretupdate.Unspecified, secretupdate.Unchanged} {
			revision := stored.Revision
			_, err := save(platformsmtp.SaveParams{Settings: tc.settings, PasswordMode: mode, ExpectedRevision: &revision})
			if !errors.Is(err, emailsettings.ErrServerChanged) || fielderr.Field(err) != emailsettings.FieldPassword {
				t.Fatalf("%s, mode %d: Save = %v on %q, want ErrServerChanged on password", tc.name, mode, err, fielderr.Field(err))
			}
		}
	}
	row, _, err := platformsmtp.Get(ctx, dbmodels.New(db))
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if row != stored {
		t.Fatalf("stored row = %+v, want it left as %+v", row, stored)
	}

	// The settings saved again keep the password, and another server takes
	// the password stated again, the same one included.
	if _, err := save(platformsmtp.SaveParams{Settings: settingsFor(saved), PasswordMode: secretupdate.Unchanged}); err != nil {
		t.Fatalf("Save of the saved server: %v", err)
	}
	moved, err := save(platformsmtp.SaveParams{Settings: settingsFor(elsewhere), PasswordMode: secretupdate.Replace, Password: "smtp-password"})
	if err != nil {
		t.Fatalf("Save of another server with the password: %v", err)
	}
	if moved.Port != elsewhere.Port || !platformsmtp.HasPassword(moved) {
		t.Fatalf("saved port %d with a password %v, want port %d with one", moved.Port, platformsmtp.HasPassword(moved), elsewhere.Port)
	}
}
