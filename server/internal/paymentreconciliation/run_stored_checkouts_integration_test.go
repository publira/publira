package paymentreconciliation_test

import (
	"bytes"
	"context"
	"database/sql"
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
// is found, as a payment another provider lists is, whether the provider names
// the payment by an id of its own or by its checkout's.
func TestDBReconciliationReadsThePaymentOfEveryStoredCheckout(t *testing.T) {
	t.Parallel()
	for id, newFixture := range map[string]func(testing.TB) *readbacktest.Fixture{
		readbacktest.ID:           readbacktest.NewFixture,
		readbacktest.IDByCheckout: readbacktest.NewFixtureByCheckout,
	} {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			testReconciliationReadsThePaymentOfEveryStoredCheckout(t, newFixture(t))
		})
	}
}

func testReconciliationReadsThePaymentOfEveryStoredCheckout(t *testing.T, fixture *readbacktest.Fixture) {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	ctx := context.Background()
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	registry := paymentprovider.NewRegistry(fixture.Provider())
	providerID := fixture.Provider().Declaration().ID
	credentials := fixture.Credentials()
	tenant := pg.SeedTenant(t, "RECONSTORE01", "reconcile-stored.example.com", "Reconcile stored")
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: providerID,
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
		`, tenant.ID, providerID, checkoutID, first, last); err != nil {
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
	// reported is the id the provider reports for the payment paymentID of the
	// checkout checkoutID, which a purchase and a finding record.
	reported := fixture.API().PaymentID
	bought := func(checkoutID, paymentID string, at time.Time) {
		t.Helper()
		paymentID = reported(checkoutID, paymentID)
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
				provider, provider_checkout_id, provider_payment_id)
			VALUES ($1, $2, $3, $4, 500, 'JPY', $5, $6, $7, $8)
		`, uuid.New(), tenant.ID, reader.ID, episode.ID, at, providerID, checkoutID, paymentID); err != nil {
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
	`, runID, tenant.ID, providerID, march, march.AddDate(0, 1, -1), march, march.AddDate(0, 1, 0)); err != nil {
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
		paymentreconciliation.KindRecordUnmatched + " " + reported("checkout_overnight", "payment_overnight"),
		paymentreconciliation.KindRecordUnmatched + " " + reported("checkout_lost", "payment_lost"),
		paymentreconciliation.KindRecordUnmatched + " " + reported("checkout_retried", "payment_retried"),
	}
	if !slices.Equal(got, want) {
		t.Fatalf("findings = %v, want %v", got, want)
	}
}

// A provider whose test mode follows its credentials lists under a tenant's
// credentials the payments of the mode they name and no others, so a run
// reads the purchases of that mode alone: the test purchases a tenant made
// in the sandbox before saving its live credentials match nothing the run
// could list, and are no finding of it, and the live ones are none of a run
// read under the sandbox's.
func TestDBReconciliationReadsThePurchasesOfTheModeTheCredentialsName(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx := context.Background()
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	fixture := readbacktest.NewFixtureByCredentials(t)
	registry := paymentprovider.NewRegistry(fixture.Provider())
	providerID := fixture.Provider().Declaration().ID
	tenant := pg.SeedTenant(t, "RECONMODE01", "reconcile-mode.example.com", "Reconcile mode")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RECONMDSER"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RECONMDEP1", Price: 500})
	reader := pg.SeedEndUser(t, tenant.ID, "RECONMDUSR", "reader@reconcile-mode.example.com", "Reader")

	save := func(credentials paymentprovider.Credentials) {
		t.Helper()
		var fields []paymentsettings.FieldUpdate
		for _, name := range []string{readbacktest.FieldAPIKey, readbacktest.FieldEnvironment} {
			field := paymentsettings.FieldUpdate{Name: name, Mode: secretupdate.Replace, Value: credentials[name]}
			if field.Value == "" {
				field.Mode = secretupdate.Clear
			}
			fields = append(fields, field)
		}
		if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
			Provider: providerID,
			Enabled:  true,
			Currency: "JPY",
			Fields:   fields,
		}, paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("save payment settings: %v", err)
		}
	}
	march := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	// bought has the provider take, under credentials, the payment of a
	// checkout started at at, and records its purchase as the notification
	// read under them would.
	bought := func(credentials paymentprovider.Credentials, checkoutID string, at time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO payment_checkouts (tenant_id, provider, checkout_id, purchase, created_at, last_started_at)
			VALUES ($1, $2, $3, '{}', $4, $4)
		`, tenant.ID, providerID, checkoutID, at); err != nil {
			t.Fatalf("store a checkout: %v", err)
		}
		test := fixture.Provider().(paymentprovider.TestModeByCredentials).TestMode(credentials)
		fixture.API().Pay(credentials, checkoutID, "payment_"+checkoutID, 500, "JPY", test, at.Add(time.Minute))
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
				provider, provider_checkout_id, provider_payment_id, is_test)
			VALUES ($1, $2, $3, $4, 500, 'JPY', $5, $6, $7, $8, $9)
		`, uuid.New(), tenant.ID, reader.ID, episode.ID, at.Add(2*time.Minute), providerID, checkoutID, "payment_"+checkoutID, test); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
	}
	// reconcile runs March under the credentials the tenant saved last, in
	// place of the run before it, and answers the run's purchase and match
	// counts and its findings.
	reconcile := func() (int32, int32, []string) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `DELETE FROM payment_reconciliations WHERE tenant_id = $1`, tenant.ID); err != nil {
			t.Fatalf("delete the run before: %v", err)
		}
		runID := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO payment_reconciliations (id, tenant_id, provider, start_date, end_date, time_zone, starts_at, ends_at)
			VALUES ($1, $2, $3, $4, $5, 'UTC', $6, $7)
		`, runID, tenant.ID, providerID, march, march.AddDate(0, 1, -1), march, march.AddDate(0, 1, 0)); err != nil {
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
		var purchases, matched int32
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT purchase_count, matched_count FROM payment_reconciliations WHERE tenant_id = $1 AND id = $2
		`, tenant.ID, runID).Scan(&purchases, &matched); err != nil {
			t.Fatalf("read the run: %v", err)
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
		var findings []string
		for rows.Next() {
			var kind, paymentID string
			if err := rows.Scan(&kind, &paymentID); err != nil {
				t.Fatalf("scan finding: %v", err)
			}
			findings = append(findings, kind+" "+paymentID)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list findings: %v", err)
		}
		return purchases, matched, findings
	}

	// The tenant tried its checkout in the sandbox, then saved its live
	// credentials and sold the episode, and one live payment's notification
	// never arrived.
	sandbox := fixture.TestCredentials()
	live := fixture.Credentials()
	save(sandbox)
	bought(sandbox, "checkout_sandbox", march.Add(2*24*time.Hour))
	bought(live, "checkout_live", march.Add(5*24*time.Hour))
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO payment_checkouts (tenant_id, provider, checkout_id, purchase, created_at, last_started_at)
		VALUES ($1, $2, 'checkout_lost', '{}', $3, $3)
	`, tenant.ID, providerID, march.Add(6*24*time.Hour)); err != nil {
		t.Fatalf("store a checkout: %v", err)
	}
	fixture.API().Pay(live, "checkout_lost", "payment_checkout_lost", 500, "JPY", false, march.Add(6*24*time.Hour+time.Minute))

	save(live)
	purchases, matched, findings := reconcile()
	if want := []string{paymentreconciliation.KindRecordUnmatched + " payment_checkout_lost"}; purchases != 1 || matched != 1 || !slices.Equal(findings, want) {
		t.Fatalf("under the live credentials: purchases %d, matched %d, findings %v; want 1, 1, %v", purchases, matched, findings, want)
	}

	save(sandbox)
	purchases, matched, findings = reconcile()
	if purchases != 1 || matched != 1 || len(findings) != 0 {
		t.Fatalf("under the sandbox's credentials: purchases %d, matched %d, findings %v; want 1, 1, none", purchases, matched, findings)
	}
}

// A provider whose checkouts run in the reader's browser reads a payment by
// its own id alone, so a run reads the payment the server kept beside each
// checkout it completed: a payment captured and kept whose purchase was never
// recorded is found, one recorded is matched, and a checkout no payment
// completed is read for nothing.
func TestDBReconciliationReadsThePaymentKeptBesideABrowserCheckout(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx := context.Background()
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	fixture := readbacktest.NewFixtureInBrowser(t)
	registry := paymentprovider.NewRegistry(fixture.Provider())
	providerID := fixture.Provider().Declaration().ID
	credentials := fixture.Credentials()
	tenant := pg.SeedTenant(t, "RECONBROWS01", "reconcile-browser.example.com", "Reconcile browser")
	var fields []paymentsettings.FieldUpdate
	for _, name := range []string{readbacktest.FieldAPIKey, readbacktest.FieldPublicKey} {
		fields = append(fields, paymentsettings.FieldUpdate{Name: name, Mode: secretupdate.Replace, Value: credentials[name]})
	}
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: providerID,
		Enabled:  true,
		Currency: "JPY",
		Fields:   fields,
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("save payment settings: %v", err)
	}
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RECONBRSER"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RECONBREP1", Price: 500})
	reader := pg.SeedEndUser(t, tenant.ID, "RECONBRUSR", "reader@reconcile-browser.example.com", "Reader")

	march := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	queries := dbmodels.New(pg.DB)
	// started writes down a checkout started at at.
	started := func(checkoutID string, at time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO payment_checkouts (tenant_id, provider, checkout_id, purchase, created_at, last_started_at)
			VALUES ($1, $2, $3, '{}', $4, $4)
		`, tenant.ID, providerID, checkoutID, at); err != nil {
			t.Fatalf("store a checkout: %v", err)
		}
	}
	// completed has the script's payment paymentID of the checkout captured
	// at paidAt and kept beside the checkout, as the server keeps the payment
	// that completes one.
	completed := func(checkoutID, paymentID string, paidAt time.Time) {
		t.Helper()
		fixture.API().Pay(credentials, checkoutID, paymentID, 500, "JPY", false, paidAt)
		if err := queries.KeepPaymentCheckoutPayment(ctx, dbmodels.KeepPaymentCheckoutPaymentParams{
			PaymentID:  sql.NullString{String: paymentID, Valid: true},
			TenantID:   tenant.ID,
			Provider:   providerID,
			CheckoutID: checkoutID,
		}); err != nil {
			t.Fatalf("keep the payment of a checkout: %v", err)
		}
	}
	bought := func(checkoutID, paymentID string, at time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
				provider, provider_checkout_id, provider_payment_id)
			VALUES ($1, $2, $3, $4, 500, 'JPY', $5, $6, $7, $8)
		`, uuid.New(), tenant.ID, reader.ID, episode.ID, at, providerID, checkoutID, paymentID); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
	}

	started("checkout_recorded", march.Add(5*24*time.Hour))
	completed("checkout_recorded", "payment_recorded", march.Add(5*24*time.Hour+time.Minute))
	bought("checkout_recorded", "payment_recorded", march.Add(5*24*time.Hour+2*time.Minute))
	started("checkout_lost", march.Add(6*24*time.Hour))
	completed("checkout_lost", "payment_lost", march.Add(6*24*time.Hour+time.Minute))
	// The script authorized a payment no one completed, and the server kept
	// nothing beside the checkout.
	started("checkout_authorized", march.Add(7*24*time.Hour))
	fixture.API().Authorize(credentials, "checkout_authorized", "payment_authorized", 500, "JPY", false, march.Add(7*24*time.Hour+time.Minute))

	runID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO payment_reconciliations (id, tenant_id, provider, start_date, end_date, time_zone, starts_at, ends_at)
		VALUES ($1, $2, $3, $4, $5, 'UTC', $6, $7)
	`, runID, tenant.ID, providerID, march, march.AddDate(0, 1, -1), march, march.AddDate(0, 1, 0)); err != nil {
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
	var purchases, matched int32
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT purchase_count, matched_count FROM payment_reconciliations WHERE tenant_id = $1 AND id = $2
	`, tenant.ID, runID).Scan(&purchases, &matched); err != nil {
		t.Fatalf("read the run: %v", err)
	}
	var findings []string
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
	for rows.Next() {
		var kind, paymentID string
		if err := rows.Scan(&kind, &paymentID); err != nil {
			t.Fatalf("scan finding: %v", err)
		}
		findings = append(findings, kind+" "+paymentID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list findings: %v", err)
	}
	if want := []string{paymentreconciliation.KindRecordUnmatched + " payment_lost"}; purchases != 1 || matched != 1 || !slices.Equal(findings, want) {
		t.Fatalf("purchases %d, matched %d, findings %v; want 1, 1, %v", purchases, matched, findings, want)
	}
}
