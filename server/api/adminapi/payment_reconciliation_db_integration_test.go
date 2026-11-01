package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) reconciliationClient() publiraadminv1connect.AdminPaymentReconciliationServiceClient {
	return publiraadminv1connect.NewAdminPaymentReconciliationServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// newReconciliationFixture is the purchase fixture with its tenant's days in
// UTC, so a test's instants and dates are the same.
func newReconciliationFixture(t *testing.T) *purchaseFixture {
	t.Helper()
	f := newPurchaseFixture(t)
	if _, err := f.env.PG.DB.ExecContext(context.Background(), "UPDATE tenants SET timezone = 'UTC' WHERE id = $1", f.admin.Tenant.ID); err != nil {
		t.Fatalf("set the tenant's time zone: %v", err)
	}
	return f
}

func (f *purchaseFixture) startReconciliation(t *testing.T, start, end string) []*publiraadminv1.PaymentReconciliation {
	t.Helper()
	res, err := f.env.reconciliationClient().StartPaymentReconciliation(f.ctx(), &publiraadminv1.StartPaymentReconciliationRequest{
		Tenant: f.admin.tenantContext(), StartDate: start, EndDate: end,
	})
	if err != nil {
		t.Fatalf("StartPaymentReconciliation: %v", err)
	}
	return res.Reconciliations
}

// A run is written for the source the tenant has ready, answered as it is
// while the worker has not finished it, and replaced with its findings once it
// has.
func TestDBAdminStartPaymentReconciliationReplacesAFinishedRun(t *testing.T) {
	t.Parallel()
	f := newReconciliationFixture(t)

	first := f.startReconciliation(t, "2026-03-01", "2026-03-31")
	if len(first) != 1 || first[0].Provider != "stripe" || first[0].Store != "" ||
		first[0].Status != publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_PENDING ||
		first[0].StartDate != "2026-03-01" || first[0].EndDate != "2026-03-31" {
		t.Fatalf("reconciliations = %+v, want one pending Stripe run of March", first)
	}
	if again := f.startReconciliation(t, "2026-03-01", "2026-03-31"); len(again) != 1 || again[0].Id != first[0].Id {
		t.Fatalf("restarted = %+v, want the unfinished run %s", again, first[0].Id)
	}

	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		UPDATE payment_reconciliations
		SET claimed_at = now(), finished_at = now(), record_count = 1, purchase_count = 0, matched_count = 0, finding_count = 1
		WHERE id = $1
	`, first[0].Id); err != nil {
		t.Fatalf("finish the run: %v", err)
	}
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO payment_reconciliation_findings (id, tenant_id, reconciliation_id, kind, is_test, provider_payment_id, record_amount, record_refunded_amount, record_currency, occurred_at)
		VALUES ($1, $2, $3, 'record_unmatched', false, 'pi_lost', 300, 0, 'JPY', '2026-03-10T00:00:00Z')
	`, uuid.Must(uuid.NewV7()), f.admin.Tenant.ID, first[0].Id); err != nil {
		t.Fatalf("insert a finding: %v", err)
	}

	listed, err := f.env.reconciliationClient().ListPaymentReconciliations(f.ctx(), &publiraadminv1.ListPaymentReconciliationsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListPaymentReconciliations: %v", err)
	}
	if len(listed.Reconciliations) != 1 || listed.Reconciliations[0].Status != publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_SUCCEEDED ||
		listed.Reconciliations[0].RecordCount != 1 || listed.Reconciliations[0].FindingCount != 1 || listed.Reconciliations[0].FinishedAt == "" {
		t.Fatalf("listed = %+v, want the finished run with its counts", listed.Reconciliations)
	}
	findings, err := f.env.reconciliationClient().ListPaymentReconciliationFindings(f.ctx(), &publiraadminv1.ListPaymentReconciliationFindingsRequest{
		Tenant: f.admin.tenantContext(), ReconciliationId: first[0].Id,
	})
	if err != nil {
		t.Fatalf("ListPaymentReconciliationFindings: %v", err)
	}
	if len(findings.Findings) != 1 || findings.Findings[0].Kind != publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_RECORD_UNMATCHED ||
		findings.Findings[0].ProviderPaymentId != "pi_lost" || findings.Findings[0].RecordAmount != 300 || findings.Findings[0].PurchaseId != "" {
		t.Fatalf("findings = %+v, want the payment with no purchase", findings.Findings)
	}
	filtered, err := f.env.reconciliationClient().ListPaymentReconciliationFindings(f.ctx(), &publiraadminv1.ListPaymentReconciliationFindingsRequest{
		Tenant: f.admin.tenantContext(), ReconciliationId: first[0].Id,
		Mode: publiraadminv1.PaymentReconciliationMode_PAYMENT_RECONCILIATION_MODE_TEST,
	})
	if err != nil || len(filtered.Findings) != 0 {
		t.Fatalf("test findings = %+v, %v; want none", filtered, err)
	}

	replaced := f.startReconciliation(t, "2026-03-01", "2026-03-31")
	if len(replaced) != 1 || replaced[0].Id == first[0].Id || replaced[0].Status != publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_PENDING {
		t.Fatalf("replaced = %+v, want a new pending run", replaced)
	}
	if count := f.env.countRows(t, "SELECT count(*) FROM payment_reconciliation_findings WHERE tenant_id = $1", f.admin.Tenant.ID); count != 0 {
		t.Fatalf("findings left = %d, want the replaced run's taken with it", count)
	}
	if _, err := f.env.reconciliationClient().ListPaymentReconciliationFindings(f.ctx(), &publiraadminv1.ListPaymentReconciliationFindingsRequest{
		Tenant: f.admin.tenantContext(), ReconciliationId: first[0].Id,
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("findings of the replaced run error = %v, want not_found", err)
	}
	if count := f.env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = 'payment_reconciliation_started' AND target_type = 'payment_reconciliation' AND target_id = '2026-03-01/2026-03-31'
	`, f.admin.Tenant.ID); count != 3 {
		t.Fatalf("start audit entries = %d, want one per start", count)
	}
}

func TestDBAdminStartPaymentReconciliationRefusesWhatItCannotRun(t *testing.T) {
	t.Parallel()
	f := newReconciliationFixture(t)
	tomorrow := time.Now().UTC().AddDate(0, 0, 1).Format(time.DateOnly)
	for name, req := range map[string]*publiraadminv1.StartPaymentReconciliationRequest{
		"future":   {StartDate: "2026-03-01", EndDate: tomorrow},
		"reversed": {StartDate: "2026-03-31", EndDate: "2026-03-01"},
		"too long": {StartDate: "2024-01-01", EndDate: "2026-03-01"},
	} {
		req.Tenant = f.admin.tenantContext()
		if _, err := f.env.reconciliationClient().StartPaymentReconciliation(f.ctx(), req); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: error = %v, want invalid_argument", name, err)
		}
	}

	env := newAdminDBEnv(t)
	unready := env.seedTenantWithAdmin(t, "NOSOURCE1", "no-source.example.com", "No Source", "NSADMIN01", "admin@no-source.example.com")
	if _, err := env.reconciliationClient().StartPaymentReconciliation(testutil.WithBearer(context.Background(), unready.token()), &publiraadminv1.StartPaymentReconciliationRequest{
		Tenant: unready.tenantContext(), StartDate: "2026-03-01", EndDate: "2026-03-31",
	}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("no source error = %v, want failed_precondition", err)
	}
}

// The file holds a row per purchase of the period and per refund dated in it,
// with the IDs on both sides, and the download is in the audit log.
func TestDBAdminExportPurchasesWritesEachPurchaseAndRefund(t *testing.T) {
	t.Parallel()
	f := newReconciliationFixture(t)
	march := time.Date(2026, 3, 10, 9, 0, 0, 0, time.UTC)
	kept := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: march, paymentID: "pi_kept"})
	refunded := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeB, purchasedAt: march.Add(time.Hour), paymentID: "pi_refunded"})
	store := f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeC, purchasedAt: march.Add(2 * time.Hour), store: "app_store"})
	f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeC, purchasedAt: march.Add(3 * time.Hour)})
	f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeB, purchasedAt: march.AddDate(0, 1, 0), paymentID: "pi_april"})
	refundedAt := time.Date(2026, 3, 20, 12, 0, 0, 0, time.UTC)
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		UPDATE purchases
		SET refunded_amount = price_at_purchase, refunded_at = $2, revoked_at = $2, revocation_reason = 'refund'
		WHERE id = $1
	`, refunded, refundedAt); err != nil {
		t.Fatalf("refund a purchase: %v", err)
	}

	res, err := f.env.reconciliationClient().ExportPurchases(f.ctx(), &publiraadminv1.ExportPurchasesRequest{
		Tenant: f.admin.tenantContext(), StartDate: "2026-03-01", EndDate: "2026-03-31",
	})
	if err != nil {
		t.Fatalf("ExportPurchases: %v", err)
	}
	row := func(rowType string, id uuid.UUID, occurredAt, purchasedAt string, episodeID uuid.UUID, provider, checkout, payment, store, transaction string) string {
		return rowType + "," + id.String() + "," + occurredAt + "," + purchasedAt + ",500,JPY,purchase,episode," + episodeID.String() + "," +
			provider + "," + checkout + "," + payment + "," + store + "," + transaction + ",false"
	}
	want := csvFile(
		"row_type,purchase_id,occurred_at,purchased_at,amount,currency,kind,item_type,item_id,provider,provider_checkout_id,provider_payment_id,store,store_transaction_id,test",
		row("purchase", kept, "2026-03-10T09:00:00Z", "2026-03-10T09:00:00Z", f.episodeA.ID, "stripe", "cs_pi_kept", "pi_kept", "", ""),
		row("purchase", refunded, "2026-03-10T10:00:00Z", "2026-03-10T10:00:00Z", f.episodeB.ID, "stripe", "cs_pi_refunded", "pi_refunded", "", ""),
		row("refund", refunded, "2026-03-20T12:00:00Z", "2026-03-10T10:00:00Z", f.episodeB.ID, "stripe", "cs_pi_refunded", "pi_refunded", "", ""),
		row("purchase", store, "2026-03-10T11:00:00Z", "2026-03-10T11:00:00Z", f.episodeC.ID, "", "", "", "app_store", "txn_"+store.String()),
	)
	if got := string(res.Csv); got != want {
		t.Fatalf("csv =\n%q\nwant\n%q", got, want)
	}
	if count := f.env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND action = 'purchases_exported' AND target_type = 'purchases' AND target_id = '2026-03-01/2026-03-31'
	`, f.admin.Tenant.ID); count != 1 {
		t.Fatalf("export audit entries = %d, want one", count)
	}
}
