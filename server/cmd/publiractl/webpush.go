package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/webpushsettings"
)

var webPushGroup = commandGroup{
	name:    "webpush",
	summary: "Turn on Web Push, the browser notifications the platform signs with its VAPID key pair",
	commands: []command{
		{name: "init", summary: "Save the subject, generating the VAPID key pair when none is stored", setup: setupWebPushInit},
		{name: "show", summary: "Print the subject and the VAPID public key, without the private key", setup: setupWebPushShow},
	},
}

func setupWebPushInit(f *commandFlags) func(context.Context, *commandEnv) error {
	subject := f.String("subject", "", "the contact push services reach the platform at, a mailto: URI or an https: URL")
	return func(ctx context.Context, env *commandEnv) error {
		params := webpushsettings.SaveParams{Subject: *subject}
		if err := params.Validate(); err != nil {
			return webPushError(err)
		}
		// A stored key pair needs no keys to keep, so only generating one
		// asks for them.
		var secrets webpushsettings.SecretManager
		manager, err := env.secretManager()
		switch {
		case err == nil:
			secrets = manager
		case !errors.Is(err, errNoEncryptionKeys):
			return err
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		saved, err := webpushsettings.SaveSubject(ctx, db, env.logger, secrets, auditlog.SystemPlatformActor, params)
		if errors.Is(err, webpushsettings.ErrSecretManagerUnavailable) {
			return errNoEncryptionKeys
		}
		if err != nil {
			return webPushError(err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the Web Push subject %s, revision %d\n", saved.Subject.String, saved.Revision)
		return err
	}
}

// webPushError names the flag behind what webpushsettings refused.
func webPushError(err error) error {
	if fielderr.Field(err) == webpushsettings.FieldSubject {
		return fmt.Errorf("--subject: %w", err)
	}
	return err
}

func setupWebPushShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := webpushsettings.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		if !found {
			_, err = fmt.Fprintln(env.stdout, "No VAPID key pair is stored, so Web Push is off")
			return err
		}
		stored := webpushsettings.FromConfig(config)
		subject := stored.Subject
		if !stored.Configured() {
			subject = "none, so Web Push is off"
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Subject:\t%s\n", subject)
		fmt.Fprintf(&b, "VAPID public key:\t%s\n", stored.PublicKey)
		fmt.Fprintf(&b, "Revision:\t%d\n", stored.Revision)
		fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		return printTable(env.stdout, b.String())
	}
}
