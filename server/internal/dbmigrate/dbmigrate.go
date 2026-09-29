// Package dbmigrate applies db/migrations with golang-migrate, for publiractl
// and for the integration tests that migrate their own databases.
package dbmigrate

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// New opens the migrations in dir against the PostgreSQL database dbURL names.
func New(dir, dbURL string) (*migrate.Migrate, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	// migrate's pgx/v5 driver is registered under the pgx5:// scheme, not the
	// postgres:// one every other client of the URL takes.
	m, err := migrate.New("file://"+filepath.ToSlash(abs), "pgx5://"+stripURLScheme(dbURL))
	if err != nil {
		return nil, fmt.Errorf("open migrations %s: %w", abs, err)
	}
	return m, nil
}

// RepoDir returns the db/migrations of the repository checkout the working
// directory is inside, found by walking up to the directory that holds both
// server/go.mod and db/migrations.
func RepoDir() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for dir := wd; ; {
		migrations := filepath.Join(dir, "db", "migrations")
		if isFile(filepath.Join(dir, "server", "go.mod")) && isDir(migrations) {
			return migrations, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no db/migrations beside server/go.mod above " + wd)
		}
		dir = parent
	}
}

func stripURLScheme(raw string) string {
	if _, rest, ok := strings.Cut(raw, "://"); ok {
		return rest
	}
	return raw
}

func isFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}
