package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionPaymentRow is what subscription_payments holds of one invoice.
type subscriptionPaymentRow struct {
	subscriptionID uuid.UUID
	planID         uuid.UUID
	paymentIntent  sql.NullString
	amount         int32
	currency       string
	periodStart    time.Time
	periodEnd      time.Time
	refunded       sql.NullInt32
	test           bool
}

func (f *subscriptionFixture) subscriptionPayment(t *testing.T, invoiceID string) subscriptionPaymentRow {
	t.Helper()
	var row subscriptionPaymentRow
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT subscription_id, plan_id, stripe_payment_intent_id, amount, currency, period_start, period_end, refunded_amount, is_test
		FROM subscription_payments
		WHERE tenant_id = $1 AND stripe_invoice_id = $2
	`, f.tenant.ID, invoiceID).Scan(&row.subscriptionID, &row.planID, &row.paymentIntent, &row.amount, &row.currency,
		&row.periodStart, &row.periodEnd, &row.refunded, &row.test); err != nil {
		t.Fatalf("read the payment of %s: %v", invoiceID, err)
	}
	return row
}

func TestDBProcessPaymentWebhookRecordsEachPaidInvoiceOnce(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_paid",
		CustomerID:       "cus_paid",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      "in_march",
		SubscriptionID: subscription.ID,
		PaymentID:      "pi_march",
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
	}

	// The payment's notification can arrive before the checkout's, so the
	// subscription it names is recorded with it.
	payload, headers := f.stripe.SubscriptionPaid(t, f.credentials, payment)
	for delivery := range 3 {
		if err := f.deliver(t, payload, headers); err != nil {
			t.Fatalf("delivery %d of the paid invoice: %v", delivery+1, err)
		}
	}
	if got := f.countRows(t, "SELECT count(*) FROM subscription_payments WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("payments = %d, want one however often the invoice is delivered", got)
	}
	recorded := f.subscriptionPayment(t, "in_march")
	var subscriptionRowID uuid.UUID
	if err := f.pg.DB.QueryRowContext(context.Background(),
		"SELECT id FROM subscriptions WHERE tenant_id = $1 AND stripe_subscription_id = 'sub_paid'", f.tenant.ID,
	).Scan(&subscriptionRowID); err != nil {
		t.Fatalf("read the subscription the payment recorded: %v", err)
	}
	if recorded.subscriptionID != subscriptionRowID || recorded.planID != plan.ID {
		t.Fatalf("payment is on subscription %s of plan %s, want %s of %s", recorded.subscriptionID, recorded.planID, subscriptionRowID, plan.ID)
	}
	if recorded.amount != 980 || recorded.currency != "JPY" || recorded.paymentIntent.String != "pi_march" || recorded.test {
		t.Fatalf("payment = %+v, want 980 JPY through pi_march in live mode", recorded)
	}
	if !recorded.periodStart.Equal(payment.PeriodStart) || !recorded.periodEnd.Equal(payment.PeriodEnd) {
		t.Fatalf("period = [%s, %s), want [%s, %s)", recorded.periodStart, recorded.periodEnd, payment.PeriodStart, payment.PeriodEnd)
	}
	if recorded.refunded.Valid {
		t.Fatalf("refunded = %d, want nothing yet", recorded.refunded.Int32)
	}

	// Partial refunds add up to the whole payment, and a refund that fails
	// takes the total back to what stays refunded.
	for _, total := range []int64{300, 980} {
		payload, headers := f.stripe.Refunded(t, f.credentials, paymentprovidertest.Refund{PaymentID: "pi_march", Currency: "JPY", AmountRefunded: total})
		if err := f.deliver(t, payload, headers); err != nil {
			t.Fatalf("deliver the refund to %d: %v", total, err)
		}
		if got := f.subscriptionPayment(t, "in_march").refunded; int64(got.Int32) != total {
			t.Fatalf("refunded = %d, want %d", got.Int32, total)
		}
	}
	payload, headers = f.stripe.RefundFailed(t, f.credentials, paymentprovidertest.Refund{PaymentID: "pi_march", Currency: "JPY", AmountRefunded: 300})
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the failed refund: %v", err)
	}
	if got := f.subscriptionPayment(t, "in_march").refunded; got.Int32 != 300 {
		t.Fatalf("refunded after a failed refund = %d, want 300", got.Int32)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_refunds WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held refunds = %d, want none for a refund of a payment that is here", got)
	}

	// A refund that overtakes its payment's notification is held, and the
	// payment takes it when it arrives.
	april := payment
	april.InvoiceID = "in_april"
	april.PaymentID = "pi_april"
	april.PeriodStart = payment.PeriodEnd
	april.PeriodEnd = payment.PeriodEnd.AddDate(0, 1, 0)
	payload, headers = f.stripe.Refunded(t, f.credentials, paymentprovidertest.Refund{PaymentID: "pi_april", Currency: "JPY", AmountRefunded: 500})
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the early refund: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_refunds WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("held refunds = %d, want the early one", got)
	}
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, april)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver April's paid invoice: %v", err)
	}
	if got := f.subscriptionPayment(t, "in_april").refunded; got.Int32 != 500 {
		t.Fatalf("April's refunded = %d, want the 500 held for it", got.Int32)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_refunds WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held refunds = %d, want the early one applied", got)
	}

	// A payment made in Stripe's test mode is recorded as one, and an invoice
	// marked paid outside Stripe names no payment a refund could reach.
	test := april
	test.InvoiceID = "in_test"
	test.PaymentID = "pi_test"
	test.Test = true
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, test)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the test-mode invoice: %v", err)
	}
	if !f.subscriptionPayment(t, "in_test").test {
		t.Fatal("a test-mode payment is not recorded as a test")
	}
	outOfBand := april
	outOfBand.InvoiceID = "in_out_of_band"
	outOfBand.PaymentID = ""
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, outOfBand)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the invoice paid outside Stripe: %v", err)
	}
	if got := f.subscriptionPayment(t, "in_out_of_band").paymentIntent; got.Valid {
		t.Fatalf("payment intent = %q, want none", got.String)
	}

	// An invoice of a subscription whose plan is gone is acknowledged and
	// records nothing, as the subscription's own notifications are.
	orphan := stripetest.Subscription{
		ID:         "sub_orphan_paid",
		CustomerID: "cus_orphan_paid",
		PriceID:    "price_deleted",
		Status:     "active",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, uuid.New(), "price_deleted"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], orphan)
	orphanPayment := april
	orphanPayment.InvoiceID = "in_orphan"
	orphanPayment.PaymentID = "pi_orphan"
	orphanPayment.SubscriptionID = orphan.ID
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, orphanPayment)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the invoice of a subscription of no plan: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM subscription_payments WHERE tenant_id = $1 AND stripe_invoice_id = 'in_orphan'", f.tenant.ID); got != 0 {
		t.Fatalf("payments of a subscription of no plan = %d, want none", got)
	}
}

// A refund delivered while its payment is being recorded waits for the
// payment's transaction, under the lock both take, and is then applied to the
// payment rather than held for one that has already looked for it.
func TestDBProcessPaymentWebhookAppliesARefundRacingItsPayment(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	subscriptionID := f.pg.SeedSubscription(t, f.tenant.ID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{StripeSubscriptionID: "sub_racing"})
	ctx := context.Background()

	// The payment's transaction, as recordSubscriptionPayment runs it: the
	// lock, then the insert, not committed yet.
	tx, err := f.pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the payment's transaction: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, dbmodels.LockProviderPayment, f.tenant.ID, stripe.ID, "pi_racing"); err != nil {
		t.Fatalf("lock the payment: %v", err)
	}
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO subscription_payments (id, tenant_id, subscription_id, plan_id, stripe_invoice_id, stripe_payment_intent_id, amount, currency, period_start, period_end, paid_at)
		VALUES ($1, $2, $3, $4, 'in_racing', 'pi_racing', 980, 'JPY', $5, $6, $5)
	`, uuid.Must(uuid.NewV7()), f.tenant.ID, subscriptionID, plan.ID, start, start.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("insert the payment: %v", err)
	}

	payload, headers := f.stripe.Refunded(t, f.credentials, paymentprovidertest.Refund{PaymentID: "pi_racing", Currency: "JPY", AmountRefunded: 300})
	delivered := make(chan error, 1)
	go func() { delivered <- f.deliver(t, payload, headers) }()
	deadline := time.Now().Add(30 * time.Second)
	for f.countRows(t, "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())") == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the refund never waited for the payment's lock")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit the payment: %v", err)
	}
	if err := <-delivered; err != nil {
		t.Fatalf("deliver the refund: %v", err)
	}

	if got := f.subscriptionPayment(t, "in_racing").refunded; got.Int32 != 300 {
		t.Fatalf("refunded = %d, want the 300 that raced the payment", got.Int32)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_refunds WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held refunds = %d, want none", got)
	}
}

// subscriptionDisputeLostAt is when the dispute of an invoice's payment was
// recorded lost, invalid while it was not.
func (f *subscriptionFixture) subscriptionDisputeLostAt(t *testing.T, invoiceID string) sql.NullTime {
	t.Helper()
	var at sql.NullTime
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT dispute_lost_at
		FROM subscription_payments
		WHERE tenant_id = $1 AND stripe_invoice_id = $2
	`, f.tenant.ID, invoiceID).Scan(&at); err != nil {
		t.Fatalf("read dispute_lost_at of %s: %v", invoiceID, err)
	}
	return at
}

func (f *subscriptionFixture) subscriptionRowStatus(t *testing.T, stripeSubscriptionID string) string {
	t.Helper()
	var status string
	if err := f.pg.DB.QueryRowContext(context.Background(), `
		SELECT status FROM subscriptions
		WHERE tenant_id = $1 AND stripe_subscription_id = $2
	`, f.tenant.ID, stripeSubscriptionID).Scan(&status); err != nil {
		t.Fatalf("read the status of %s: %v", stripeSubscriptionID, err)
	}
	return status
}

// payInvoice records one paid invoice of a new plan, the way the webhook does.
func (f *subscriptionFixture) payInvoice(t *testing.T, invoiceID, paymentID string) paymentprovidertest.SubscriptionPayment {
	t.Helper()
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_" + invoiceID, Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_" + invoiceID,
		CustomerID:       "cus_" + invoiceID,
		PriceID:          "price_" + invoiceID,
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_"+invoiceID),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      invoiceID,
		SubscriptionID: subscription.ID,
		PaymentID:      paymentID,
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
	}
	payload, headers := f.stripe.SubscriptionPaid(t, f.credentials, payment)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver %s: %v", invoiceID, err)
	}
	return payment
}

// A lost dispute of a subscription payment records when the bank returned the
// money, and leaves the refund columns and the subscription as they were. A
// repeated delivery does not move that instant. An open dispute, and one the
// tenant won, change nothing and are not held.
func TestDBProcessPaymentWebhookRecordsALostDisputeOnASubscriptionPayment(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	f.payInvoice(t, "in_disputed", "pi_disputed")

	payload, headers := f.stripe.Disputed(t, f.credentials, "pi_disputed")
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the open dispute: %v", err)
	}
	if at := f.subscriptionDisputeLostAt(t, "in_disputed"); at.Valid {
		t.Fatalf("an open dispute was recorded lost at %v", at.Time)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held disputes = %d, want none for a payment that is here", got)
	}

	payload, headers = f.stripe.DisputeClosed(t, f.credentials, "pi_disputed", stripego.DisputeStatusWon)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the won dispute: %v", err)
	}
	if at := f.subscriptionDisputeLostAt(t, "in_disputed"); at.Valid {
		t.Fatalf("a won dispute was recorded lost at %v", at.Time)
	}

	payload, headers = f.stripe.Refunded(t, f.credentials, paymentprovidertest.Refund{PaymentID: "pi_disputed", Currency: "JPY", AmountRefunded: 300})
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the partial refund: %v", err)
	}
	payload, headers = f.stripe.DisputeClosed(t, f.credentials, "pi_disputed", stripego.DisputeStatusLost)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the lost dispute: %v", err)
	}
	lostAt := f.subscriptionDisputeLostAt(t, "in_disputed")
	if !lostAt.Valid {
		t.Fatal("a lost dispute was not recorded")
	}
	if got := f.subscriptionPayment(t, "in_disputed").refunded; got.Int32 != 300 {
		t.Fatalf("refunded = %d, want the partial refund left as it was", got.Int32)
	}
	if status := f.subscriptionRowStatus(t, "sub_in_disputed"); status != "active" {
		t.Fatalf("subscription status = %s, want active", status)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held disputes = %d, want none", got)
	}

	payload, headers = f.stripe.DisputeClosed(t, f.credentials, "pi_disputed", stripego.DisputeStatusLost)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the lost dispute again: %v", err)
	}
	if repeat := f.subscriptionDisputeLostAt(t, "in_disputed"); !repeat.Time.Equal(lostAt.Time) {
		t.Fatalf("a repeated delivery moved the loss: %v -> %v", lostAt.Time, repeat.Time)
	}
}

// A lost dispute that arrives before the invoice is held, and the payment
// takes it when the invoice arrives. A later delivery of the dispute that
// opened it does not record the loss a second time.
func TestDBProcessPaymentWebhookAppliesALostDisputeThatArrivedBeforeItsSubscriptionPayment(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_early_dispute", Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_early_dispute",
		CustomerID:       "cus_early_dispute",
		PriceID:          "price_early_dispute",
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_early_dispute"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      "in_early_dispute",
		SubscriptionID: subscription.ID,
		PaymentID:      "pi_early_dispute",
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
	}

	payload, headers := f.stripe.DisputeClosed(t, f.credentials, "pi_early_dispute", stripego.DisputeStatusLost)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the early lost dispute: %v", err)
	}
	payload, headers = f.stripe.Disputed(t, f.credentials, "pi_early_dispute")
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the dispute that opened it: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("held disputes = %d, want the early one kept once", got)
	}

	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, payment)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the paid invoice: %v", err)
	}
	if !f.subscriptionDisputeLostAt(t, "in_early_dispute").Valid {
		t.Fatal("the held dispute was not recorded lost on the new payment")
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held disputes = %d, want the applied one released", got)
	}
	if status := f.subscriptionRowStatus(t, "sub_early_dispute"); status != "active" {
		t.Fatalf("subscription status = %s, want active", status)
	}
}

// An open dispute that arrives before the invoice is released when the
// invoice arrives, without counting the payment as lost, and the decision
// lost later is recorded on the payment.
func TestDBProcessPaymentWebhookReleasesAnOpenDisputeWhenItsSubscriptionPaymentArrives(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_open_dispute", Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_open_dispute",
		CustomerID:       "cus_open_dispute",
		PriceID:          "price_open_dispute",
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_open_dispute"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      "in_open_dispute",
		SubscriptionID: subscription.ID,
		PaymentID:      "pi_open_dispute",
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
	}

	payload, headers := f.stripe.Disputed(t, f.credentials, "pi_open_dispute")
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the early dispute: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 1 {
		t.Fatalf("held disputes = %d, want the early one", got)
	}

	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, payment)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the paid invoice: %v", err)
	}
	if at := f.subscriptionDisputeLostAt(t, "in_open_dispute"); at.Valid {
		t.Fatalf("an open dispute was recorded lost at %v", at.Time)
	}
	if got := f.countRows(t, "SELECT count(*) FROM unapplied_disputes WHERE tenant_id = $1", f.tenant.ID); got != 0 {
		t.Fatalf("held disputes = %d, want the applied one released", got)
	}

	payload, headers = f.stripe.DisputeClosed(t, f.credentials, "pi_open_dispute", stripego.DisputeStatusLost)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the lost dispute: %v", err)
	}
	if !f.subscriptionDisputeLostAt(t, "in_open_dispute").Valid {
		t.Fatal("a lost dispute was not recorded")
	}
}
