package main

import (
	"context"
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

// roleSecret is the password flag pair of one login role, spelled after the
// role without its publira_ prefix: publira_content_stats is
// --content-stats-password-file.
func roleSecret(f *commandFlags, role string) *secret {
	name := strings.ReplaceAll(strings.TrimPrefix(role, "publira_"), "_", "-") + "-password"
	return f.Secret(name, role+" password")
}

func setupDBRoles(f *commandFlags) func(context.Context, *commandEnv) error {
	secrets := make(map[string]*secret, len(dbroles.LoginRoles))
	for _, role := range dbroles.LoginRoles {
		secrets[role] = roleSecret(f, role)
	}
	return func(ctx context.Context, env *commandEnv) error {
		dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
		if dbURL == "" {
			return errors.New("PUBLIRA_DB_URL is not set; set it to the superuser connection that owns the schema")
		}
		dir, err := resolveRolesDir()
		if err != nil {
			return fmt.Errorf("find the role definitions: %w", err)
		}
		db, err := sqldb.Open(dbURL)
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck

		missing, err := dbroles.Missing(ctx, db)
		if err != nil {
			return err
		}
		// A role that does not exist yet is asked for; one that does keeps its
		// password unless a flag gives it a new one.
		passwords := map[string]string{}
		for _, role := range dbroles.LoginRoles {
			s := secrets[role]
			if !s.given() {
				if !slices.Contains(missing, role) {
					continue
				}
				if !env.console.isTerminal() {
					return &missingValueError{flags: "--" + s.name + "-file or --" + s.name + "-stdin"}
				}
			}
			password, err := s.read(env.console)
			if err != nil {
				return err
			}
			passwords[role] = password
		}

		result, err := dbroles.Apply(ctx, db, dir, passwords)
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
