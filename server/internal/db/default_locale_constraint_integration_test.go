package dbmodels_test

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

// Every code the application treats as supported has to be storable, and
// nothing else. Driving the accepted half off locale.Supported is what keeps
// the CHECK in the baseline from drifting away from locales/index.json.
func TestDefaultLocaleColumnsAcceptOnlySupportedCodes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, supported := range locale.Supported {
		if err := insertTenantWithLocale(ctx, pg.DB, supported); err != nil {
			t.Fatalf("tenants insert with supported locale %q: %v", supported, err)
		}
	}

	for _, unsupported := range []string{"", "   ", "fr", "EN", "en-US", "ja-JP"} {
		err := insertTenantWithLocale(ctx, pg.DB, unsupported)
		if !isCheckViolation(err) {
			t.Fatalf("tenants insert with unsupported locale %q error = %v, want check_violation", unsupported, err)
		}
	}
}

func insertTenantWithLocale(ctx context.Context, db *sql.DB, defaultLocale string) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	slug := strings.ReplaceAll(id.String(), "-", "")[:12]
	_, err = db.ExecContext(ctx, `
		INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
		VALUES ($1, $2, $3, $4, 'Locale Tenant', 'active', $5)
	`, id, slug, slug+".example.com", "admin-"+slug+".example.com", defaultLocale)
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
