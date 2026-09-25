package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/platformsmtp"
	"github.com/publira/publira/server/internal/secretupdate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

var smtpGroup = commandGroup{
	name:    "smtp",
	summary: "Save and test the SMTP settings the platform's mail is sent with",
	commands: []command{
		{name: "set", summary: "Save the platform's SMTP settings", setup: setupSMTPSet},
		{name: "show", summary: "Print the saved SMTP settings, without the password", setup: setupSMTPShow},
		{name: "test", summary: "Send a test message through the saved SMTP settings", setup: setupSMTPTest},
	},
}

// smtpFlags names the flag each refused field is given through.
var smtpFlags = map[string]string{
	emailsettings.FieldHost:          "--host",
	emailsettings.FieldPort:          "--port",
	emailsettings.FieldUsername:      "--username",
	emailsettings.FieldPassword:      "--password-stdin",
	emailsettings.FieldEncryption:    "--encryption",
	emailsettings.FieldFromAddress:   "--from-address",
	emailsettings.FieldReplyTo:       "--reply-to",
	platformsmtp.FieldRecipientEmail: "--to",
}

// smtpError names the flag behind what platformsmtp refused. A test of the
// saved settings takes none of them but --to, so only that one is named.
func smtpError(err error, test bool) error {
	field := fielderr.Field(err)
	if test && field != platformsmtp.FieldRecipientEmail {
		return err
	}
	if flag := smtpFlags[field]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}

func setupSMTPSet(f *commandFlags) func(context.Context, *commandEnv) error {
	var settings emailsettings.SMTPSettings
	f.StringVar(&settings.Host, "host", "", "the SMTP server's host")
	f.Func("port", "the SMTP server's port `number`", func(v string) error {
		port, err := strconv.ParseInt(v, 10, 32)
		settings.Port = int32(port)
		return err
	})
	f.StringVar(&settings.Encryption, "encryption", "", "how the connection is encrypted, one of tls, starttls, none")
	f.StringVar(&settings.Username, "username", "", "the user the server is signed in to as")
	f.StringVar(&settings.FromAddress, "from-address", "", "the address the platform's mail is sent from")
	f.StringVar(&settings.ReplyTo, "reply-to", "", "the address replies go to, if not the sender's")
	password := f.KeepableSecret("password", "SMTP password")
	return func(ctx context.Context, env *commandEnv) error {
		params := platformsmtp.SaveParams{Settings: settings, PasswordMode: secretupdate.Unchanged}
		if err := params.Validate(); err != nil {
			return smtpError(err, false)
		}
		secrets, err := env.secretManager()
		if err != nil {
			return err
		}
		if params.Password, err = password.read(env.console); err != nil {
			return err
		}
		if params.Password != "" {
			params.PasswordMode = secretupdate.Replace
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		saved, err := platformsmtp.Save(ctx, db, env.logger, secrets, auditlog.SystemPlatformActor, params)
		if err != nil {
			return smtpError(err, false)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the SMTP settings for %s:%d, revision %d\n", saved.Host, saved.Port, saved.Revision)
		return err
	}
}

func setupSMTPShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := platformsmtp.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		if !found {
			_, err = fmt.Fprintln(env.stdout, "No SMTP settings are saved")
			return err
		}
		password := "not saved"
		if platformsmtp.HasPassword(config) {
			password = "saved"
		}
		replyTo := "the sender"
		if config.ReplyTo.Valid {
			replyTo = config.ReplyTo.String
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Host:\t%s\n", config.Host)
		fmt.Fprintf(&b, "Port:\t%d\n", config.Port)
		fmt.Fprintf(&b, "Encryption:\t%s\n", config.Encryption)
		fmt.Fprintf(&b, "Username:\t%s\n", config.Username)
		fmt.Fprintf(&b, "Password:\t%s\n", password)
		fmt.Fprintf(&b, "From address:\t%s\n", config.FromAddress)
		fmt.Fprintf(&b, "Reply-To:\t%s\n", replyTo)
		fmt.Fprintf(&b, "Revision:\t%d\n", config.Revision)
		fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		return printTable(env.stdout, b.String())
	}
}

func setupSMTPTest(f *commandFlags) func(context.Context, *commandEnv) error {
	to := f.String("to", "", "the address to send the test message to")
	return func(ctx context.Context, env *commandEnv) error {
		secrets, err := env.secretManager()
		if err != nil {
			return err
		}
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		q := dbmodels.New(db)
		tester := platformsmtp.Tester{
			Encryptor: secrets,
			SMTP:      internalsmtp.NewClient(),
			Recorder:  auditlog.New(q, env.logger),
		}
		if err := tester.SendSaved(ctx, q, auditlog.SystemPlatformActor, *to); err != nil {
			return smtpError(err, true)
		}
		_, err = fmt.Fprintf(env.stdout, "Sent the test message to %s\n", strings.TrimSpace(*to))
		return err
	}
}
