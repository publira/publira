// Package testutil provides shared helpers for integration tests that need a real PostgreSQL.
package testutil

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// Keep the database name aligned with db/seeds/baseline role grants (GRANT CONNECT ON DATABASE publira).
	// Must not be the system database name "postgres" so Snapshot/Restore can work.
	defaultDatabase = "publira"
	defaultUser     = "postgres"
	defaultPassword = "password"

	// Match CI postgres service major version closely enough for schema compatibility.
	defaultPostgresImage = "postgres:18-alpine"

	platformDBUser     = "publira_platform"
	platformDBPassword = "platformpass"

	// The admin API role is deliberately not BYPASSRLS: every statement it runs
	// is filtered by the tenant isolation policies.
	adminDBUser     = "publira_admin"
	adminDBPassword = "adminpass"

	// The public API role is likewise RLS-bound, so a catalog query that forgets
	// its tenant predicate still cannot reach another tenant's rows.
	publicDBUser     = "publira_public"
	publicDBPassword = "publicpass"
)

// SeededPassword is the plaintext behind the password hash of every user seeded
// by this package. Tests that drive a real Login need the cleartext.
const SeededPassword = "password-for-tests-only"

// PostgresEnv holds a shared Testcontainers PostgreSQL instance prepared with
// migrations and application roles. Prefer [StartPostgres] from tests.
type PostgresEnv struct {
	Container *postgres.PostgresContainer
	// Superuser DSN (sslmode=disable).
	URL string
	// Application (platform API) DSN using publira_platform.
	PlatformURL string
	// Application (admin API) DSN using publira_admin, which is subject to RLS.
	AdminURL string
	// Application (public API) DSN using publira_public, which is subject to RLS.
	PublicURL string

	// Superuser pool used for setup and seeding.
	DB *sql.DB
}

var (
	sharedMu  sync.Mutex
	sharedEnv *PostgresEnv
	sharedErr error
)

// StartPostgres returns a process-wide PostgreSQL environment (container +
// migrations + app roles). Safe to call from multiple tests; the first call
// starts the container. Skips when -short is set or Docker is unavailable.
//
// Between tests, call [PostgresEnv.Reset] so each case sees a clean schema
// (roles and migrations remain; application data is wiped via Snapshot/Restore).
func StartPostgres(t *testing.T) *PostgresEnv {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping PostgreSQL integration test in short mode")
	}

	sharedMu.Lock()
	defer sharedMu.Unlock()

	if sharedEnv != nil || sharedErr != nil {
		if sharedErr != nil {
			if isDockerUnavailable(sharedErr) {
				t.Skipf("skipping PostgreSQL integration test: Docker unavailable: %v", sharedErr)
			}
			t.Fatalf("postgres testcontainer: %v", sharedErr)
		}
		return sharedEnv
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	env, err := startPostgres(ctx)
	if err != nil {
		sharedErr = err
		if isDockerUnavailable(err) {
			t.Skipf("skipping PostgreSQL integration test: Docker unavailable: %v", err)
		}
		t.Fatalf("postgres testcontainer: %v", err)
	}
	sharedEnv = env
	return sharedEnv
}

func startPostgres(ctx context.Context) (*PostgresEnv, error) {
	container, err := postgres.Run(
		ctx,
		defaultPostgresImage,
		postgres.WithDatabase(defaultDatabase),
		postgres.WithUsername(defaultUser),
		postgres.WithPassword(defaultPassword),
		postgres.BasicWaitStrategies(),
		postgres.WithSQLDriver("pgx"),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres container: %w", err)
	}

	connURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("connection string: %w", err)
	}

	if err := runMigrations(connURL); err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("migrate: %w", err)
	}

	db, err := sql.Open("pgx", connURL)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("open db: %w", err)
	}
	configurePool(db)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("ping db: %w", err)
	}

	if err := applyAppRoles(ctx, db); err != nil {
		_ = db.Close()
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("apply app roles: %w", err)
	}

	// Snapshot after migrations + roles so Restore returns a clean empty schema.
	// Close connections before snapshot so no session blocks DROP DATABASE.
	if err := db.Close(); err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("close db before snapshot: %w", err)
	}
	if err := container.Snapshot(ctx); err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("snapshot: %w", err)
	}

	db, err = sql.Open("pgx", connURL)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, fmt.Errorf("reopen db after snapshot: %w", err)
	}
	configurePool(db)

	platformURL, err := appConnectionString(connURL, platformDBUser, platformDBPassword)
	if err != nil {
		_ = db.Close()
		_ = testcontainers.TerminateContainer(container)
		return nil, err
	}
	adminURL, err := appConnectionString(connURL, adminDBUser, adminDBPassword)
	if err != nil {
		_ = db.Close()
		_ = testcontainers.TerminateContainer(container)
		return nil, err
	}
	publicURL, err := appConnectionString(connURL, publicDBUser, publicDBPassword)
	if err != nil {
		_ = db.Close()
		_ = testcontainers.TerminateContainer(container)
		return nil, err
	}

	return &PostgresEnv{
		Container:   container,
		URL:         connURL,
		PlatformURL: platformURL,
		AdminURL:    adminURL,
		PublicURL:   publicURL,
		DB:          db,
	}, nil
}

// Reset restores the database to the post-migration snapshot (no application data).
// Call at the start of each integration test (or in Cleanup) for isolation.
// Do not run tests that call Reset in parallel against the shared env.
func (e *PostgresEnv) Reset(t *testing.T) {
	t.Helper()
	if e == nil || e.Container == nil {
		t.Fatal("postgres env is nil")
	}

	// Drop pooled connections so Restore can recreate the database.
	if e.DB != nil {
		_ = e.DB.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	if err := e.Container.Restore(ctx); err != nil {
		t.Fatalf("restore postgres snapshot: %v", err)
	}

	db, err := sql.Open("pgx", e.URL)
	if err != nil {
		t.Fatalf("reopen db after restore: %v", err)
	}
	configurePool(db)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		t.Fatalf("ping db after restore: %v", err)
	}
	e.DB = db
}

// OpenPlatformDB opens a connection as publira_platform (BYPASSRLS app user).
// The connection is closed via t.Cleanup.
func (e *PostgresEnv) OpenPlatformDB(t *testing.T) *sql.DB {
	t.Helper()
	return e.openAppDB(t, e.PlatformURL, platformDBUser)
}

// OpenAdminDB opens a connection as publira_admin, the RLS-bound role the admin
// API runs as. Statements only see rows of the tenant the session set through
// app.current_tenant_id. The connection is closed via t.Cleanup.
func (e *PostgresEnv) OpenAdminDB(t *testing.T) *sql.DB {
	t.Helper()
	return e.openAppDB(t, e.AdminURL, adminDBUser)
}

// OpenPublicDB opens a connection as publira_public, the RLS-bound role the
// public API runs as. Like the admin role it only sees rows of the tenant the
// session set through app.current_tenant_id, so a public catalog query is
// filtered by the database as well as by its own WHERE clause. The connection
// is closed via t.Cleanup.
func (e *PostgresEnv) OpenPublicDB(t *testing.T) *sql.DB {
	t.Helper()
	return e.openAppDB(t, e.PublicURL, publicDBUser)
}

func (e *PostgresEnv) openAppDB(t *testing.T, dsn, role string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open %s db: %v", role, err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		t.Fatalf("ping %s db: %v", role, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// PlatformOperator is a seeded platform_users row used for authenticated API tests.
type PlatformOperator struct {
	ID                 uuid.UUID
	PublicID           string
	Email              string
	Name               string
	Role               string
	CredentialsVersion int32
}

// SeedPlatformOperator inserts an active platform operator (default role: platform_operator).
// Uses the superuser connection so it works even before app-user grants are exercised.
func (e *PostgresEnv) SeedPlatformOperator(t *testing.T, publicID, email, name string) PlatformOperator {
	t.Helper()
	return e.seedPlatformUser(t, publicID, email, name, auth.RolePlatformOperator)
}

// SeedPlatformSuperAdmin inserts an active platform_super_admin user.
func (e *PostgresEnv) SeedPlatformSuperAdmin(t *testing.T, publicID, email, name string) PlatformOperator {
	t.Helper()
	return e.seedPlatformUser(t, publicID, email, name, auth.RolePlatformSuperAdmin)
}

// SeedPlatformAuditor inserts an active read-only platform_auditor user.
func (e *PostgresEnv) SeedPlatformAuditor(t *testing.T, publicID, email, name string) PlatformOperator {
	t.Helper()
	return e.seedPlatformUser(t, publicID, email, name, auth.RolePlatformAuditor)
}

func (e *PostgresEnv) seedPlatformUser(t *testing.T, publicID, email, name, role string) PlatformOperator {
	t.Helper()
	if e.DB == nil {
		t.Fatal("postgres env db is nil; call Reset first if needed")
	}

	publicID = defaultIfEmpty(publicID, "PLATUSER001")
	email = defaultIfEmpty(email, "platform@example.com")
	name = defaultIfEmpty(name, "Platform Operator")

	passwordHash, err := auth.HashPassword(SeededPassword)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	userID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	roleID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	queries := dbmodels.New(e.DB)
	user, err := queries.CreatePlatformUser(ctx, dbmodels.CreatePlatformUserParams{
		ID:           userID,
		PublicID:     publicID,
		Email:        email,
		PasswordHash: passwordHash,
		Name:         name,
	})
	if err != nil {
		t.Fatalf("CreatePlatformUser: %v", err)
	}
	if _, err := queries.CreatePlatformUserRole(ctx, dbmodels.CreatePlatformUserRoleParams{
		ID:             roleID,
		PlatformUserID: user.ID,
		Role:           role,
	}); err != nil {
		t.Fatalf("CreatePlatformUserRole: %v", err)
	}

	return PlatformOperator{
		ID:                 user.ID,
		PublicID:           user.PublicID,
		Email:              user.Email,
		Name:               user.Name,
		Role:               role,
		CredentialsVersion: user.CredentialsVersion,
	}
}

func configurePool(db *sql.DB) {
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Minute)
}

func runMigrations(postgresURL string) error {
	migrationsDir, err := findMigrationsDir()
	if err != nil {
		return err
	}

	// migrate's pgx/v5 driver expects the pgx5:// scheme.
	migrateURL := "pgx5://" + stripURLScheme(postgresURL)

	m, err := migrate.New("file://"+filepath.ToSlash(migrationsDir), migrateURL)
	if err != nil {
		return fmt.Errorf("migrate.New: %w", err)
	}
	defer m.Close() //nolint:errcheck

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

func applyAppRoles(ctx context.Context, db *sql.DB) error {
	seedPath, err := findAppRolesSeedPath()
	if err != nil {
		return err
	}
	sqlBytes, err := os.ReadFile(seedPath)
	if err != nil {
		return fmt.Errorf("read app roles seed: %w", err)
	}
	if _, err := db.ExecContext(ctx, string(sqlBytes)); err != nil {
		return fmt.Errorf("exec app roles seed: %w", err)
	}
	return nil
}

func findMigrationsDir() (string, error) {
	root, err := findRepoRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "db", "migrations")
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return "", fmt.Errorf("migrations dir not found at %s", dir)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func findAppRolesSeedPath() (string, error) {
	root, err := findRepoRoot()
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, "db", "seeds", "baseline", "000_rls_bypass_role.sql")
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("app roles seed not found at %s: %w", path, err)
	}
	return path, nil
}

// findRepoRoot walks up from the working directory looking for the monorepo root
// (contains both server/go.mod and db/migrations).
func findRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for {
		serverMod := filepath.Join(dir, "server", "go.mod")
		migrations := filepath.Join(dir, "db", "migrations")
		if fileExists(serverMod) && dirExists(migrations) {
			return dir, nil
		}
		// Also accept being inside server/ where parent is the repo root.
		if filepath.Base(dir) == "server" && fileExists(filepath.Join(dir, "go.mod")) {
			parent := filepath.Dir(dir)
			if dirExists(filepath.Join(parent, "db", "migrations")) {
				return parent, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate repo root from %s (need server/go.mod and db/migrations)", wd)
		}
		dir = parent
	}
}

func appConnectionString(superuserURL, user, password string) (string, error) {
	u, err := url.Parse(superuserURL)
	if err != nil {
		return "", fmt.Errorf("parse postgres url: %w", err)
	}
	u.User = url.UserPassword(user, password)
	return u.String(), nil
}

func stripURLScheme(raw string) string {
	if i := strings.Index(raw, "://"); i >= 0 {
		return raw[i+3:]
	}
	return raw
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func dirExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}

func defaultIfEmpty(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func isDockerUnavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, needle := range []string{
		"cannot connect to the docker daemon",
		"permission denied while trying to connect to the docker daemon",
		"is the docker daemon running",
		"docker provider failed",
		"no such host",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}
