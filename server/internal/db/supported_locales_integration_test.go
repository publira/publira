package dbtest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/testutil"
)

// The last migration before tenants stored the locales their site offers.
const beforeSupportedLocalesVersion = 20261013170631

// Every tenant saved before the column existed served every locale there was,
// so it keeps all five: a URL a reader reached the day before the upgrade still
// resolves the day after it.
func TestSupportedLocalesMigrationKeepsEveryLocaleForExistingTenants(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforeSupportedLocalesVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The schema before this one asked only for a non-blank default, so a
	// padded code and one the registry does not know could both be stored by
	// a write around the API. Neither may stop the upgrade.
	tenant := pg.SeedTenantOnOlderSchema(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	padded := pg.SeedTenantOnOlderSchema(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	unknown := pg.SeedTenantOnOlderSchema(t, "TENANTC", "tenant-c.example.com", "Tenant C")
	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = ' en ' WHERE id = $1`, padded.ID)
	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'fr' WHERE id = $1`, unknown.ID)
	pg.MigrateUp(t)

	every := []string{"ja", "en", "ko", "zh-Hans", "zh-Hant"}
	for _, tt := range []struct {
		name          string
		id            uuid.UUID
		wantDefault   string
		wantSupported []string
	}{
		{name: "a supported default", id: tenant.ID, wantDefault: "ja", wantSupported: every},
		{name: "a padded default", id: padded.ID, wantDefault: "en", wantSupported: every},
		{name: "an unknown default", id: unknown.ID, wantDefault: "fr", wantSupported: append(slices.Clone(every), "fr")},
	} {
		var gotDefault string
		var gotSupported []string
		if err := pg.DB.QueryRowContext(ctx, "SELECT default_locale, supported_locales FROM tenants WHERE id = $1", tt.id).Scan(&gotDefault, pq.Array(&gotSupported)); err != nil {
			t.Fatalf("%s: read the locales: %v", tt.name, err)
		}
		if gotDefault != tt.wantDefault || !slices.Equal(gotSupported, tt.wantSupported) {
			t.Fatalf("%s: locales = %q %q, want %q %q", tt.name, gotDefault, gotSupported, tt.wantDefault, tt.wantSupported)
		}
	}

	// The default the migration filled the rows with is gone again, so tenant
	// creation has to name the set it means.
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
		VALUES ($1, 'NoSetAAAAAA1', 'no-set.example.com', 'admin-no-set.example.com', 'No Set', 'active', 'ja')
	`, uuid.Must(uuid.NewV7()))
	if !isNotNullViolation(err) {
		t.Fatalf("tenants insert without supported_locales error = %v, want not_null_violation", err)
	}
}

// The set always holds the default, and every element names something: the
// CHECK refuses what the handlers refuse, for a row written around them.
func TestTenantsSupportedLocalesCheck(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	insert := func(defaultLocale string, supportedLocales []string) error {
		id := uuid.Must(uuid.NewV7())
		slug := id.String()[24:]
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, supported_locales)
			VALUES ($1, $2, $3, $4, 'Locales Tenant', 'active', $5, $6)
		`, id, slug, slug+".example.com", "admin-"+slug+".example.com", defaultLocale, pq.Array(supportedLocales))
		return err
	}

	if err := insert("en", []string{"ja", "en"}); err != nil {
		t.Fatalf("insert a set that holds its default: %v", err)
	}

	for name, supportedLocales := range map[string][]string{
		"default left out": {"ja", "ko"},
		"empty":            {},
		"blank element":    {"en", ""},
		"padded element":   {"en", " ko"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := insert("en", supportedLocales); !isCheckViolation(err) {
				t.Fatalf("insert %q error = %v, want check_violation", supportedLocales, err)
			}
		})
	}

	t.Run("NULL element", func(t *testing.T) {
		id := uuid.Must(uuid.NewV7())
		slug := id.String()[24:]
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, supported_locales)
			VALUES ($1, $2, $3, $4, 'Locales Tenant', 'active', 'en', ARRAY['en', NULL])
		`, id, slug, slug+".example.com", "admin-"+slug+".example.com")
		if !isCheckViolation(err) {
			t.Fatalf("insert with a NULL element error = %v, want check_violation", err)
		}
	})

	t.Run("default moved out of the set", func(t *testing.T) {
		tenant := pg.SeedTenant(t, "TENANTU", "tenant-u.example.com", "Tenant U")
		_, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET supported_locales = ARRAY['en'] WHERE id = $1", tenant.ID)
		if !isCheckViolation(err) {
			t.Fatalf("update leaving the default %q out error = %v, want check_violation", tenant.DefaultLocale, err)
		}
	})
}
