package main

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/golang-migrate/migrate/v4"

	"github.com/publira/publira/server/internal/dbmigrate"
	"github.com/publira/publira/server/internal/logging"
)

// dbCommand is one subcommand of the db group.
type dbCommand struct {
	name    string
	summary string
	run     func(logger *slog.Logger, stdout io.Writer, m *migrate.Migrate) error
}

var dbCommands = []dbCommand{
	{
		name:    "migrate",
		summary: "Apply every pending migration in db/migrations",
		run:     runDBMigrate,
	},
	{
		name:    "version",
		summary: "Print the schema version and whether the database is dirty",
		run:     runDBVersion,
	},
}

func runDB(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "a db command is required", dbUsage())
	}
	var c *dbCommand
	for i := range dbCommands {
		if dbCommands[i].name == args[0] {
			c = &dbCommands[i]
		}
	}
	if c == nil {
		return usageError(stderr, fmt.Sprintf("unknown db command %q", args[0]), dbUsage())
	}
	if len(args) > 1 {
		return usageError(stderr, fmt.Sprintf("db %s takes no arguments, got %q", c.name, strings.Join(args[1:], " ")), dbUsage())
	}

	logger := logging.New(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})

	// Unlike the job group, this never falls back to the development URL: a
	// migration aimed at db:5432 because the variable was forgotten is not a
	// failure anyone should have to discover afterwards.
	dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
	if dbURL == "" {
		logger.Error("PUBLIRA_DB_URL is not set; set it to the connection that owns the schema")
		return 1
	}
	dir, err := resolveMigrationsDir()
	if err != nil {
		logger.Error("failed to find the migrations", "error", err)
		return 1
	}
	m, err := dbmigrate.New(dir, dbURL)
	if err != nil {
		logger.Error("failed to open the migrations", "error", err)
		return 1
	}
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			logger.Error("failed to close the migrations", "source_error", srcErr, "database_error", dbErr)
		}
	}()

	if err := c.run(logger, os.Stdout, m); err != nil {
		return 1
	}
	return 0
}

func runDBMigrate(logger *slog.Logger, _ io.Writer, m *migrate.Migrate) error {
	from, err := schemaVersion(m)
	if err != nil {
		logger.Error("failed to read the schema version", "error", err)
		return err
	}
	if from.dirty {
		err := fmt.Errorf("the database is dirty at version %d", from.version)
		logger.Error("refusing to migrate", "error", err)
		return err
	}
	logger.Info("migrating", "from_version", from.version)

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		logger.Error("failed to migrate", "from_version", from.version, "error", err)
		return err
	}
	to, err := schemaVersion(m)
	if err != nil {
		logger.Error("failed to read the schema version", "error", err)
		return err
	}
	logger.Info("migrated", "from_version", from.version, "to_version", to.version)
	return nil
}

func runDBVersion(logger *slog.Logger, stdout io.Writer, m *migrate.Migrate) error {
	v, err := schemaVersion(m)
	if err != nil {
		logger.Error("failed to read the schema version", "error", err)
		return err
	}
	_, err = fmt.Fprintf(stdout, "version %d\ndirty %t\n", v.version, v.dirty)
	return err
}

type version struct {
	version uint
	dirty   bool
}

// schemaVersion reads what schema_migrations records, reporting a database no
// migration has touched as version 0.
func schemaVersion(m *migrate.Migrate) (version, error) {
	v, dirty, err := m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return version{}, nil
	}
	return version{version: v, dirty: dirty}, err
}

// resolveMigrationsDir returns PUBLIRA_DB_MIGRATIONS_DIR when it is set, else
// the migrations directory beside the binary, which is where the image puts
// db/migrations, else the db/migrations of the checkout a go run starts in.
func resolveMigrationsDir() (string, error) {
	if dir := strings.TrimSpace(os.Getenv("PUBLIRA_DB_MIGRATIONS_DIR")); dir != "" {
		return dir, nil
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Join(filepath.Dir(exe), "migrations")
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir, nil
		}
	}
	return dbmigrate.RepoDir()
}

func dbUsage() string {
	var b strings.Builder
	b.WriteString("\nUsage: publiractl db <command>\n\nCommands:\n")
	for _, c := range dbCommands {
		fmt.Fprintf(&b, "  %-25s %s\n", c.name, c.summary)
	}
	b.WriteString("\nThe db commands connect with PUBLIRA_DB_URL and nothing else.\n")
	return b.String()
}
