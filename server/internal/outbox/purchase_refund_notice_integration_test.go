package outbox_test

import (
	"context"
	"database/sql"
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

// refundNoticeEvent is the event the webhook queues for a refund of amount
// that brought the purchase's refunds to total.
func (e purchaseReceiptEnv) refundNoticeEvent(t *testing.T, purchaseID uuid.UUID, amount, total int64, closed bool) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.PurchaseRefundNoticePayload{
		TenantID:       e.tenantID.String(),
		PurchaseID:     purchaseID.String(),
		RefundedAmount: amount,
		RefundedTotal:  total,
		Currency:       "JPY",
		Closed:         closed,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypePurchaseRefundNotice,
		Payload:        payload,
		IdempotencyKey: outbox.PurchaseRefundNoticeIdempotencyKey(purchaseID, int32(total)),
	}
}

func (e purchaseReceiptEnv) refundNoticeHandler(mailer internalsmtp.RenderedSender, renderer emailrenderer.Renderer) outbox.Handler {
	return outbox.NewPurchaseRefundNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer, Renderer: renderer,
	})
}

// A full refund tells the reader what was refunded and that the episode is
// closed, in the tenant's language, and hands the renderer the refund's own
// amounts beside the price paid.
func TestPurchaseRefundNoticeEmailTellsTheReaderTheEpisodeClosed(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	purchase := env.purchase(t, ctx, "cs_refund_full", time.Now(), sql.NullTime{})

	mailer := &recordingMailer{}
	renderer := &recordingRenderer{}
	if err := env.refundNoticeHandler(mailer, renderer)(ctx, env.refundNoticeEvent(t, purchase.ID, 500, 500, true)); err != nil {
		t.Fatalf("refund notice handler: %v", err)
	}

	if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
		t.Fatalf("mailed %v, want the reader alone", got)
	}
	sent := mailer.sent[0].email
	if sent.Subject != "Aoto Press refund" {
		t.Errorf("subject = %q", sent.Subject)
	}
	for _, fragment := range []string{
		"Series: The Lighthouse Keeper",
		"Episode: The First Night",
		"Amount refunded: ¥500 (JPY)",
		"the episodes it opened are closed to you",
		"://aoto.example.test/my/library",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}

	if len(renderer.requests) != 1 {
		t.Fatalf("rendered %d times, want once", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "purchase_refund_notice" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
		t.Errorf("rendered %s in %s and %s, want purchase_refund_notice in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
	}
	data := request.Data
	if data["amount"] != int64(500) || data["refunded_total"] != int64(500) || data["price"] != int64(500) || data["currency"] != "JPY" || data["closed"] != true {
		t.Errorf("data = %#v, want 500 of 500 JPY refunded and closed", data)
	}
}

// A refund of part of the price says how much it returned, what the refunds
// add up to so far against the price, and that the episode stays open.
func TestPurchaseRefundNoticeEmailTellsTheReaderTheEpisodeStaysOpen(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	purchase := env.purchase(t, ctx, "cs_refund_part", time.Now(), sql.NullTime{})

	mailer := &recordingMailer{}
	if err := env.refundNoticeHandler(mailer, nil)(ctx, env.refundNoticeEvent(t, purchase.ID, 100, 300, false)); err != nil {
		t.Fatalf("refund notice handler: %v", err)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d mails, want 1", len(mailer.sent))
	}
	text := mailer.sent[0].email.Text
	for _, fragment := range []string{
		"Amount refunded: ¥100 (JPY)",
		"Refunded in total: ¥300 of the ¥500 paid",
		"the episodes you bought stay open to you",
	} {
		if !strings.Contains(text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, text)
		}
	}
	if strings.Contains(text, "closed to you") {
		t.Errorf("the mail of a refund in part says the episode closed:\n%s", text)
	}
}

// A reader who deleted their account has nobody to send the mail to.
func TestPurchaseRefundNoticeEmailDropsAPurchaseWhoseReaderIsGone(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	purchase := env.purchase(t, ctx, "cs_refund_gone", time.Now(), sql.NullTime{})
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE purchases SET user_id = NULL WHERE id = $1`, purchase.ID); err != nil {
		t.Fatalf("detach the reader: %v", err)
	}

	mailer := &recordingMailer{}
	if err := env.refundNoticeHandler(mailer, nil)(ctx, env.refundNoticeEvent(t, purchase.ID, 500, 500, true)); err != nil {
		t.Fatalf("refund notice handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}

// An event that names no refund, or a purchase of another tenant, will not
// read differently on a retry.
func TestPurchaseRefundNoticeEmailFailsForGoodOnAnEventItCannotWord(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnvOn(t, ctx, testutil.StartIsolatedPostgres(t))
	purchase := env.purchase(t, ctx, "cs_refund_bad", time.Now(), sql.NullTime{})
	other := env.pg.SeedTenant(t, "OUTBOXPR003", "other-refund.example.test", "Other Press")

	foreign := env.refundNoticeEvent(t, purchase.ID, 500, 500, true)
	payload, err := json.Marshal(outbox.PurchaseRefundNoticePayload{
		TenantID: other.ID.String(), PurchaseID: purchase.ID.String(),
		RefundedAmount: 500, RefundedTotal: 500, Currency: "JPY", Closed: true,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	foreign.TenantID = uuid.NullUUID{UUID: other.ID, Valid: true}
	foreign.Payload = payload

	for name, event := range map[string]dbmodels.OutboxEvent{
		"a refund of nothing":          env.refundNoticeEvent(t, purchase.ID, 0, 500, true),
		"a purchase of another tenant": foreign,
	} {
		t.Run(name, func(t *testing.T) {
			mailer := &recordingMailer{}
			err := env.refundNoticeHandler(mailer, nil)(ctx, event)
			if !outbox.IsPermanent(err) {
				t.Fatalf("handler error = %v, want a permanent failure", err)
			}
			if len(mailer.sent) != 0 {
				t.Fatalf("sent %d mails, want none", len(mailer.sent))
			}
		})
	}
}
