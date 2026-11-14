package paymentreconciliation_test

import (
	"bytes"
	"context"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest/readbacktest"
	"github.com/publira/publira/server/internal/paymentreconciliation"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

// A provider whose API lists no payments is read through the checkouts the
// server started with it: a payment of one of them that no purchase records
// is found, as a payment another provider lists is.
func TestDBReconciliationReadsThePaymentOfEveryStoredCheckout(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx := context.Background()
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	fixture := readbacktest.NewFixture(t)
	registry := paymentprovider.NewRegistry(fixture.Provider())
	credentials := fixture.Credentials()
	tenant := pg.SeedTenant(t, "RECONSTORE01", "reconcile-stored.example.com", "Reconcile stored")
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: readbacktest.ID,
		Enabled:  true,
		Currency: "JPY",
		Fields:   []paymentsettings.FieldUpdate{{Name: readbacktest.FieldAPIKey, Mode: secretupdate.Replace, Value: credentials[readbacktest.FieldAPIKey]}},
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("save payment settings: %v", err)
	}
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RECONSTSER"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RECONSTEP1", Price: 500})
	reader := pg.SeedEndUser(t, tenant.ID, "RECONSTUSR", "reader@reconcile-stored.example.com", "Reader")

	march := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	// startedAgain writes down a checkout first started at first and last at
	// last, as the server does for a request and its retries, started one
	// started once, and paid has the provider take its payment at paidAt.
	startedAgain := func(checkoutID string, first, last time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO payment_checkouts (tenant_id, provider, checkout_id, purchase, created_at, last_started_at)
			VALUES ($1, $2, $3, '{}', $4, $5)
		`, tenant.ID, readbacktest.ID, checkoutID, first, last); err != nil {
			t.Fatalf("store a checkout: %v", err)
		}
	}
	started := func(checkoutID string, at time.Time) {
		t.Helper()
		startedAgain(checkoutID, at, at)
	}
	paid := func(checkoutID, paymentID string, paidAt time.Time) {
		fixture.API().Pay(credentials, checkoutID, paymentID, 500, "JPY", false, paidAt)
	}
	bought := func(checkoutID, paymentID string, at time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
				provider, provider_checkout_id, provider_payment_id)
			VALUES ($1, $2, $3, $4, 500, 'JPY', $5, $6, $7, $8)
		`, uuid.New(), tenant.ID, reader.ID, episode.ID, at, readbacktest.ID, checkoutID, paymentID); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
	}

	// A checkout paid and recorded, one paid with no notification, one
	// started just before the month and paid in it, one first started long
	// before the month and started again, and made, only in it, and one never
	// paid.
	started("checkout_recorded", march.Add(5*24*time.Hour))
	paid("checkout_recorded", "payment_recorded", march.Add(5*24*time.Hour+time.Minute))
	bought("checkout_recorded", "payment_recorded", march.Add(5*24*time.Hour+2*time.Minute))
	started("checkout_lost", march.Add(6*24*time.Hour))
	paid("checkout_lost", "payment_lost", march.Add(6*24*time.Hour+time.Minute))
	started("checkout_overnight", march.Add(-paymentreconciliation.Margin-readbacktest.CheckoutLifetime/2))
	paid("checkout_overnight", "payment_overnight", march.Add(time.Minute))
	startedAgain("checkout_retried", march.AddDate(0, 0, -20), march.Add(8*24*time.Hour))
	paid("checkout_retried", "payment_retried", march.Add(8*24*time.Hour+time.Minute))
	started("checkout_unpaid", march.Add(7*24*time.Hour))

	runID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO payment_reconciliations (id, tenant_id, provider, start_date, end_date, time_zone, starts_at, ends_at)
		VALUES ($1, $2, $3, $4, $5, 'UTC', $6, $7)
	`, runID, tenant.ID, readbacktest.ID, march, march.AddDate(0, 1, -1), march, march.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("insert reconciliation: %v", err)
	}
	summary, err := paymentreconciliation.RunPending(ctx, paymentreconciliation.Deps{
		DB:       pg.OpenContentStatsDB(t),
		Secrets:  encryptor,
		Payments: registry,
		Logger:   slog.New(slog.DiscardHandler),
	})
	if err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if summary.Succeeded != 1 {
		t.Fatalf("summary = %+v, want the run to succeed", summary)
	}

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT kind, COALESCE(provider_payment_id, '')
		FROM payment_reconciliation_findings
		WHERE tenant_id = $1 AND reconciliation_id = $2
		ORDER BY occurred_at, id
	`, tenant.ID, runID)
	if err != nil {
		t.Fatalf("list findings: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []string
	for rows.Next() {
		var kind, paymentID string
		if err := rows.Scan(&kind, &paymentID); err != nil {
			t.Fatalf("scan finding: %v", err)
		}
		got = append(got, kind+" "+paymentID)
	}
	want := []string{
		paymentreconciliation.KindRecordUnmatched + " payment_overnight",
		paymentreconciliation.KindRecordUnmatched + " payment_lost",
		paymentreconciliation.KindRecordUnmatched + " payment_retried",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("findings = %v, want %v", got, want)
	}
}
