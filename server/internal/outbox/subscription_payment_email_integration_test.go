package outbox_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/outbox"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

// firstSubscriptionPayment records the reader's subscription to a ¥980 plan
// and the invoice that started it, for the month from 2 March 2026, the way
// the payment webhook does, and answers the subscription and the payment.
func (e purchaseReceiptEnv) firstSubscriptionPayment(t *testing.T, ctx context.Context, test bool) (uuid.UUID, dbmodels.SubscriptionPayment) {
	t.Helper()

	plan := e.pg.SeedSubscriptionPlan(t, e.tenantID, testutil.SubscriptionPlanSeed{Name: "All you can read", PriceAmount: 980, Published: true})
	subscriptionID := e.pg.SeedSubscription(t, e.tenantID, e.readerID, plan.ID, testutil.SubscriptionSeed{})
	start := time.Date(2026, time.March, 2, 0, 0, 0, 0, time.UTC)
	payment, err := e.queries.RecordSubscriptionPayment(ctx, dbmodels.RecordSubscriptionPaymentParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        e.tenantID,
		SubscriptionID:  subscriptionID,
		PlanID:          plan.ID,
		StripeInvoiceID: "in_" + subscriptionID.String(),
		Amount:          980,
		Currency:        "JPY",
		PeriodStart:     start,
		PeriodEnd:       start.AddDate(0, 1, 0),
		PaidAt:          start.Add(time.Minute),
		IsTest:          test,
	})
	if err != nil {
		t.Fatalf("RecordSubscriptionPayment: %v", err)
	}
	return subscriptionID, payment
}

// subscriptionStartedEvent is the event the webhook queues for the payment
// that started subscriptionID.
func (e purchaseReceiptEnv) subscriptionStartedEvent(t *testing.T, tenantID, subscriptionID, paymentID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.SubscriptionPaymentEmailPayload{
		TenantID:              tenantID.String(),
		SubscriptionPaymentID: paymentID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeSubscriptionStarted,
		Payload:        payload,
		IdempotencyKey: outbox.SubscriptionStartedIdempotencyKey(subscriptionID),
	}
}

func (e purchaseReceiptEnv) subscriptionStartedHandler(mailer internalsmtp.RenderedSender, renderer emailrenderer.Renderer) outbox.Handler {
	return outbox.NewSubscriptionStartedEmailHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer, Renderer: renderer,
	})
}

// The mail of a subscription's start tells the reader which plan they hold,
// what they paid, and the period paid for, in the tenant's language and time
// zone, and sends them to My Page, where the plan is managed.
func TestSubscriptionStartedEmailTellsTheReaderWhatTheyHold(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	subscriptionID, payment := env.firstSubscriptionPayment(t, ctx, false)

	mailer := &recordingMailer{}
	renderer := &recordingRenderer{}
	if err := env.subscriptionStartedHandler(mailer, renderer)(ctx, env.subscriptionStartedEvent(t, env.tenantID, subscriptionID, payment.ID)); err != nil {
		t.Fatalf("subscription started handler: %v", err)
	}

	if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
		t.Fatalf("mailed %v, want the reader alone", got)
	}
	sent := mailer.sent[0].email
	if sent.Subject != "Aoto Press subscription started" {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{
		"Plan: All you can read",
		"Price paid: ¥980 (JPY)",
		"Period paid for: Mar 2, 2026, 9:00 AM to Apr 2, 2026, 9:00 AM",
		"until Apr 2, 2026, 9:00 AM",
		"://aoto.example.test/my",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}
	if strings.Contains(sent.Text, "test mode") {
		t.Errorf("a live subscription's mail mentions test mode:\n%s", sent.Text)
	}

	if len(renderer.requests) != 1 {
		t.Fatalf("rendered %d times, want once", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "subscription_started" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
		t.Errorf("rendered %s in %s and %s, want subscription_started in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
	}
	data := request.Data
	if data["amount"] != int64(980) || data["currency"] != "JPY" || data["plan_name"] != "All you can read" ||
		data["period_start"] != "2026-03-02T00:00:00Z" || data["period_end"] != "2026-04-02T00:00:00Z" || data["is_test"] != false {
		t.Errorf("data = %#v, want 980 JPY for All you can read from 2 March to 2 April", data)
	}
}

// A subscription started in Stripe's test mode says no money was charged.
func TestSubscriptionStartedEmailSaysATestSubscriptionChargedNothing(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	subscriptionID, payment := env.firstSubscriptionPayment(t, ctx, true)

	mailer := &recordingMailer{}
	if err := env.subscriptionStartedHandler(mailer, nil)(ctx, env.subscriptionStartedEvent(t, env.tenantID, subscriptionID, payment.ID)); err != nil {
		t.Fatalf("subscription started handler: %v", err)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d mails, want 1", len(mailer.sent))
	}
	if text := mailer.sent[0].email.Text; !strings.Contains(text, "test mode. No money was charged.") {
		t.Errorf("the mail of a test subscription does not say it charged nothing:\n%s", text)
	}
}

// A reader who deleted their account has nobody to send the mail to.
func TestSubscriptionStartedEmailDropsASubscriptionWhoseReaderIsGone(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	subscriptionID, payment := env.firstSubscriptionPayment(t, ctx, false)
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE subscriptions SET user_id = NULL WHERE id = $1`, subscriptionID); err != nil {
		t.Fatalf("detach the reader: %v", err)
	}

	mailer := &recordingMailer{}
	if err := env.subscriptionStartedHandler(mailer, nil)(ctx, env.subscriptionStartedEvent(t, env.tenantID, subscriptionID, payment.ID)); err != nil {
		t.Fatalf("subscription started handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}

// An event that names no payment, or a payment of another tenant, will not
// read differently on a retry.
func TestSubscriptionStartedEmailFailsForGoodOnAnEventItCannotWord(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	subscriptionID, payment := env.firstSubscriptionPayment(t, ctx, false)
	other := env.pg.SeedTenant(t, "OUTBOXSS003", "other-subscription.example.test", "Other Press")

	missing := env.subscriptionStartedEvent(t, env.tenantID, subscriptionID, payment.ID)
	missing.Payload = []byte(`{"tenant_id":"` + env.tenantID.String() + `","subscription_payment_id":"not-a-uuid"}`)

	for name, event := range map[string]dbmodels.OutboxEvent{
		"no payment":                  missing,
		"a payment of another tenant": env.subscriptionStartedEvent(t, other.ID, subscriptionID, payment.ID),
	} {
		t.Run(name, func(t *testing.T) {
			mailer := &recordingMailer{}
			err := env.subscriptionStartedHandler(mailer, nil)(ctx, event)
			if !outbox.IsPermanent(err) {
				t.Fatalf("handler error = %v, want a permanent failure", err)
			}
			if len(mailer.sent) != 0 {
				t.Fatalf("sent %d mails, want none", len(mailer.sent))
			}
		})
	}
}

// renewalPayment records the invoice that paid for the month after previous,
// on the same subscription and plan, the way the payment webhook does.
func (e purchaseReceiptEnv) renewalPayment(t *testing.T, ctx context.Context, previous dbmodels.SubscriptionPayment) dbmodels.SubscriptionPayment {
	t.Helper()

	payment, err := e.queries.RecordSubscriptionPayment(ctx, dbmodels.RecordSubscriptionPaymentParams{
		ID:              uuid.Must(uuid.NewV7()),
		TenantID:        e.tenantID,
		SubscriptionID:  previous.SubscriptionID,
		PlanID:          previous.PlanID,
		StripeInvoiceID: "in_renewal_" + previous.ID.String(),
		Amount:          previous.Amount,
		Currency:        previous.Currency,
		PeriodStart:     previous.PeriodEnd,
		PeriodEnd:       previous.PeriodEnd.AddDate(0, 1, 0),
		PaidAt:          previous.PeriodEnd.Add(time.Minute),
		IsTest:          previous.IsTest,
	})
	if err != nil {
		t.Fatalf("RecordSubscriptionPayment: %v", err)
	}
	return payment
}

// subscriptionRenewedEvent is the event the webhook queues for the payment
// that renewed a subscription.
func (e purchaseReceiptEnv) subscriptionRenewedEvent(t *testing.T, tenantID, paymentID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.SubscriptionPaymentEmailPayload{
		TenantID:              tenantID.String(),
		SubscriptionPaymentID: paymentID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeSubscriptionRenewed,
		Payload:        payload,
		IdempotencyKey: outbox.SubscriptionRenewedIdempotencyKey(paymentID),
	}
}

// The mail of a renewal tells the reader what the renewal charged and the new
// period it paid for, whose end is when the plan's episodes now stay open
// until, in the tenant's language and time zone; one paid in Stripe's test
// mode says no money was charged.
func TestSubscriptionRenewedEmailTellsTheReaderTheNewPeriod(t *testing.T) {
	t.Parallel()

	for name, test := range map[string]bool{"live": false, "test mode": true} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
			_, first := env.firstSubscriptionPayment(t, ctx, test)
			renewal := env.renewalPayment(t, ctx, first)

			mailer := &recordingMailer{}
			renderer := &recordingRenderer{}
			handler := outbox.NewSubscriptionRenewedEmailHandler(outbox.EmailHandlerConfig{
				DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer, Renderer: renderer,
			})
			if err := handler(ctx, env.subscriptionRenewedEvent(t, env.tenantID, renewal.ID)); err != nil {
				t.Fatalf("subscription renewed handler: %v", err)
			}

			if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
				t.Fatalf("mailed %v, want the reader alone", got)
			}
			sent := mailer.sent[0].email
			if sent.Subject != "Aoto Press subscription renewed" {
				t.Errorf("subject = %q", sent.Subject)
			}
			for _, fragment := range []string{
				"Your subscription has been renewed",
				"Plan: All you can read",
				"Price paid: ¥980 (JPY)",
				"Period paid for: Apr 2, 2026, 9:00 AM to May 2, 2026, 9:00 AM",
				"until May 2, 2026, 9:00 AM",
				"://aoto.example.test/my",
			} {
				if !strings.Contains(sent.Text, fragment) {
					t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
				}
			}
			if got := strings.Contains(sent.Text, "No money was charged."); got != test {
				t.Errorf("the mail says no money was charged = %t, want %t:\n%s", got, test, sent.Text)
			}

			if len(renderer.requests) != 1 {
				t.Fatalf("rendered %d times, want once", len(renderer.requests))
			}
			request := renderer.requests[0]
			if request.Template != "subscription_renewed" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
				t.Errorf("rendered %s in %s and %s, want subscription_renewed in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
			}
			if data := request.Data; data["period_start"] != "2026-04-02T00:00:00Z" || data["period_end"] != "2026-05-02T00:00:00Z" || data["is_test"] != test {
				t.Errorf("data = %#v, want the period from 2 April to 2 May", data)
			}
		})
	}
}
