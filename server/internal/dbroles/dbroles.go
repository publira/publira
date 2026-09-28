// Package dbroles creates the PostgreSQL login roles every Publira process
// connects as, grants them what db/seeds/baseline grants, and sets their
// passwords, for publiractl and for the integration tests.
package dbroles

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/xdg-go/stringprep"

	"github.com/publira/publira/server/internal/dbmigrate"
)

// LoginRoles are the roles a process connects as, in the order they are
// reported. publira_rls_bypass is not one of them: it cannot log in.
var LoginRoles = []string{
	"publira_public",
	"publira_admin",
	"publira_platform",
	"publira_outbox",
	"publira_ticker",
	"publira_content_stats",
}

// PasswordRequiredError is a login role that does not exist yet and was given
// no password, which would leave it created without one.
type PasswordRequiredError struct {
	Roles []string
}

func (e *PasswordRequiredError) Error() string {
	return "a password is required for the roles that do not exist yet: " + strings.Join(e.Roles, ", ")
}

// Result is what [Apply] did to each login role.
type Result struct {
	Created     []string
	PasswordSet []string
}

// RepoDir returns the db/seeds/baseline of the repository checkout the working
// directory is inside.
func RepoDir() (string, error) {
	migrations, err := dbmigrate.RepoDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(migrations), "seeds", "baseline"), nil
}

// Files returns the .sql files in dir in the order they are applied, which is
// the order db/seeds/prod.sql includes them in.
func Files(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".sql" {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no .sql file in %s", dir)
	}
	return files, nil
}

// Missing returns the login roles that do not exist yet.
func Missing(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", LoginRoles)
	if err != nil {
		return nil, fmt.Errorf("read the existing roles: %w", err)
	}
	defer rows.Close() //nolint:errcheck
	existing := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		existing[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var missing []string
	for _, role := range LoginRoles {
		if !existing[role] {
			missing = append(missing, role)
		}
	}
	return missing, nil
}

// Apply runs every file [Files] finds in dir, then sets the passwords given,
// keyed by role, in one transaction on a superuser connection. A role that
// exists keeps its password unless one is given for it, and a role that does
// not needs one, so nothing is created without a password.
func Apply(ctx context.Context, db *sql.DB, dir string, passwords map[string]string) (Result, error) {
	for role, password := range passwords {
		if !slices.Contains(LoginRoles, role) {
			return Result{}, fmt.Errorf("%s is not a login role", role)
		}
		if password == "" {
			return Result{}, fmt.Errorf("the password of %s is empty", role)
		}
	}
	files, err := Files(dir)
	if err != nil {
		return Result{}, err
	}
	missing, err := Missing(ctx, db)
	if err != nil {
		return Result{}, err
	}
	var result Result
	var unset []string
	for _, role := range missing {
		if _, ok := passwords[role]; !ok {
			unset = append(unset, role)
		}
		result.Created = append(result.Created, role)
	}
	if len(unset) > 0 {
		return Result{}, &PasswordRequiredError{Roles: unset}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback() //nolint:errcheck
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			return Result{}, err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			return Result{}, fmt.Errorf("apply %s: %w", filepath.Base(file), err)
		}
	}
	for _, role := range LoginRoles {
		password, ok := passwords[role]
		if !ok {
			continue
		}
		verifier, err := scramSHA256(password)
		if err != nil {
			return Result{}, err
		}
		// The verifier is base64 around "$" and ":", so it needs no escaping.
		if _, err := tx.ExecContext(ctx, "ALTER ROLE "+pgx.Identifier{role}.Sanitize()+" PASSWORD '"+verifier+"'"); err != nil {
			return Result{}, fmt.Errorf("set the password of %s: %w", role, err)
		}
		result.PasswordSet = append(result.PasswordSet, role)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, err
	}
	return result, nil
}

const scramIterations = 4096

// scramSHA256 is the verifier PostgreSQL stores for password. Sending it in
// place of the password, as psql's \password does, keeps the plaintext out of
// the server's statement log.
func scramSHA256(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	return scramVerifier(password, salt)
}

func scramVerifier(password string, salt []byte) (string, error) {
	// SASLprep, falling back to the raw password on prohibited input, is what
	// PostgreSQL applies when it hashes a password itself.
	if prepared, err := stringprep.SASLprep.Prepare(password); err == nil {
		password = prepared
	}
	salted, err := pbkdf2.Key(sha256.New, password, salt, scramIterations, sha256.Size)
	if err != nil {
		return "", err
	}
	storedKey := sha256.Sum256(hmacSHA256(salted, "Client Key"))
	serverKey := hmacSHA256(salted, "Server Key")
	enc := base64.StdEncoding.EncodeToString
	return fmt.Sprintf("SCRAM-SHA-256$%d:%s$%s:%s", scramIterations, enc(salt), enc(storedKey[:]), enc(serverKey)), nil
}

func hmacSHA256(key []byte, message string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(message))
	return mac.Sum(nil)
}
