package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/tenanttz"
)

var platformGroup = commandGroup{
	name:    "platform",
	summary: "Save the platform's default locale, the time zone new tenants start on, and the currency of a tenant with no payment settings",
	commands: []command{
		{name: "set", summary: "Save the flags given over the platform defaults, keeping the other value", setup: setupPlatformSet},
		{name: "show", summary: "Print the platform defaults", setup: setupPlatformShow},
	},
}

// platformFlags names the flag each refused field is given through.
var platformFlags = map[string]string{
	platformconfig.FieldDefaultLocale:   "--default-locale",
	platformconfig.FieldDefaultTimezone: "--default-timezone",
	platformconfig.FieldDefaultCurrency: "--default-currency",
}

// platformError names the flag behind what platformconfig refused.
func platformError(err error) error {
	if flag := platformFlags[fielderr.Field(err)]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}

var errNoPlatformFlag = errors.New("no value was given; name at least one of --default-locale, --default-timezone, and --default-currency")

func setupPlatformSet(f *commandFlags) func(context.Context, *commandEnv) error {
	defaultLocale := f.String("default-locale", "", "the platform's language, one of "+strings.Join(locale.Supported, ", "))
	defaultTimezone := f.String("default-timezone", "", "the IANA time zone every new tenant starts on")
	defaultCurrency := f.String("default-currency", "", "the ISO 4217 code of the currency a tenant with no payment settings sells in")
	return func(ctx context.Context, env *commandEnv) error {
		given := map[string]bool{}
		f.Visit(func(fl *flag.Flag) { given[fl.Name] = true })
		if len(given) == 0 {
			return errNoPlatformFlag
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		stored, found, err := platformconfig.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		// With nothing saved there is no language to keep, and the time zone is
		// the one the column would default to.
		params := platformconfig.SaveParams{DefaultTimezone: tenanttz.Default, ExpectedRevision: &stored.Revision}
		if found {
			params.DefaultTimezone, params.DefaultLocale = stored.DefaultTimezone, stored.DefaultLocale
		}
		if given["default-locale"] {
			params.DefaultLocale = *defaultLocale
		}
		if given["default-timezone"] {
			params.DefaultTimezone = *defaultTimezone
		}
		if given["default-currency"] {
			params.DefaultCurrency = *defaultCurrency
		}
		saved, err := platformconfig.Save(ctx, db, env.logger, auditlog.SystemPlatformActor, params, revalidate.RecordSiteDrop)
		if err != nil {
			return platformError(err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the platform defaults %s, %s, and %s, revision %d\n", saved.DefaultLocale, saved.DefaultTimezone, saved.DefaultCurrency, saved.Revision)
		return err
	}
}

func setupPlatformShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		config, found, err := platformconfig.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		if !found {
			_, err = fmt.Fprintf(env.stdout, "No platform defaults are saved, so new tenants start on %s and sell in %s\n", tenanttz.Default, platformconfig.DefaultCurrency)
			return err
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Default locale:\t%s\n", config.DefaultLocale)
		fmt.Fprintf(&b, "Default time zone:\t%s\n", config.DefaultTimezone)
		fmt.Fprintf(&b, "Default currency:\t%s\n", config.DefaultCurrency)
		fmt.Fprintf(&b, "Revision:\t%d\n", config.Revision)
		fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(config.UpdatedAt))
		return printTable(env.stdout, b.String())
	}
}
