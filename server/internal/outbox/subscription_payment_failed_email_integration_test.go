package outbox_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionPaymentFailedEvent is the event the webhook queues for a failed
// attempt at a ¥980 invoice of the reader's subscription to a plan, whose
// current period ends on 2 May 2026, tried again on 5 April unless
// nextAttempt is false.
func (e purchaseReceiptEnv) subscriptionPaymentFailedEvent(t *testing.T, tenantID uuid.UUID, nextAttempt, test bool) (dbmodels.OutboxEvent, uuid.UUID) {
	t.Helper()

	plan := e.pg.SeedSubscriptionPlan(t, e.tenantID, testutil.SubscriptionPlanSeed{Name: "All you can read", PriceAmount: 980, Published: true})
	subscriptionID := e.pg.SeedSubscription(t, e.tenantID, e.readerID, plan.ID, testutil.SubscriptionSeed{})
	payload := outbox.SubscriptionPaymentFailedPayload{
		TenantID:       tenantID.String(),
		SubscriptionID: subscriptionID.String(),
		PlanID:         plan.ID.String(),
		Amount:         980,
		Currency:       "JPY",
		PeriodEnd:      time.Date(2026, time.May, 2, 0, 0, 0, 0, time.UTC),
		IsTest:         test,
	}
	if nextAttempt {
		at := time.Date(2026, time.April, 5, 3, 0, 0, 0, time.UTC)
		payload.NextAttempt = &at
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeSubscriptionPaymentFailed,
		Payload:        encoded,
		IdempotencyKey: outbox.SubscriptionPaymentFailedIdempotencyKey(tenantID, "evt_"+subscriptionID.String()),
	}, subscriptionID
}

// The mail of a failed attempt tells the reader what is owed, when it is tried
// again where Stripe said so, and until when the plan's episodes stay open at the
// latest, in the tenant's language and time zone, and sends them to My Page,
// where the card is changed; one attempted in Stripe's test mode says no money
// is owed.
func TestSubscriptionPaymentFailedEmailTellsTheReaderUntilWhenTheyCanRead(t *testing.T) {
	t.Parallel()

	for name, testCase := range map[string]struct {
		nextAttempt bool
		test        bool
	}{
		"tried again":                         {nextAttempt: true},
		"no next attempt named, in test mode": {test: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
			event, _ := env.subscriptionPaymentFailedEvent(t, env.tenantID, testCase.nextAttempt, testCase.test)

			mailer := &recordingMailer{}
			renderer := &recordingRenderer{}
			handler := outbox.NewSubscriptionPaymentFailedEmailHandler(outbox.EmailHandlerConfig{
				DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer, Renderer: renderer,
			})
			if err := handler(ctx, event); err != nil {
				t.Fatalf("subscription payment failed handler: %v", err)
			}

			if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
				t.Fatalf("mailed %v, want the reader alone", got)
			}
			sent := mailer.sent[0].email
			if sent.Subject != "Aoto Press subscription payment failed" {
				t.Errorf("subject = %q", sent.Subject)
			}
			for _, fragment := range []string{
				"Your payment did not go through",
				"Plan: All you can read",
				"Amount due: ¥980 (JPY)",
				"until May 2, 2026, 9:00 AM at the latest",
				"under Manage billing on My Page",
				"://aoto.example.test/my",
			} {
				if !strings.Contains(sent.Text, fragment) {
					t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
				}
			}
			// An attempt whose notification names no next one says nothing of
			// the retries, since that is no sign they have ended.
			if got := strings.Contains(sent.Text, "The payment will be tried again on Apr 5, 2026, 12:00 PM."); got != testCase.nextAttempt {
				t.Errorf("the mail names the next attempt = %t, want %t:\n%s", got, testCase.nextAttempt, sent.Text)
			}
			if got := strings.Contains(sent.Text, "No money is owed."); got != testCase.test {
				t.Errorf("the mail says no money is owed = %t, want %t:\n%s", got, testCase.test, sent.Text)
			}

			if len(renderer.requests) != 1 {
				t.Fatalf("rendered %d times, want once", len(renderer.requests))
			}
			request := renderer.requests[0]
			if request.Template != "subscription_payment_failed" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
				t.Errorf("rendered %s in %s and %s, want subscription_payment_failed in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
			}
			data := request.Data
			if data["amount"] != int64(980) || data["currency"] != "JPY" || data["plan_name"] != "All you can read" ||
				data["period_end"] != "2026-05-02T00:00:00Z" || data["is_test"] != testCase.test {
				t.Errorf("data = %#v, want 980 JPY for All you can read open until 2 May", data)
			}
			wantNext := ""
			if testCase.nextAttempt {
				wantNext = "2026-04-05T03:00:00Z"
			}
			if data["next_attempt"] != wantNext {
				t.Errorf("next_attempt = %#v, want %q", data["next_attempt"], wantNext)
			}
		})
	}
}

// A reader who deleted their account has nobody to send the mail to.
func TestSubscriptionPaymentFailedEmailDropsASubscriptionWhoseReaderIsGone(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	event, subscriptionID := env.subscriptionPaymentFailedEvent(t, env.tenantID, true, false)
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE subscriptions SET user_id = NULL WHERE id = $1`, subscriptionID); err != nil {
		t.Fatalf("detach the reader: %v", err)
	}

	mailer := &recordingMailer{}
	handler := outbox.NewSubscriptionPaymentFailedEmailHandler(outbox.EmailHandlerConfig{
		DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer,
	})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("subscription payment failed handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}

// An event that names no subscription, no amount, or a subscription of another
// tenant will not read differently on a retry.
func TestSubscriptionPaymentFailedEmailFailsForGoodOnAnEventItCannotWord(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	other := env.pg.SeedTenant(t, "OUTBOXPF001", "other-payment-failed.example.test", "Other Press")
	event, _ := env.subscriptionPaymentFailedEvent(t, env.tenantID, true, false)
	rewrite := func(t *testing.T, change func(payload map[string]any)) dbmodels.OutboxEvent {
		t.Helper()
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		change(payload)
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("encode payload: %v", err)
		}
		rewritten := event
		rewritten.Payload = encoded
		return rewritten
	}
	foreign, _ := env.subscriptionPaymentFailedEvent(t, other.ID, true, false)

	for name, event := range map[string]dbmodels.OutboxEvent{
		"no subscription":                  rewrite(t, func(payload map[string]any) { payload["subscription_id"] = "not-a-uuid" }),
		"no amount":                        rewrite(t, func(payload map[string]any) { delete(payload, "amount") }),
		"a subscription of another tenant": foreign,
	} {
		t.Run(name, func(t *testing.T) {
			mailer := &recordingMailer{}
			handler := outbox.NewSubscriptionPaymentFailedEmailHandler(outbox.EmailHandlerConfig{
				DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer,
			})
			if err := handler(ctx, event); !outbox.IsPermanent(err) {
				t.Fatalf("handler error = %v, want a permanent failure", err)
			}
			if len(mailer.sent) != 0 {
				t.Fatalf("sent %d mails, want none", len(mailer.sent))
			}
		})
	}
}
