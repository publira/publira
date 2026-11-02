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
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/paymentreconciliation"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

// stripeTenant is a tenant that takes payments through a fake of Stripe.
type stripeTenant struct {
	pg       *testutil.PostgresEnv
	tenantID uuid.UUID
	readerID uuid.UUID
	episode  uuid.UUID
	stripe   *stripetest.Fixture
	deps     paymentreconciliation.Deps
}

func newStripeTenant(t *testing.T) *stripeTenant {
	t.Helper()
	pg := testutil.StartIsolatedPostgres(t)
	ctx := context.Background()
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	fixture := stripetest.NewFixture(t)
	registry := paymentprovider.NewRegistry(fixture.Provider())
	tenant := pg.SeedTenant(t, "RECONCILE001", "reconcile.example.com", "Reconcile")
	credentials := fixture.Credentials()
	if _, err := paymentsettings.New(dbmodels.New(pg.DB), encryptor, registry, nil, slog.Default()).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider: stripe.ID,
		Enabled:  true,
		Currency: "JPY",
		Fields: []paymentsettings.FieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: secretupdate.Replace, Value: credentials[stripe.FieldSecretKey]},
			{Name: stripe.FieldWebhookSecret, Mode: secretupdate.Replace, Value: credentials[stripe.FieldWebhookSecret]},
		},
	}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("save payment settings: %v", err)
	}
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RECONSER"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RECONEP1", Price: 500})
	reader := pg.SeedEndUser(t, tenant.ID, "RECONUSR", "reader@reconcile.example.com", "Reader")
	return &stripeTenant{
		pg: pg, tenantID: tenant.ID, readerID: reader.ID, episode: episode.ID, stripe: fixture,
		deps: paymentreconciliation.Deps{
			DB:       pg.OpenContentStatsDB(t),
			Secrets:  encryptor,
			Payments: registry,
			Logger:   slog.New(slog.DiscardHandler),
		},
	}
}

// paid makes Stripe hold a payment of price taken at at.
func (s *stripeTenant) paid(t *testing.T, paymentID string, price int32, test bool, at time.Time) {
	t.Helper()
	s.stripe.PaymentTaken(t, s.stripe.Credentials(), paymentprovidertest.Checkout{
		PaymentID: paymentID,
		Purchase:  paymentprovider.Purchase{Price: price, Currency: "JPY"},
		Test:      test,
	}, at)
}

// bought records the purchase a payment's notification would have recorded.
func (s *stripeTenant) bought(t *testing.T, paymentID string, price int32, test bool, at time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := s.pg.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
			provider, provider_checkout_id, provider_payment_id, is_test)
		VALUES ($1, $2, $3, $4, $5, 'JPY', $6, 'stripe', $7, $8, $9)
	`, id, s.tenantID, s.readerID, s.episode, price, at, "cs_"+paymentID, paymentID, test); err != nil {
		t.Fatalf("insert purchase: %v", err)
	}
	return id
}

// start writes a run of the month from first, as StartPaymentReconciliation
// does.
func (s *stripeTenant) start(t *testing.T, first time.Time) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := s.pg.DB.ExecContext(context.Background(), `
		INSERT INTO payment_reconciliations (id, tenant_id, provider, start_date, end_date, time_zone, starts_at, ends_at)
		VALUES ($1, $2, 'stripe', $3, $4, 'UTC', $5, $6)
	`, id, s.tenantID, first, first.AddDate(0, 1, -1), first, first.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("insert reconciliation: %v", err)
	}
	return id
}

type finding struct {
	kind      string
	test      bool
	paymentID string
	purchase  uuid.NullUUID
}

func (s *stripeTenant) findings(t *testing.T, runID uuid.UUID) []finding {
	t.Helper()
	rows, err := s.pg.DB.QueryContext(context.Background(), `
		SELECT kind, is_test, COALESCE(provider_payment_id, ''), purchase_id
		FROM payment_reconciliation_findings
		WHERE tenant_id = $1 AND reconciliation_id = $2
		ORDER BY occurred_at, id
	`, s.tenantID, runID)
	if err != nil {
		t.Fatalf("list findings: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []finding
	for rows.Next() {
		var f finding
		if err := rows.Scan(&f.kind, &f.test, &f.paymentID, &f.purchase); err != nil {
			t.Fatalf("scan finding: %v", err)
		}
		got = append(got, f)
	}
	return got
}

func (s *stripeTenant) run(t *testing.T, runID uuid.UUID) dbmodels.PaymentReconciliation {
	t.Helper()
	run, err := dbmodels.New(s.pg.DB).GetPaymentReconciliation(context.Background(), dbmodels.GetPaymentReconciliationParams{TenantID: s.tenantID, ID: runID})
	if err != nil {
		t.Fatalf("get reconciliation: %v", err)
	}
	return run
}

func TestDBReconciliationFindsThePaymentWhoseNotificationNeverArrived(t *testing.T) {
	t.Parallel()
	s := newStripeTenant(t)
	february := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	march := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

	// February is clean: its one payment has its purchase.
	s.paid(t, "pi_feb", 500, false, february.Add(9*24*time.Hour))
	s.bought(t, "pi_feb", 500, false, february.Add(9*24*time.Hour+time.Minute))

	// In March one notification never arrived, a test payment has its test
	// purchase, and a live purchase meets only a test payment of the same id.
	s.paid(t, "pi_mar", 500, false, march.Add(9*24*time.Hour))
	s.bought(t, "pi_mar", 500, false, march.Add(9*24*time.Hour+time.Minute))
	s.paid(t, "pi_lost", 300, false, march.Add(10*24*time.Hour))
	s.paid(t, "pi_test", 200, true, march.Add(11*24*time.Hour))
	s.bought(t, "pi_test", 200, true, march.Add(11*24*time.Hour+time.Minute))
	s.paid(t, "pi_mode", 400, true, march.Add(12*24*time.Hour))
	livePurchase := s.bought(t, "pi_mode", 400, false, march.Add(12*24*time.Hour+time.Minute))

	// A refund that arrived in February for a payment no purchase names, and
	// one that arrived in March, after the March period began.
	if _, err := s.pg.DB.ExecContext(context.Background(), `
		INSERT INTO unapplied_refunds (tenant_id, provider, provider_payment_id, refunded_amount, currency, received_at)
		VALUES ($1, 'stripe', 'pi_held', 500, 'JPY', $2), ($1, 'stripe', 'pi_recent', 500, 'JPY', $3)
	`, s.tenantID, february.Add(20*24*time.Hour), march.Add(2*24*time.Hour)); err != nil {
		t.Fatalf("hold refunds: %v", err)
	}

	februaryRun := s.start(t, february)
	marchRun := s.start(t, march)
	summary, err := paymentreconciliation.RunPending(context.Background(), s.deps)
	if err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if summary.Succeeded != 2 || summary.Failed != 0 {
		t.Fatalf("summary = %+v, want both runs to succeed", summary)
	}

	if got := s.findings(t, februaryRun); len(got) != 0 {
		t.Fatalf("February findings = %+v, want none for a clean period", got)
	}
	if run := s.run(t, februaryRun); !run.FinishedAt.Valid || run.RecordCount.Int32 != 1 || run.MatchedCount.Int32 != 1 || run.FindingCount.Int32 != 0 {
		t.Fatalf("February run = %+v, want one payment matched", run)
	}

	want := []finding{
		{kind: paymentreconciliation.KindHeldRefund, paymentID: "pi_held"},
		{kind: paymentreconciliation.KindRecordUnmatched, paymentID: "pi_lost"},
		{kind: paymentreconciliation.KindRecordUnmatched, test: true, paymentID: "pi_mode"},
		{kind: paymentreconciliation.KindPurchaseUnmatched, paymentID: "pi_mode", purchase: uuid.NullUUID{UUID: livePurchase, Valid: true}},
	}
	if got := s.findings(t, marchRun); !slices.Equal(got, want) {
		t.Fatalf("March findings = %+v, want %+v", got, want)
	}
	if run := s.run(t, marchRun); run.RecordCount.Int32 != 4 || run.PurchaseCount.Int32 != 3 || run.MatchedCount.Int32 != 2 || run.FindingCount.Int32 != 4 {
		t.Fatalf("March run = %+v, want 4 payments, 3 purchases, 2 matched, 4 findings", run)
	}

	// A second pass finds nothing waiting.
	if summary, err := paymentreconciliation.RunPending(context.Background(), s.deps); err != nil || summary != (paymentreconciliation.Summary{}) {
		t.Fatalf("second pass = %+v, %v; want nothing run", summary, err)
	}
}

func TestDBReconciliationRecordsCredentialsTheProviderRefuses(t *testing.T) {
	t.Parallel()
	s := newStripeTenant(t)
	s.stripe.API.RevokeSecretKey(s.stripe.Credentials()[stripe.FieldSecretKey])
	runID := s.start(t, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC))

	summary, err := paymentreconciliation.RunPending(context.Background(), s.deps)
	if err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if summary.Failed != 1 {
		t.Fatalf("summary = %+v, want the run failed", summary)
	}
	run := s.run(t, runID)
	if !run.FinishedAt.Valid || run.Failure != (sql.NullString{String: paymentreconciliation.FailureCredentials, Valid: true}) || run.RecordCount.Valid {
		t.Fatalf("run = %+v, want it failed on its credentials with no counts", run)
	}
}
