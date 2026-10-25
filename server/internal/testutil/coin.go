package testutil

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// CoinSettingsSeed describes a tenant's coin settings to insert. A zero seed
// turns coins on, selling, at 10 a coin with an expiry of 180 days, and names
// the coin in no locale.
type CoinSettingsSeed struct {
	Disabled   bool
	NotSelling bool
	// UnitAmount is what one coin is worth; 0 is 10.
	UnitAmount int32
	ExpiryDays int32
	// Names is the coin's name per locale.
	Names map[string]string
}

// SeedCoinSettings inserts the tenant's coin settings with every disclosure
// filled in, and the coin's names, the way UpdateTenantCoinSettings stores
// them.
func (e *PostgresEnv) SeedCoinSettings(t *testing.T, tenantID uuid.UUID, seed CoinSettingsSeed) {
	t.Helper()
	e.requireDB(t)

	unitAmount := seed.UnitAmount
	if unitAmount == 0 {
		unitAmount = 10
	}
	expiryDays := seed.ExpiryDays
	if expiryDays == 0 {
		expiryDays = 180
	}
	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO tenant_coin_config (tenant_id, enabled, selling, coin_unit_amount, expiry_days, issuer_name, terms_url, contact, notice)
		VALUES ($1, $2, $3, $4, $5, 'Issuer Inc.', 'https://issuer.example.com/coins/terms', 'coins@issuer.example.com', 'Coins expire unspent and are not refunded.')
	`, tenantID, !seed.Disabled, !seed.NotSelling, unitAmount, expiryDays); err != nil {
		t.Fatalf("insert coin settings of tenant %s: %v", tenantID, err)
	}
	for code, name := range seed.Names {
		if _, err := e.DB.ExecContext(ctx, `
			INSERT INTO tenant_coin_name_translations (id, tenant_id, locale, name)
			VALUES ($1, $2, $3, $4)
		`, uuid.Must(uuid.NewV7()), tenantID, code, name); err != nil {
			t.Fatalf("insert the %s coin name of tenant %s: %v", code, tenantID, err)
		}
	}
}

// SeedCoinGrant grants the reader coins that expire at expiresAt, as a member
// of staff would, with the grant in the reader's coin history. An expiresAt in
// the past seeds a grant the expiry job has yet to reach. Returns the grant's
// id.
func (e *PostgresEnv) SeedCoinGrant(t *testing.T, tenantID, userID uuid.UUID, coins int32, expiresAt time.Time) uuid.UUID {
	t.Helper()
	e.requireDB(t)

	grantID := uuid.Must(uuid.NewV7())
	grantedAt := time.Now()
	if dayBefore := expiresAt.Add(-24 * time.Hour); dayBefore.Before(grantedAt) {
		grantedAt = dayBefore
	}
	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO coin_grants (id, tenant_id, user_id, source, coins, remaining_coins, expires_at, granted_at)
		VALUES ($1, $2, $3, 'staff', $4, $4, $5, $6)
	`, grantID, tenantID, userID, coins, expiresAt, grantedAt); err != nil {
		t.Fatalf("insert coin grant of user %s: %v", userID, err)
	}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO coin_transactions (id, tenant_id, user_id, kind, coins, grant_id, created_at)
		VALUES ($1, $2, $3, 'grant', $4, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenantID, userID, coins, grantID, grantedAt); err != nil {
		t.Fatalf("insert the grant transaction of user %s: %v", userID, err)
	}
	return grantID
}
