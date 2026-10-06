package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/sqldb"
)

var searchGroup = commandGroup{
	name:    "search",
	summary: "Save, test, and rebuild the engine the catalog search runs on",
	commands: []command{
		{name: "set", summary: "Save the catalog search engine", setup: setupSearchSet},
		{name: "show", summary: "Print the saved search engine and the one the search answers from, without the password", setup: setupSearchShow},
		{name: "test", summary: "Ask the saved search engine what it is and whether it has the analysis plugins", setup: setupSearchTest},
		{
			name:    "reindex",
			summary: "Rebuild the catalog index into a new index and move the alias onto it, or rewrite one tenant's documents in place",
			setup:   setupSearchReindex,
		},
	},
}

// searchFlags names the flag each refused field is given through.
var searchFlags = map[string]string{
	platformsearch.FieldEngine:   "--engine",
	platformsearch.FieldURL:      "--url",
	platformsearch.FieldIndex:    "--index",
	platformsearch.FieldUsername: "--username",
	platformsearch.FieldAnalysis: "--analysis-file",
}

var errAnalysisFlags = errors.New("--analysis-file and --default-analysis cannot both be given")

// searchError names the flag behind what platformsearch refused.
func searchError(err error, flags map[string]string) error {
	if flag := flags[fielderr.Field(err)]; flag != "" {
		return fmt.Errorf("%s: %w", flag, err)
	}
	return err
}

func engineNames() string {
	names := make([]string, len(platformsearch.Engines))
	for i, engine := range platformsearch.Engines {
		names[i] = string(engine)
	}
	return strings.Join(names, ", ")
}

func setupSearchSet(f *commandFlags) func(context.Context, *commandEnv) error {
	var settings platformsearch.Settings
	var engine string
	f.StringVar(&engine, "engine", "", "the engine the catalog search runs on, one of "+engineNames())
	f.StringVar(&settings.URL, "url", "", "the engine's http:// or https:// URL, on every engine but sql")
	f.StringVar(&settings.Index, "index", "", "the alias of the index holding the catalog (default \""+opensearchbackend.DefaultIndex+"\")")
	f.StringVar(&settings.Username, "username", "", "the HTTP basic auth user, over https:// only; left out, the engine is reached without credentials")
	analysisFile := f.String("analysis-file", "", "a JSON file holding the settings.analysis of the catalog index, defining the analyzers written_form and alternate_form and the normalizer exact_match; left out, the saved one is kept")
	defaultAnalysis := f.Bool("default-analysis", false, "go back to the default analysis, built for Japanese")
	password := f.KeepableSecret("password", "search engine password")
	named := func(err error) error {
		return password.refusal(err, platformsearch.FieldPassword, func(err error) error { return searchError(err, searchFlags) })
	}
	return func(ctx context.Context, env *commandEnv) error {
		settings.Engine = platformsearch.Engine(engine)
		params := platformsearch.SaveParams{Settings: settings, SecretMode: secretupdate.Clear}
		switch {
		case *analysisFile != "" && *defaultAnalysis:
			return errAnalysisFlags
		case *analysisFile != "":
			raw, err := os.ReadFile(*analysisFile)
			if err != nil {
				return fmt.Errorf("read --analysis-file: %w", err)
			}
			params.AnalysisMode, params.Analysis = platformsearch.AnalysisReplace, string(raw)
		case *defaultAnalysis:
			params.AnalysisMode = platformsearch.AnalysisDefault
		}
		if err := params.Validate(); err != nil {
			return named(err)
		}
		// Without a username the engine is reached without credentials, so
		// there is no password to ask for or to encrypt.
		var secrets platformsearch.SecretManager
		if strings.TrimSpace(settings.Username) != "" {
			manager, err := env.secretManager()
			if err != nil {
				return err
			}
			secrets = manager
			if params.Password, err = password.read(env.console); err != nil {
				return err
			}
			params.SecretMode = secretupdate.Unchanged
			if params.Password != "" {
				params.SecretMode = secretupdate.Replace
			}
		} else if password.given() {
			return named(&fielderr.Invalid{Field: platformsearch.FieldUsername, Err: platformsearch.ErrUsernameRequired})
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		saved, err := platformsearch.Save(ctx, db, env.logger, secrets, auditlog.SystemPlatformActor, params)
		if err != nil {
			return named(err)
		}
		_, err = fmt.Fprintf(env.stdout, "Saved the search engine %s, revision %d. %s\n", saved.Engine, saved.Revision, searchStateSentence(platformsearch.FromConfig(saved)))
		return err
	}
}

// searchStateSentence says where the search answers from against what is
// saved.
func searchStateSentence(stored platformsearch.Stored) string {
	switch stored.State {
	case platformsearch.Building:
		return "The worker builds the index " + stored.Index + " on it from the database, and the search moves onto it once the index is built."
	case platformsearch.BuildFailed:
		return "Building its index failed, and the worker tries again on its next pass; the search answers from " + string(stored.Serving.Engine) + " until it succeeds."
	default:
		return "The search answers from it."
	}
}

func setupSearchShow(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		row, found, err := platformsearch.Get(ctx, dbmodels.New(db))
		if err != nil {
			return err
		}
		if !found {
			_, err = fmt.Fprintln(env.stdout, "No search engine is saved; the catalog search runs on sql")
			return err
		}
		stored := platformsearch.FromConfig(row)
		orElse := func(value, fallback string) string {
			if value == "" {
				return fallback
			}
			return value
		}
		password := "not saved"
		if stored.HasPassword {
			password = "saved"
		}
		var b strings.Builder
		fmt.Fprintf(&b, "Engine:\t%s\n", stored.Engine)
		if stored.Engine.HasIndex() {
			fmt.Fprintf(&b, "URL:\t%s\n", stored.URL)
			fmt.Fprintf(&b, "Index:\t%s\n", stored.Index)
			fmt.Fprintf(&b, "Username:\t%s\n", orElse(stored.Username, "none"))
			fmt.Fprintf(&b, "Password:\t%s\n", password)
		}
		if stored.Engine.HasIndex() {
			fmt.Fprintf(&b, "Analysis:\t%s\n", analysisName(stored.Analysis))
		}
		fmt.Fprintf(&b, "Revision:\t%d\n", stored.Revision)
		fmt.Fprintf(&b, "Updated:\t%s\n", formatTime(row.UpdatedAt))
		serving := string(stored.Serving.Engine)
		if stored.Serving.Engine.HasIndex() {
			serving += " at " + stored.Serving.URL + ", index " + stored.Serving.Index + ", " + analysisName(stored.Serving.Analysis) + " analysis"
		}
		fmt.Fprintf(&b, "Searching on:\t%s (revision %d)\n", serving, stored.Serving.Revision)
		switch stored.State {
		case platformsearch.Building:
			fmt.Fprintf(&b, "Build:\tdue; the worker builds the index of revision %d\n", stored.Revision)
		case platformsearch.BuildFailed:
			fmt.Fprintf(&b, "Build:\tfailed at %s: %s\n", formatTime(stored.Failure.FailedAt), stored.Failure.Error)
		default:
			fmt.Fprintf(&b, "Build:\tnone due\n")
		}
		return printTable(env.stdout, b.String())
	}
}

// analysisName says which analysis an index is built with.
func analysisName(analysis string) string {
	if analysis == "" {
		return "default"
	}
	return "saved"
}

// optionalSecrets is the secret manager when the keys are set, and nil when
// they are not, for a command that needs one only for a stored password.
func optionalSecrets(env *commandEnv) (platformsearch.Decrypter, error) {
	manager, err := env.secretManager()
	switch {
	case err == nil:
		return manager, nil
	case errors.Is(err, errNoEncryptionKeys):
		return nil, nil
	default:
		return nil, err
	}
}

func setupSearchTest(_ *commandFlags) func(context.Context, *commandEnv) error {
	return func(ctx context.Context, env *commandEnv) error {
		// An engine reached without credentials holds no password, and tests
		// without the keys that would decrypt one.
		secrets, err := optionalSecrets(env)
		if err != nil {
			return err
		}
		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		q := dbmodels.New(db)
		tester := platformsearch.Tester{Secrets: secrets, Recorder: auditlog.New(q, env.logger)}
		result, err := tester.TestSaved(ctx, q, auditlog.SystemPlatformActor)
		switch {
		case errors.Is(err, platformsearch.ErrSecretManagerUnavailable):
			return errNoEncryptionKeys
		case err != nil:
			return err
		}
		return printSearchTest(env.stdout, result)
	}
}

// printSearchTest prints what a connection test found, and refuses a test that
// failed.
func printSearchTest(w io.Writer, result platformsearch.Result) error {
	present := func(ok bool) string {
		if ok {
			return "installed"
		}
		return "missing"
	}
	orUnknown := func(value string) string {
		if value == "" {
			return "unknown"
		}
		return value
	}
	// An engine that did not answer as one has no product or plugins to print.
	if result.Version != "" {
		var b strings.Builder
		fmt.Fprintf(&b, "Product:\t%s\n", orUnknown(result.Product))
		fmt.Fprintf(&b, "Version:\t%s\n", result.Version)
		fmt.Fprintf(&b, "%s:\t%s\n", opensearchbackend.PluginAnalysisKuromoji, present(result.KuromojiPresent))
		fmt.Fprintf(&b, "%s:\t%s\n", opensearchbackend.PluginAnalysisICU, present(result.ICUPresent))
		if err := printTable(w, b.String()); err != nil {
			return err
		}
	}
	if !result.Succeeded() {
		return fmt.Errorf("the search engine failed the connection test (%s)", result.Reason)
	}
	return nil
}

// defaultContentStatsDBURL is publira_content_stats in the development
// database, the same fallback publira worker uses for
// PUBLIRA_CONTENT_STATS_DB_URL. The reindex reads every tenant's catalog and
// moves the search onto what it built, which is the maintenance role's reach.
const defaultContentStatsDBURL = "postgres://publira_content_stats:contentstatspass@db:5432/publira?sslmode=disable"

var errNoSearchIndex = errors.New("the catalog search runs on sql, which keeps no index to rebuild; save another engine with publiractl search set first")

func setupSearchReindex(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := f.String("tenant", "", "rewrite only this tenant's documents, by public ID or domain, in the index the search answers from, without a new index")
	return func(ctx context.Context, env *commandEnv) error {
		secrets, err := optionalSecrets(env)
		if err != nil {
			return err
		}
		db, err := sqldb.Open(resolveDBURL(defaultContentStatsDBURL, "PUBLIRA_CONTENT_STATS_DB_URL"))
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck

		if *ref != "" {
			return syncSearchTenant(ctx, env, db, secrets, *ref)
		}
		result, err := platformsearch.Build(ctx, platformsearch.BuildParams{DB: db, Secrets: secrets, Logger: env.logger, Force: true})
		switch {
		case errors.Is(err, platformsearch.ErrNoIndex):
			return errNoSearchIndex
		case errors.Is(err, platformsearch.ErrSecretManagerUnavailable):
			return errNoEncryptionKeys
		case err != nil:
			return err
		}
		suffix := " The search answers from it."
		if !result.Serving {
			suffix = " The settings were saved again while it ran, so the worker builds the index of the newer ones next."
		}
		_, err = fmt.Fprintf(env.stdout, "Rebuilt the catalog index; %s now names %s.%s\n", result.Alias, result.Index, suffix)
		return err
	}
}

// syncSearchTenant rewrites one tenant's documents in the index the search
// answers from. It makes no new index: one holding a single tenant would have
// to copy every other tenant's documents across, and the writes their events
// made during the copy would be lost with the old index.
func syncSearchTenant(ctx context.Context, env *commandEnv, db *sql.DB, secrets platformsearch.Decrypter, ref string) error {
	tenant, err := platformtenants.Find(ctx, dbmodels.New(db), ref)
	if err != nil {
		return tenantError(err)
	}
	backend, err := platformsearch.NewResolver(platformsearch.ResolverConfig{
		Queries:  dbmodels.New(db),
		Secrets:  secrets,
		Interval: -1,
		Logger:   env.logger,
	}).Serving(ctx)
	switch {
	case errors.Is(err, platformsearch.ErrSecretManagerUnavailable):
		return errNoEncryptionKeys
	case err != nil:
		return err
	case backend == nil:
		return errNoSearchIndex
	}
	written, deleted, err := catalogindex.SyncTenant(ctx, db, backend, tenant.ID)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(env.stdout, "Rewrote the catalog documents of tenant %s: %d written, %d deleted.\n", tenant.PublicID, written, deleted)
	return err
}
