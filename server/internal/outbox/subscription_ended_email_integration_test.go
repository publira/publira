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

// subscriptionEndedEvent is the event the webhook queues when the reader's
// subscription to a plan ends, at the end of its period on 2 May 2026.
func (e purchaseReceiptEnv) subscriptionEndedEvent(t *testing.T, tenantID uuid.UUID) (dbmodels.OutboxEvent, uuid.UUID) {
	t.Helper()

	plan := e.pg.SeedSubscriptionPlan(t, e.tenantID, testutil.SubscriptionPlanSeed{Name: "All you can read", PriceAmount: 980, Published: true})
	subscriptionID := e.pg.SeedSubscription(t, e.tenantID, e.readerID, plan.ID, testutil.SubscriptionSeed{})
	endedAt := time.Date(2026, time.May, 2, 0, 0, 0, 0, time.UTC)
	encoded, err := json.Marshal(outbox.SubscriptionEndedPayload{
		TenantID:       tenantID.String(),
		SubscriptionID: subscriptionID.String(),
		PlanID:         plan.ID.String(),
		EndedAt:        endedAt,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeSubscriptionEnded,
		Payload:        encoded,
		IdempotencyKey: outbox.SubscriptionEndedIdempotencyKey(subscriptionID, endedAt),
	}, subscriptionID
}

// The mail of an ended subscription tells the reader when it ended, in the
// tenant's language and time zone, and sends them to the site's
// plans.
func TestSubscriptionEndedEmailTellsTheReaderWhenItEnded(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	event, _ := env.subscriptionEndedEvent(t, env.tenantID)

	mailer := &recordingMailer{}
	renderer := &recordingRenderer{}
	handler := outbox.NewSubscriptionEndedEmailHandler(outbox.EmailHandlerConfig{
		DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer, Renderer: renderer,
	})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("subscription ended handler: %v", err)
	}

	if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
		t.Fatalf("mailed %v, want the reader alone", got)
	}
	sent := mailer.sent[0].email
	if sent.Subject != "Aoto Press subscription ended" {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{
		"Your subscription has ended",
		"Plan: All you can read",
		"The subscription ended on May 2, 2026, 9:00 AM, and the episodes the plan covers are no longer open to you.",
		"://aoto.example.test/plans",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}

	if len(renderer.requests) != 1 {
		t.Fatalf("rendered %d times, want once", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "subscription_ended" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
		t.Errorf("rendered %s in %s and %s, want subscription_ended in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
	}
	if data := request.Data; data["plan_name"] != "All you can read" || data["ended_at"] != "2026-05-02T00:00:00Z" ||
		!strings.HasSuffix(data["plans_url"].(string), "://aoto.example.test/plans") {
		t.Errorf("data = %#v, want All you can read ended on 2 May with the site's plans", data)
	}
}

// A reader who deleted their account has nobody to send the mail to.
func TestSubscriptionEndedEmailDropsASubscriptionWhoseReaderIsGone(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	event, subscriptionID := env.subscriptionEndedEvent(t, env.tenantID)
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE subscriptions SET user_id = NULL WHERE id = $1`, subscriptionID); err != nil {
		t.Fatalf("detach the reader: %v", err)
	}

	mailer := &recordingMailer{}
	handler := outbox.NewSubscriptionEndedEmailHandler(outbox.EmailHandlerConfig{
		DB: env.pg.DB, Encryptor: env.encryptor, Mailer: mailer,
	})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("subscription ended handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}

// An event that names no subscription, no end, or a subscription of another
// tenant will not read differently on a retry.
func TestSubscriptionEndedEmailFailsForGoodOnAnEventItCannotWord(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	other := env.pg.SeedTenant(t, "OUTBOXSE001", "other-subscription-ended.example.test", "Other Press")
	event, _ := env.subscriptionEndedEvent(t, env.tenantID)
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
	foreign, _ := env.subscriptionEndedEvent(t, other.ID)

	for name, event := range map[string]dbmodels.OutboxEvent{
		"no subscription":                  rewrite(t, func(payload map[string]any) { payload["subscription_id"] = "not-a-uuid" }),
		"no end":                           rewrite(t, func(payload map[string]any) { delete(payload, "ended_at") }),
		"a subscription of another tenant": foreign,
	} {
		t.Run(name, func(t *testing.T) {
			mailer := &recordingMailer{}
			handler := outbox.NewSubscriptionEndedEmailHandler(outbox.EmailHandlerConfig{
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
