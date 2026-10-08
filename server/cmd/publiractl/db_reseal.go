package main

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/publira/publira/server/internal/secretreseal"
	"github.com/publira/publira/server/internal/sqldb"
)

var dbResealCommand = command{
	name:    "reseal",
	summary: "Seal every stored secret again with the primary encryption key, and count the values each key had sealed",
	setup:   setupDBReseal,
}

// setupDBReseal connects as the superuser because no login role reaches every
// table a sealed value is kept in: the tenant console's FCM credentials are
// out of publira_platform's reach on purpose.
func setupDBReseal(f *commandFlags) func(context.Context, *commandEnv) error {
	dryRun := f.Bool("dry-run", false, "open every sealed value and report what would be sealed again, without writing anything")
	return func(ctx context.Context, env *commandEnv) error {
		dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
		if dbURL == "" {
			return errors.New("PUBLIRA_DB_URL is not set; set it to the superuser connection that owns the schema")
		}
		sealer, err := env.secretManager()
		if err != nil {
			return err
		}
		db, err := sqldb.Open(dbURL)
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck

		report, err := secretreseal.Run(ctx, db, sealer, secretreseal.Options{DryRun: *dryRun, Logger: env.logger})
		if err != nil {
			return err
		}
		if err := printResealReport(env, report, sealer.PrimaryKeyID(), *dryRun); err != nil {
			return err
		}
		if n := report.Unreadable(); n > 0 {
			return fmt.Errorf("%d sealed values open with no configured key and were left as they are; the log names each one", n)
		}
		return nil
	}
}

// printResealReport prints one line per key ID a stored value names.
func printResealReport(env *commandEnv, report secretreseal.Report, primary string, dryRun bool) error {
	if len(report.Keys) == 0 {
		_, err := fmt.Fprintln(env.stdout, "No sealed value is stored")
		return err
	}
	resealed := "RESEALED"
	if dryRun {
		resealed = "TO RESEAL"
	}
	w := tabwriter.NewWriter(env.stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintf(w, "KEY ID\t%s\tON PRIMARY\tUNREADABLE\n", resealed)
	for _, keyID := range slices.Sorted(maps.Keys(report.Keys)) {
		c := report.Keys[keyID]
		label := keyID
		switch keyID {
		case "":
			label = "(none)"
		case primary:
			label += " (primary)"
		}
		_, _ = fmt.Fprintf(w, "%s\t%d\t%d\t%d\n", label, c.Resealed, c.Current, c.Unreadable)
	}
	return w.Flush()
}
