package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
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

// The invoice a subscription was created with owes its reader one mail of the
// start, naming the payment it was recorded as, however often it is
// delivered; a renewal owes none of that kind, and nor does a subscription
// whose reader's account is gone.
func TestDBProcessPaymentWebhookOwesTheReaderOneMailWhenTheirSubscriptionStarts(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_started",
		CustomerID:       "cus_started",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	first := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      "in_first",
		SubscriptionID: subscription.ID,
		PaymentID:      "pi_first",
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
		Started:        true,
	}
	startedMails := func(t *testing.T) []outbox.SubscriptionPaymentEmailPayload {
		t.Helper()
		return f.subscriptionPaymentMails(t, outbox.EventTypeSubscriptionStarted)
	}

	payload, headers := f.stripe.SubscriptionPaid(t, f.credentials, first)
	for delivery := range 3 {
		if err := f.deliver(t, payload, headers); err != nil {
			t.Fatalf("delivery %d of the first invoice: %v", delivery+1, err)
		}
	}
	paymentID := f.subscriptionPaymentID(t, "in_first")
	mails := startedMails(t)
	if len(mails) != 1 {
		t.Fatalf("started mails = %d, want one however often the invoice is delivered", len(mails))
	}
	if mails[0].TenantID != f.tenant.ID.String() || mails[0].SubscriptionPaymentID != paymentID.String() {
		t.Fatalf("mail = %+v, want the payment %s of tenant %s", mails[0], paymentID, f.tenant.ID)
	}

	renewal := first
	renewal.InvoiceID = "in_renewal"
	renewal.PaymentID = "pi_renewal"
	renewal.PeriodStart = first.PeriodEnd
	renewal.PeriodEnd = first.PeriodEnd.AddDate(0, 1, 0)
	renewal.Started = false
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, renewal)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the renewal: %v", err)
	}
	if got := len(startedMails(t)); got != 1 {
		t.Fatalf("started mails after a renewal = %d, want still the one", got)
	}

	if _, err := f.auth.DeleteMe(f.readerCtx(t), &publirav1.DeleteMeRequest{Tenant: tenantContext(f.tenant), Password: testutil.SeededPassword}); err != nil {
		t.Fatalf("DeleteMe: %v", err)
	}
	gone := stripetest.Subscription{
		ID:         "sub_gone",
		CustomerID: "cus_gone",
		PriceID:    "price_monthly",
		Status:     "active",
		Metadata:   stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], gone)
	orphan := first
	orphan.InvoiceID = "in_gone"
	orphan.PaymentID = "pi_gone"
	orphan.SubscriptionID = gone.ID
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, orphan)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the first invoice of a reader who is gone: %v", err)
	}
	if got := f.countRows(t, "SELECT count(*) FROM subscription_payments WHERE tenant_id = $1 AND stripe_invoice_id = 'in_gone'", f.tenant.ID); got != 1 {
		t.Fatalf("payments of a reader who is gone = %d, want the one recorded", got)
	}
	if got := len(startedMails(t)); got != 1 {
		t.Fatalf("started mails after a reader is gone = %d, want none for them", got)
	}
}

// subscriptionPaymentMails answers the mails of eventType the webhook has
// queued for the fixture's tenant.
func (f *subscriptionFixture) subscriptionPaymentMails(t *testing.T, eventType string) []outbox.SubscriptionPaymentEmailPayload {
	t.Helper()
	rows, err := f.pg.DB.QueryContext(context.Background(),
		"SELECT payload FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 ORDER BY created_at, id",
		f.tenant.ID, eventType)
	if err != nil {
		t.Fatalf("read the mails queued: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var mails []outbox.SubscriptionPaymentEmailPayload
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan a mail queued: %v", err)
		}
		var payload outbox.SubscriptionPaymentEmailPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode a mail queued: %v", err)
		}
		mails = append(mails, payload)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the mails queued: %v", err)
	}
	return mails
}

// subscriptionPaymentID answers the payment the invoice invoiceID of the
// fixture's tenant was recorded as.
func (f *subscriptionFixture) subscriptionPaymentID(t *testing.T, invoiceID string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.pg.DB.QueryRowContext(context.Background(),
		"SELECT id FROM subscription_payments WHERE tenant_id = $1 AND stripe_invoice_id = $2", f.tenant.ID, invoiceID,
	).Scan(&id); err != nil {
		t.Fatalf("read the payment of %s: %v", invoiceID, err)
	}
	return id
}

// Every paid invoice after the one a subscription was created with owes its
// reader one mail of the renewal, naming the payment it was recorded as,
// however often it is delivered; the first invoice owes none of that kind, and
// nor does a renewal of a subscription whose reader's account is gone.
func TestDBProcessPaymentWebhookOwesTheReaderOneMailForEachRenewal(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	subscription := stripetest.Subscription{
		ID:               "sub_renewed",
		CustomerID:       "cus_renewed",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: time.Date(2026, time.April, 2, 0, 0, 0, 0, time.UTC).Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	first := paymentprovidertest.SubscriptionPayment{
		InvoiceID:      "in_first",
		SubscriptionID: subscription.ID,
		PaymentID:      "pi_first",
		TenantID:       f.tenant.ID,
		ReaderID:       f.reader.ID,
		PlanID:         plan.ID,
		Amount:         980,
		Currency:       "JPY",
		PeriodStart:    start,
		PeriodEnd:      start.AddDate(0, 1, 0),
		Started:        true,
	}
	renewedMails := func(t *testing.T) []outbox.SubscriptionPaymentEmailPayload {
		t.Helper()
		return f.subscriptionPaymentMails(t, outbox.EventTypeSubscriptionRenewed)
	}

	payload, headers := f.stripe.SubscriptionPaid(t, f.credentials, first)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver the first invoice: %v", err)
	}
	if got := len(renewedMails(t)); got != 0 {
		t.Fatalf("renewal mails after the first invoice = %d, want none", got)
	}

	var want []string
	previous := first
	for month, invoiceID := range []string{"in_april", "in_may"} {
		renewal := previous
		renewal.InvoiceID = invoiceID
		renewal.PaymentID = "pi_" + invoiceID
		renewal.PeriodStart = previous.PeriodEnd
		renewal.PeriodEnd = previous.PeriodEnd.AddDate(0, 1, 0)
		renewal.Started = false
		subscription.CurrentPeriodEnd = renewal.PeriodEnd.Unix()
		f.stripe.API.SetSubscription(f.credentials[stripe.FieldSecretKey], subscription)
		payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, renewal)
		for delivery := range 3 {
			if err := f.deliver(t, payload, headers); err != nil {
				t.Fatalf("delivery %d of renewal %d: %v", delivery+1, month+1, err)
			}
		}
		want = append(want, f.subscriptionPaymentID(t, invoiceID).String())
		previous = renewal
	}
	mails := renewedMails(t)
	if len(mails) != len(want) {
		t.Fatalf("renewal mails = %d, want one per renewal however often each is delivered", len(mails))
	}
	for i, mail := range mails {
		if mail.TenantID != f.tenant.ID.String() || mail.SubscriptionPaymentID != want[i] {
			t.Errorf("mail %d = %+v, want the payment %s of tenant %s", i, mail, want[i], f.tenant.ID)
		}
	}
	if got := len(f.subscriptionPaymentMails(t, outbox.EventTypeSubscriptionStarted)); got != 1 {
		t.Fatalf("started mails = %d, want the first invoice's alone", got)
	}

	if _, err := f.auth.DeleteMe(f.readerCtx(t), &publirav1.DeleteMeRequest{Tenant: tenantContext(f.tenant), Password: testutil.SeededPassword}); err != nil {
		t.Fatalf("DeleteMe: %v", err)
	}
	orphan := previous
	orphan.InvoiceID = "in_june"
	orphan.PaymentID = "pi_in_june"
	orphan.PeriodStart = previous.PeriodEnd
	orphan.PeriodEnd = previous.PeriodEnd.AddDate(0, 1, 0)
	payload, headers = f.stripe.SubscriptionPaid(t, f.credentials, orphan)
	if err := f.deliver(t, payload, headers); err != nil {
		t.Fatalf("deliver a renewal of a reader who is gone: %v", err)
	}
	if got := len(renewedMails(t)); got != len(want) {
		t.Fatalf("renewal mails after the reader is gone = %d, want none for them", got)
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

// subscriptionPaymentFailedMails answers the mails of failed attempts the
// webhook has queued for the fixture's tenant.
func (f *subscriptionFixture) subscriptionPaymentFailedMails(t *testing.T) []outbox.SubscriptionPaymentFailedPayload {
	t.Helper()
	rows, err := f.pg.DB.QueryContext(context.Background(),
		"SELECT payload FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 ORDER BY created_at, id",
		f.tenant.ID, outbox.EventTypeSubscriptionPaymentFailed)
	if err != nil {
		t.Fatalf("read the mails queued: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var mails []outbox.SubscriptionPaymentFailedPayload
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan a mail queued: %v", err)
		}
		var payload outbox.SubscriptionPaymentFailedPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode a mail queued: %v", err)
		}
		mails = append(mails, payload)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the mails queued: %v", err)
	}
	return mails
}

// Every failed attempt at a renewal owes its reader one mail, however often
// its notification is delivered, carrying what the invoice asks for, when it
// is tried again, and the end of the current period the subscription is
// recorded with. An attempt after which the subscription opens nothing — one
// Stripe ended, or one whose period is over — owes none, and nor does an
// attempt on a subscription whose reader's account is gone.
func TestDBProcessPaymentWebhookOwesTheReaderOneMailForEachFailedAttempt(t *testing.T) {
	t.Parallel()

	f := newSubscriptionFixture(t)
	plan := f.pg.SeedSubscriptionPlan(t, f.tenant.ID, testutil.SubscriptionPlanSeed{StripePriceID: "price_monthly", Published: true})
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Truncate(time.Second)
	subscription := stripetest.Subscription{
		ID:               "sub_failing",
		CustomerID:       "cus_failing",
		PriceID:          "price_monthly",
		Status:           "past_due",
		CurrentPeriodEnd: periodEnd.Unix(),
		Metadata:         stripetest.SubscriptionMetadata(f.tenant.ID, f.reader.ID, plan.ID, "price_monthly"),
	}
	nextAttempt := time.Now().UTC().Add(3 * 24 * time.Hour).Truncate(time.Second)
	attempt := func(t *testing.T, eventID string, next time.Time, deliveries int) {
		t.Helper()
		payload, headers := f.stripe.InvoicePaymentFailed(t, f.credentials, subscription, stripetest.FailedInvoice{
			EventID: eventID, InvoiceID: "in_failing", Amount: 980, Currency: "JPY", NextAttempt: next, Test: true,
		})
		for delivery := range deliveries {
			if err := f.deliver(t, payload, headers); err != nil {
				t.Fatalf("delivery %d of %s: %v", delivery+1, eventID, err)
			}
		}
	}

	attempt(t, "evt_failing_first", nextAttempt, 3)
	attempt(t, "evt_failing_last", time.Time{}, 2)
	mails := f.subscriptionPaymentFailedMails(t)
	if len(mails) != 2 {
		t.Fatalf("failed payment mails = %d, want one per attempt however often each is delivered", len(mails))
	}
	var subscriptionID uuid.UUID
	if err := f.pg.DB.QueryRowContext(context.Background(),
		"SELECT id FROM subscriptions WHERE tenant_id = $1 AND stripe_subscription_id = $2", f.tenant.ID, subscription.ID,
	).Scan(&subscriptionID); err != nil {
		t.Fatalf("read the subscription: %v", err)
	}
	for i, mail := range mails {
		if mail.TenantID != f.tenant.ID.String() || mail.SubscriptionID != subscriptionID.String() || mail.PlanID != plan.ID.String() ||
			mail.Amount != 980 || mail.Currency != "JPY" || !mail.PeriodEnd.Equal(periodEnd) || !mail.IsTest {
			t.Errorf("mail %d = %+v, want 980 JPY on subscription %s of plan %s, open until %s, in test mode", i, mail, subscriptionID, plan.ID, periodEnd)
		}
	}
	if mails[0].NextAttempt == nil || !mails[0].NextAttempt.Equal(nextAttempt) {
		t.Errorf("next attempt of the first mail = %v, want %s", mails[0].NextAttempt, nextAttempt)
	}
	if mails[1].NextAttempt != nil {
		t.Errorf("next attempt of the last mail = %v, want none", mails[1].NextAttempt)
	}

	subscription.Status = "canceled"
	attempt(t, "evt_failing_ended", time.Time{}, 1)
	subscription.Status = "past_due"
	subscription.CurrentPeriodEnd = time.Now().Add(-time.Hour).Unix()
	attempt(t, "evt_failing_over", time.Time{}, 1)
	if got := len(f.subscriptionPaymentFailedMails(t)); got != 2 {
		t.Fatalf("failed payment mails after the subscription opens nothing = %d, want none for it", got)
	}

	subscription.CurrentPeriodEnd = periodEnd.Unix()
	if _, err := f.auth.DeleteMe(f.readerCtx(t), &publirav1.DeleteMeRequest{Tenant: tenantContext(f.tenant), Password: testutil.SeededPassword}); err != nil {
		t.Fatalf("DeleteMe: %v", err)
	}
	attempt(t, "evt_failing_orphan", nextAttempt, 1)
	if got := len(f.subscriptionPaymentFailedMails(t)); got != 2 {
		t.Fatalf("failed payment mails after the reader is gone = %d, want none for them", got)
	}
}
