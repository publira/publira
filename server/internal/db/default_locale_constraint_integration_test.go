package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/testutil"
)

// Neither column has a default any more, so an insert that says nothing about
// the language cannot succeed. That is what keeps a row from quietly landing on
// one locale.
func TestDefaultLocaleColumnsHaveNoDefault(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
		VALUES ($1, 'NoLocaleAAA1', 'no-locale.example.com', 'admin-no-locale.example.com', 'No Locale', 'active')
	`, tenantID)
	if !isNotNullViolation(err) {
		t.Fatalf("tenants insert without default_locale error = %v, want not_null_violation", err)
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO platform_config (singleton, default_timezone) VALUES (TRUE, 'Asia/Tokyo')
	`)
	if !isNotNullViolation(err) {
		t.Fatalf("platform_config insert without default_locale error = %v, want not_null_violation", err)
	}
}

// The DB stops at "some language was named": the allow-list of supported codes
// lives in server/internal/locale, generated from locales/index.json, so
// repeating it as a CHECK here would be a second copy to widen by hand every
// time a locale is added.
//
// Both columns carry their own constraint, so both are exercised: dropping
// either one has to fail here.
func TestDefaultLocaleColumnsRejectBlankValues(t *testing.T) {
	tables := []struct {
		name  string
		write func(ctx context.Context, db *sql.DB, defaultLocale string) error
	}{
		{name: "tenants", write: insertTenantWithLocale},
		{name: "platform_config", write: upsertPlatformConfigWithLocale},
	}

	for _, tt := range tables {
		t.Run(tt.name, func(t *testing.T) {
			pg := testutil.StartPostgres(t)
			pg.Reset(t)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			for _, supported := range locale.Supported {
				if err := tt.write(ctx, pg.DB, supported); err != nil {
					t.Fatalf("%s write with supported locale %q: %v", tt.name, supported, err)
				}
			}

			for _, blank := range []string{"", "   "} {
				err := tt.write(ctx, pg.DB, blank)
				if !isCheckViolation(err) {
					t.Fatalf("%s write with blank locale %q error = %v, want check_violation", tt.name, blank, err)
				}
			}
		})
	}
}

// The slug comes from the tail of the UUID rather than its head: a v7 opens
// with a millisecond timestamp, so two rows written inside the same millisecond
// would share a prefix and collide on tenants_admin_domain_key. Hexadecimal
// keeps it usable as a domain label, which a case-sensitive public ID is not.
func insertTenantWithLocale(ctx context.Context, db *sql.DB, defaultLocale string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	hex := strings.ReplaceAll(id.String(), "-", "")
	slug := hex[len(hex)-12:]
	_, err = db.ExecContext(ctx, `
		INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
		VALUES ($1, $2, $3, $4, 'Locale Tenant', 'active', $5)
	`, id, slug, slug+".example.com", "admin-"+slug+".example.com", defaultLocale)
	return err
}

// platform_config holds a single row keyed on `singleton`, so repeated writes
// go through the same upsert the application uses.
func upsertPlatformConfigWithLocale(ctx context.Context, db *sql.DB, defaultLocale string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO platform_config (singleton, default_timezone, default_locale)
		VALUES (TRUE, 'Asia/Tokyo', $1)
		ON CONFLICT (singleton) DO UPDATE SET default_locale = EXCLUDED.default_locale
	`, defaultLocale)
	return err
}

// isCheckViolation lives in engagement_integration_test.go, in this same
// package.
func isNotNullViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23502"
	}
	// Drivers may wrap; fall back to message inspection.
	return err != nil && strings.Contains(err.Error(), "violates not-null constraint")
}
