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

	"github.com/publira/publira/server/internal/secretrehint"
	"github.com/publira/publira/server/internal/sqldb"
)

var dbRehintCommand = command{
	name:    "rehint",
	summary: "Derive again the hint stored beside every saved credential, the way a save derives it now",
	setup:   setupDBRehint,
}

// setupDBRehint connects as the superuser for the reason setupDBReseal does:
// the hints sit in tenant tables under row-level security.
func setupDBRehint(f *commandFlags) func(context.Context, *commandEnv) error {
	dryRun := f.Bool("dry-run", false, "open every saved credential and report which hints would be written again, without writing anything")
	return func(ctx context.Context, env *commandEnv) error {
		dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
		if dbURL == "" {
			return errors.New("PUBLIRA_DB_URL is not set; set it to the superuser connection that owns the schema")
		}
		opener, err := env.secretManager()
		if err != nil {
			return err
		}
		db, err := sqldb.Open(dbURL)
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck

		report, err := secretrehint.Run(ctx, db, opener, secretrehint.Options{DryRun: *dryRun, Logger: env.logger})
		if err != nil {
			return err
		}
		if err := printRehintReport(env, report, *dryRun); err != nil {
			return err
		}
		if n := report.Unreadable(); n > 0 {
			return fmt.Errorf("%d hints were left as they are because their credential did not open or held nothing a hint is derived from; the log names each one", n)
		}
		return nil
	}
}

// printRehintReport prints one line per table a hint is stored in.
func printRehintReport(env *commandEnv, report secretrehint.Report, dryRun bool) error {
	if len(report.Tables) == 0 {
		_, err := fmt.Fprintln(env.stdout, "No credential is stored")
		return err
	}
	rewritten := "REWRITTEN"
	if dryRun {
		rewritten = "TO REWRITE"
	}
	w := tabwriter.NewWriter(env.stdout, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintf(w, "TABLE\t%s\tCURRENT\tUNREADABLE\n", rewritten)
	for _, table := range slices.Sorted(maps.Keys(report.Tables)) {
		c := report.Tables[table]
		_, _ = fmt.Fprintf(w, "%s\t%d\t%d\t%d\n", table, c.Rewritten, c.Current, c.Unreadable)
	}
	return w.Flush()
}
