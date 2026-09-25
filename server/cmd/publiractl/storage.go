package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/secretupdate"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
)

var storageGroup = commandGroup{
	name:    "storage",
	summary: "Save and test the object store every process stores and reads images in",
	commands: []command{
		{name: "set", summary: "Save the platform's object store", setup: setupStorageSet},
		{name: "show", summary: "Print the saved object store, without the secret access key", setup: setupStorageShow},
		{name: "test", summary: "Put, get, list, and delete a probe object in the saved object store", setup: setupStorageTest},
	},
}

// storageFlags names the flag each refused field is given through.
var storageFlags = map[string]string{
	storagesettings.FieldBucket:          "--bucket",
	storagesettings.FieldRegion:          "--region",
	storagesettings.FieldEndpoint:        "--endpoint",
	storagesettings.FieldPublicBaseURL:   "--public-base-url",
	storagesettings.FieldAccessKeyID:     "--access-key-id",
	storagesettings.FieldSecretAccessKey: "--secret-access-key-stdin",
}

// storageError names the flag behind what platformstorage refused.
func storageError(err error) error {
	if flag := storageFlags[fielderr.Field(err)]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}

// storageOperations are the checks of a connection test in the order it runs
// them, named as the S3 API names them.
var storageOperations = []struct {
	operation storagesettings.Operation
	name      string
}{
	{storagesettings.OperationPutObject, "PutObject"},
	{storagesettings.OperationGetObject, "GetObject"},
	{storagesettings.OperationListObjects, "ListObjects"},
	{storagesettings.OperationDeleteObject, "DeleteObject"},
}

func setupStorageSet(f *commandFlags) func(context.Context, *commandEnv) error {
	var settings storagesettings.Settings
	var accessKeyID string
	f.StringVar(&settings.Bucket, "bucket", "", "the bucket images are stored in")
	f.StringVar(&settings.Region, "region", "", "the bucket's region")
	f.StringVar(&settings.Endpoint, "endpoint", "", "the store's URL, for a store other than Amazon S3")
	f.BoolVar(&settings.ForcePathStyle, "force-path-style", false, "address the bucket in the URL path rather than the host name")
	f.StringVar(&settings.PublicBaseURL, "public-base-url", "", "the URL stored objects are readable from, when something serves them directly")
	f.StringVar(&accessKeyID, "access-key-id", "", "the access key requests are signed with; left out, every process signs with its own AWS credential")
	secret := f.KeepableSecret("secret-access-key", "secret access key")
	return func(ctx context.Context, env *commandEnv) error {
		params := platformstorage.SaveParams{Settings: settings, AccessKeyID: strings.TrimSpace(accessKeyID), SecretMode: secretupdate.Clear}
		if err := params.Validate(); err != nil {
			return storageError(err)
		}
		// Without an access key id the processes sign with the ambient
		// credential, so there is no secret to ask for or to encrypt.
		var secrets storagesettings.SecretManager
		if params.AccessKeyID != "" {
			manager, err := env.secretManager()
			if err != nil {
				return err
			}
			secrets = manager
			if params.SecretAccessKey, err = secret.read(env.console); err != nil {
				return err
			}
			params.SecretMode = secretupdate.Unchanged
			if params.SecretAccessKey != "" {
				params.SecretMode = secretupdate.Replace
			}
		} else if secret.fromStdin {
			return storageError(storagesettings.ValidateCredentialPair("", true))
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		saved, err := platformstorage.Save(ctx, db, env.logger, secrets, auditlog.SystemPlatformActor, params)
		if err != nil {
			return storageError(err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the object store %s, revision %d\n", saved.Bucket, saved.Revision)
		return err
	}
}

func setupStorageShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := platformstorage.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		if !found {
			_, err = fmt.Fprintln(env.stdout, "No object store is saved")
			return err
		}
		stored := storagesettings.FromConfig(config)
		orElse := func(value, fallback string) string {
			if value == "" {
				return fallback
			}
			return value
		}
		forcePathStyle, secretAccessKey := "no", "not saved"
		if stored.Settings.ForcePathStyle {
			forcePathStyle = "yes"
		}
		if stored.HasSecretAccessKey {
			secretAccessKey = "saved"
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Bucket:\t%s\n", stored.Settings.Bucket)
		fmt.Fprintf(&b, "Region:\t%s\n", stored.Settings.Region)
		fmt.Fprintf(&b, "Endpoint:\t%s\n", orElse(stored.Settings.Endpoint, "the region's Amazon S3 endpoint"))
		fmt.Fprintf(&b, "Force path style:\t%s\n", forcePathStyle)
		fmt.Fprintf(&b, "Public base URL:\t%s\n", orElse(stored.Settings.PublicBaseURL, "none"))
		fmt.Fprintf(&b, "Access key ID:\t%s\n", orElse(stored.AccessKeyID, "none, each process's own AWS credential"))
		fmt.Fprintf(&b, "Secret access key:\t%s\n", secretAccessKey)
		fmt.Fprintf(&b, "Revision:\t%d\n", stored.Revision)
		fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		return printTable(env.stdout, b.String())
	}
}

func setupStorageTest(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		// Saved settings that sign with the ambient credential hold no secret,
		// and test without the keys that would decrypt one.
		var secrets storagesettings.SecretManager
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
		q := dbmodels.New(db)
		tester := platformstorage.Tester{
			Encryptor: secrets,
			Store:     s3storage.NewConnectionTester(),
			Recorder:  auditlog.New(q, env.logger),
		}
		checks, err := tester.TestSaved(ctx, q, auditlog.SystemPlatformActor)
		if errors.Is(err, storagesettings.ErrSecretManagerUnavailable) {
			return errNoEncryptionKeys
		}
		if err != nil {
			return err
		}

		reasons := make(map[storagesettings.Operation]string, len(checks))
		for _, check := range checks {
			reasons[check.Operation] = "ok"
			if !check.Succeeded() {
				reasons[check.Operation] = "failed: " + check.Reason
			}
		}
		var b strings.Builder
		for _, op := range storageOperations {
			fmt.Fprintf(&b, "%s\t%s\n", op.name, orSkipped(reasons[op.operation]))
		}
		if err := printTable(env.stdout, b.String()); err != nil {
			return err
		}
		if failed, ok := storagesettings.Failed(checks); ok {
			return fmt.Errorf("the object store refused the connection test (%s)", failed.Reason)
		}
		return nil
	}
}

// orSkipped is a check the test never reached, because the probe object it
// would have worked on could not be written.
func orSkipped(result string) string {
	if result == "" {
		return "skipped"
	}
	return result
}
