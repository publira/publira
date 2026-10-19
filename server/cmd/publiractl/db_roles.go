package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/sqldb"
)

var dbRolesCommand = command{
	name:    "roles",
	summary: "Create the login roles every process connects as, apply their grants, and set their passwords",
	setup:   setupDBRoles,
}

// roleSecrets declares the password flags of every login role, spelled after
// the role without its publira_ prefix and after prefix: publira_content_stats
// is --content-stats-password-file in db roles, which gives no prefix.
func roleSecrets(f *commandFlags, prefix string) map[string]*secret {
	secrets := make(map[string]*secret, len(dbroles.LoginRoles))
	for _, role := range dbroles.LoginRoles {
		name := prefix + strings.ReplaceAll(strings.TrimPrefix(role, "publira_"), "_", "-") + "-password"
		secrets[role] = f.Secret(name, role+" password")
	}
	return secrets
}

func setupDBRoles(f *commandFlags) func(context.Context, *commandEnv) error {
	secrets := roleSecrets(f, "")
	return func(ctx context.Context, env *commandEnv) error {
		dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
		if dbURL == "" {
			return errors.New("PUBLIRA_DB_URL is not set; set it to the superuser connection that owns the schema")
		}
		db, err := sqldb.Open(dbURL)
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		passwords, err := rolePasswords(ctx, db, env.console, env.console.isTerminal(), secrets)
		if err != nil {
			return err
		}
		result, err := applyRoles(ctx, db, passwords)
		if err != nil {
			return err
		}
		for _, role := range dbroles.LoginRoles {
			outcome := "kept its password"
			switch {
			case slices.Contains(result.Created, role):
				outcome = "created"
			case slices.Contains(result.PasswordSet, role):
				outcome = "set its password"
			}
			if _, err := fmt.Fprintf(env.stdout, "%s: %s\n", role, outcome); err != nil {
				return err
			}
		}
		return nil
	}
}

// rolePasswords reads the passwords secrets give. A role that does not exist
// yet needs one, and is asked for where interactive allows it; one that does
// keeps its password unless its flag gives it a new one.
func rolePasswords(ctx context.Context, db *sql.DB, con console, interactive bool, secrets map[string]*secret) (map[string]string, error) {
	missing, err := dbroles.Missing(ctx, db)
	if err != nil {
		return nil, err
	}
	passwords := map[string]string{}
	for _, role := range dbroles.LoginRoles {
		s := secrets[role]
		if !s.given() {
			if !slices.Contains(missing, role) {
				continue
			}
			if !interactive {
				return nil, &missingValueError{flags: s.flags()}
			}
		}
		password, err := s.read(con)
		if err != nil {
			return nil, err
		}
		passwords[role] = password
	}
	return passwords, nil
}

// applyRoles applies the role definitions resolveRolesDir finds on db, the
// connection that owns the schema, and sets passwords.
func applyRoles(ctx context.Context, db *sql.DB, passwords map[string]string) (dbroles.Result, error) {
	dir, err := resolveRolesDir()
	if err != nil {
		return dbroles.Result{}, fmt.Errorf("find the role definitions: %w", err)
	}
	return dbroles.Apply(ctx, db, dir, passwords)
}

// resolveRolesDir returns the roles directory beside the binary, which is where
// the image puts db/seeds/baseline, else the db/seeds/baseline of the checkout
// a go run starts in.
func resolveRolesDir() (string, error) {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Join(filepath.Dir(exe), "roles")
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir, nil
		}
	}
	return dbroles.RepoDir()
}
