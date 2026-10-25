package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// tenant_coin_name_for answers the asked locale's name, then the tenant
// default locale's, then the oldest, as series_translation_for picks a series
// title. The storefront reads it as publira_public, under its own tenant.
func TestTenantCoinNameForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	unnamed := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	// The default locale's name is written first and the en one after it, so
	// the oldest is the ja one until it is deleted.
	mustExec(t, ctx, pg.DB, `
		INSERT INTO tenant_coin_name_translations (id, tenant_id, locale, name, created_at)
		VALUES (uuidv7(), $1, 'ja', 'Tickets', now() - interval '1 minute'),
			(uuidv7(), $1, 'en', 'Points', now())
	`, tenant.ID)

	public := pg.OpenPublicDB(t)
	name := func(tenantID uuid.UUID, locale string) (string, bool) {
		t.Helper()
		conn, err := public.Conn(ctx)
		if err != nil {
			t.Fatalf("public conn: %v", err)
		}
		defer func() { _ = conn.Close() }()
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
			t.Fatalf("set app.current_tenant_id: %v", err)
		}
		var got string
		err = conn.QueryRowContext(ctx, `SELECT tcn.name FROM tenant_coin_name_for($1, $2) tcn`, tenantID, locale).Scan(&got)
		if errors.Is(err, sql.ErrNoRows) {
			return "", false
		}
		if err != nil {
			t.Fatalf("tenant_coin_name_for(%q): %v", locale, err)
		}
		return got, true
	}
	expect := func(step, locale, want string) {
		t.Helper()
		if got, _ := name(tenant.ID, locale); got != want {
			t.Fatalf("%s: name for %q = %q, want %q", step, locale, got, want)
		}
	}

	expect("asked locale", "en", "Points")
	expect("a locale with no name", "ko", "Tickets")
	expect("no locale", "", "Tickets")

	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, tenant.ID)
	expect("oldest after the default moved", "zh-Hans", "Tickets")

	mustExec(t, ctx, pg.DB, `DELETE FROM tenant_coin_name_translations WHERE tenant_id = $1 AND locale = 'ja'`, tenant.ID)
	expect("oldest left", "zh-Hans", "Points")

	if got, ok := name(unnamed.ID, "ja"); ok {
		t.Fatalf("a tenant with no name answered %q, want no row", got)
	}
}

// Coins are refused on while any disclosure, the coin's value, or its expiry
// is missing, whoever writes the row.
func TestTenantCoinConfigRefusesCoinsOnWithoutTheDisclosures(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	mustExec(t, ctx, pg.DB, `INSERT INTO tenant_coin_config (tenant_id) VALUES ($1)`, tenant.ID)
	mustExec(t, ctx, pg.DB, `
		UPDATE tenant_coin_config
		SET coin_unit_amount = 1, expiry_days = 180, issuer_name = 'Tenant A Inc.',
			terms_url = 'https://tenant-a.example.com/coins/terms', contact = 'coins@tenant-a.example.com',
			notice = 'Coins expire 180 days after purchase.'
		WHERE tenant_id = $1
	`, tenant.ID)

	for _, unset := range []string{
		"coin_unit_amount = NULL",
		"expiry_days = NULL",
		"issuer_name = ' '",
		"terms_url = ''",
		"contact = ''",
		"notice = ''",
	} {
		_, err := pg.DB.ExecContext(ctx, `UPDATE tenant_coin_config SET enabled = true, `+unset+` WHERE tenant_id = $1`, tenant.ID)
		if !isCheckViolation(err) || checkName(err) != "tenant_coin_config_enabled_requires_disclosures" {
			t.Fatalf("enabled with %s: error = %v, want tenant_coin_config_enabled_requires_disclosures", unset, err)
		}
	}
	mustExec(t, ctx, pg.DB, `UPDATE tenant_coin_config SET enabled = true WHERE tenant_id = $1`, tenant.ID)
}

// A sold pack keeps its price and coins, and the fact that it was sold, for
// every role; its sale state, its order, and its retirement still change.
func TestTenantCoinPacksKeepASoldPacksTerms(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	packID := uuid.Must(uuid.NewV7())
	mustExec(t, ctx, pg.DB, `
		INSERT INTO tenant_coin_packs (id, tenant_id, public_id, coins, bonus_coins, price, on_sale)
		VALUES ($1, $2, 'COINPACK0001', 100, 10, 100, true)
	`, packID, tenant.ID)
	mustExec(t, ctx, pg.DB, `UPDATE tenant_coin_packs SET price = 120 WHERE id = $1`, packID)
	mustExec(t, ctx, pg.DB, `UPDATE tenant_coin_packs SET first_sold_at = now() WHERE id = $1`, packID)

	for _, change := range []string{
		"price = 100",
		"coins = 120",
		"bonus_coins = 0",
		"first_sold_at = NULL",
	} {
		_, err := pg.DB.ExecContext(ctx, `UPDATE tenant_coin_packs SET `+change+` WHERE id = $1`, packID)
		if !isRestrictViolation(err) {
			t.Fatalf("%s on a sold pack: error = %v, want restrict_violation", change, err)
		}
	}
	mustExec(t, ctx, pg.DB, `UPDATE tenant_coin_packs SET on_sale = false, sort_order = 3 WHERE id = $1`, packID)
	mustExec(t, ctx, pg.DB, `UPDATE tenant_coin_packs SET retired_at = now() WHERE id = $1`, packID)

	_, err := pg.DB.ExecContext(ctx, `UPDATE tenant_coin_packs SET on_sale = true WHERE id = $1`, packID)
	if !isCheckViolation(err) || checkName(err) != "tenant_coin_packs_retired_not_on_sale_check" {
		t.Fatalf("a retired pack put on sale: error = %v, want tenant_coin_packs_retired_not_on_sale_check", err)
	}
}
