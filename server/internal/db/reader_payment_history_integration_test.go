package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// The history a provider is told of a reader leaves out the payments made
// through that provider, as well as test payments and payments in another
// currency, and counts what was refunded off what was paid.
func TestReaderPaymentHistoryLeavesOutTheProvidersOwnPayments(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "HISTORYTN001", "history.example.com", "admin-history.example.com", "History Tenant")
	readerID := mustInsertUser(t, ctx, pg.DB, tenantID, "HISTORYRD001", "history-reader@example.com", "History Reader")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "HISTORYEP001", "History Episode")

	paidAt := time.Date(2026, time.March, 1, 12, 0, 0, 0, time.UTC)
	for _, p := range []struct {
		provider string
		price    int32
		refunded int32
		currency string
		test     bool
		at       time.Time
	}{
		{provider: "stripe", price: 500, refunded: 100, currency: "JPY", at: paidAt},
		{provider: "paidy", price: 300, currency: "JPY", at: paidAt.Add(24 * time.Hour)},
		{provider: "stripe", price: 700, currency: "JPY", test: true, at: paidAt.Add(48 * time.Hour)},
		{provider: "stripe", price: 900, currency: "USD", at: paidAt.Add(72 * time.Hour)},
	} {
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, refunded_amount, currency, is_test, purchased_at, provider, provider_checkout_id)
			VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), $7, $8, $9, $10, $11)
		`, uuid.Must(uuid.NewV7()), tenantID, readerID, episodeID, p.price, p.refunded, p.currency, p.test, p.at, p.provider, "checkout_"+uuid.NewString()); err != nil {
			t.Fatalf("insert %s purchase: %v", p.provider, err)
		}
	}

	history := func(provider string) dbmodels.GetReaderPaymentHistoryRow {
		t.Helper()
		row, err := dbmodels.New(pg.DB).GetReaderPaymentHistory(ctx, dbmodels.GetReaderPaymentHistoryParams{
			Currency: "JPY",
			Provider: provider,
			TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
			UserID:   readerID,
		})
		if err != nil {
			t.Fatalf("GetReaderPaymentHistory for %s: %v", provider, err)
		}
		return row
	}

	if got := history("paidy"); got.Payments != 1 || got.AmountPaid != 400 || got.LastAmount != 500 || !got.LastPaidAt.Equal(paidAt) {
		t.Fatalf("history told to paidy = %d payments, %d paid, last %d at %v; want the Stripe payment alone: 1, 400, 500 at %v", got.Payments, got.AmountPaid, got.LastAmount, got.LastPaidAt, paidAt)
	}
	if got := history("stripe"); got.Payments != 1 || got.AmountPaid != 300 || got.LastAmount != 300 || !got.LastPaidAt.Equal(paidAt.Add(24*time.Hour)) {
		t.Fatalf("history told to stripe = %d payments, %d paid, last %d at %v; want the Paidy payment alone", got.Payments, got.AmountPaid, got.LastAmount, got.LastPaidAt)
	}
}
