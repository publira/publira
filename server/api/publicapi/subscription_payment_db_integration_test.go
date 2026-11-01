package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

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
