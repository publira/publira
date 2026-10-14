package dbtest

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/testutil"
)

// The last migration before tenants stored the locales their site offers.
const beforeSupportedLocalesVersion = 20261014105706

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

	// The schema before this one asked only for a default that is not blank,
	// so a write around the API could store one padded with any whitespace, or
	// a code the registry does not know. None of them may stop the upgrade.
	defaults := map[string]string{
		"TENANTA": "ja",
		"TENANTB": " en ",
		"TENANTC": "\ten\n",
		"TENANTD": "fr",
	}
	ids := make(map[string]uuid.UUID, len(defaults))
	for publicID, defaultLocale := range defaults {
		tenant := pg.SeedTenantOnOlderSchema(t, publicID, strings.ToLower(publicID)+".example.com", publicID)
		mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = $2 WHERE id = $1`, tenant.ID, defaultLocale)
		ids[publicID] = tenant.ID
	}
	pg.MigrateUp(t)

	every := []string{"ja", "en", "ko", "zh-Hans", "zh-Hant"}
	for _, tt := range []struct {
		publicID string
		want     []string
		// resolved is what a read of the tenant answers for the set.
		resolved []string
	}{
		{publicID: "TENANTA", want: every, resolved: every},
		{publicID: "TENANTB", want: append(slices.Clone(every), " en "), resolved: every},
		{publicID: "TENANTC", want: append(slices.Clone(every), "\ten\n"), resolved: every},
		{publicID: "TENANTD", want: append(slices.Clone(every), "fr")},
	} {
		var gotDefault string
		var got []string
		if err := pg.DB.QueryRowContext(ctx, "SELECT default_locale, supported_locales FROM tenants WHERE id = $1", ids[tt.publicID]).Scan(&gotDefault, pq.Array(&got)); err != nil {
			t.Fatalf("%s: read the locales: %v", tt.publicID, err)
		}
		if gotDefault != defaults[tt.publicID] || !slices.Equal(got, tt.want) {
			t.Fatalf("%s: locales = %q %q, want %q %q", tt.publicID, gotDefault, got, defaults[tt.publicID], tt.want)
		}
		resolved, err := locale.ResolveSupported(got)
		if tt.resolved == nil {
			if !errors.Is(err, locale.ErrSupportedUnresolved) {
				t.Fatalf("%s: ResolveSupported error = %v, want ErrSupportedUnresolved", tt.publicID, err)
			}
			continue
		}
		if err != nil || !slices.Equal(resolved, tt.resolved) {
			t.Fatalf("%s: ResolveSupported = %q, %v, want %q", tt.publicID, resolved, err, tt.resolved)
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

// The set always holds the default, and no element is blank in the sense the
// default's own CHECK uses: the CHECK refuses a row written around the handlers
// that the handlers would refuse.
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
		"empty element":    {"en", ""},
		"blank element":    {"en", "   "},
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
