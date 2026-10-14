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
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

type purchaseReceiptEnv struct {
	pg        *testutil.PostgresEnv
	queries   *dbmodels.Queries
	encryptor *secretcrypto.Manager
	tenantID  uuid.UUID
	readerID  uuid.UUID
	episodeID uuid.UUID
}

// newPurchaseReceiptEnv seeds a tenant that sells in English from Tokyo, with
// a reader who can buy an episode of one series and the platform's SMTP
// settings to send the receipt through.
func newPurchaseReceiptEnv(t *testing.T, ctx context.Context) purchaseReceiptEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "OUTBOXPR001", "aoto.example.test", "Aoto Press")
	if _, err := pg.DB.ExecContext(ctx,
		`UPDATE tenants SET default_locale = 'en', timezone = 'Asia/Tokyo' WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("set tenant locale and time zone: %v", err)
	}
	reader := pg.SeedEndUser(t, tenant.ID, "OUTBOXPRU01", "reader@example.test", "Rin Amagai")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{Title: "The Lighthouse Keeper", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		Title:  "The First Night",
		Price:  500,
		Status: testutil.EpisodeStatusPublished,
	})

	queries := dbmodels.New(pg.DB)
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := queries.InsertPlatformSMTPConfig(ctx, dbmodels.InsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("InsertPlatformSMTPConfig: %v", err)
	}
	return purchaseReceiptEnv{
		pg: pg, queries: queries, encryptor: encryptor,
		tenantID: tenant.ID, readerID: reader.ID, episodeID: episode.ID,
	}
}

// purchase records a paid checkout the way the payment webhook does, bought at
// purchasedAt.
func (e purchaseReceiptEnv) purchase(t *testing.T, ctx context.Context, checkoutID string, purchasedAt time.Time, expiresAt sql.NullTime) dbmodels.Purchase {
	t.Helper()

	purchase, err := e.queries.CreatePurchaseFromProviderCheckout(ctx, dbmodels.CreatePurchaseFromProviderCheckoutParams{
		ID:                 uuid.New(),
		TenantID:           e.tenantID,
		UserID:             e.readerID,
		EpisodeID:          e.episodeID,
		PriceAtPurchase:    500,
		ExpiresAt:          expiresAt,
		Provider:           "stripe",
		ProviderCheckoutID: checkoutID,
		Currency:           "JPY",
	})
	if err != nil {
		t.Fatalf("CreatePurchaseFromProviderCheckout: %v", err)
	}
	if _, err := e.pg.DB.ExecContext(ctx, `UPDATE purchases SET purchased_at = $2 WHERE id = $1`, purchase.ID, purchasedAt); err != nil {
		t.Fatalf("set purchased_at: %v", err)
	}
	return purchase
}

func (e purchaseReceiptEnv) event(t *testing.T, purchaseID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()

	payload, err := json.Marshal(outbox.PurchaseReceiptPayload{
		TenantID:   e.tenantID.String(),
		PurchaseID: purchaseID.String(),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: e.tenantID, Valid: true},
		EventType:      outbox.EventTypePurchaseReceipt,
		Payload:        payload,
		IdempotencyKey: outbox.PurchaseReceiptIdempotencyKey(purchaseID),
	}
}

func (e purchaseReceiptEnv) handler(mailer internalsmtp.RenderedSender, renderer emailrenderer.Renderer) outbox.Handler {
	return outbox.NewPurchaseReceiptEmailHandler(outbox.EmailHandlerConfig{
		DB: e.pg.DB, Encryptor: e.encryptor, Mailer: mailer, Renderer: renderer,
	})
}

// recordingRenderer answers every request with the same HTML and keeps what it
// was asked to render.
type recordingRenderer struct{ requests []emailrenderer.Request }

func (r *recordingRenderer) Render(_ context.Context, request emailrenderer.Request) (emailrenderer.Email, error) {
	r.requests = append(r.requests, request)
	return emailrenderer.Email{HTML: "<p>receipt</p>"}, nil
}

func TestPurchaseReceiptEmailTellsTheReaderWhatTheyBought(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnv(t, ctx)
	purchasedAt := time.Date(2030, time.January, 15, 12, 0, 0, 0, time.UTC)
	purchase := env.purchase(t, ctx, "cs_receipt", purchasedAt,
		sql.NullTime{Time: purchasedAt.Add(48 * time.Hour), Valid: true})

	mailer := &recordingMailer{}
	renderer := &recordingRenderer{}
	if err := env.handler(mailer, renderer)(ctx, env.event(t, purchase.ID)); err != nil {
		t.Fatalf("purchase receipt handler: %v", err)
	}

	if got := mailer.recipients(); len(got) != 1 || got[0] != "reader@example.test" {
		t.Fatalf("mailed %v, want the reader alone", got)
	}
	sent := mailer.sent[0].email
	if sent.Subject != "Aoto Press purchase receipt" {
		t.Errorf("subject = %q", sent.Subject)
	}
	// The instants are written in the tenant's zone, nine hours ahead of UTC.
	for _, fragment := range []string{
		"Series: The Lighthouse Keeper",
		"Episode: The First Night",
		"Price paid: ¥500 (JPY)",
		"Purchased: Jan 15, 2030, 9:00\u202fPM",
		"Readable until: Jan 17, 2030, 9:00\u202fPM",
		"://aoto.example.test/my/library",
	} {
		if !strings.Contains(sent.Text, fragment) {
			t.Errorf("the mail does not carry %q:\n%s", fragment, sent.Text)
		}
	}
	if sent.HTML != "<p>receipt</p>" {
		t.Errorf("HTML = %q, want the renderer's", sent.HTML)
	}

	if len(renderer.requests) != 1 {
		t.Fatalf("rendered %d times, want once", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "purchase_receipt" || request.Locale != "en" || request.TimeZone != "Asia/Tokyo" {
		t.Errorf("rendered %s in %s and %s, want purchase_receipt in en and Asia/Tokyo", request.Template, request.Locale, request.TimeZone)
	}
	// The renderer formats the amount itself, so it receives the stored minor
	// unit and currency rather than the text the plain part was written with.
	if request.Data["amount"] != int64(500) || request.Data["currency"] != "JPY" {
		t.Errorf("amount = %#v %#v, want 500 JPY", request.Data["amount"], request.Data["currency"])
	}
	if request.Data["purchased_at"] != "2030-01-15T12:00:00Z" || request.Data["expires_at"] != "2030-01-17T12:00:00Z" {
		t.Errorf("instants = %v and %v, want the stored ones in RFC 3339", request.Data["purchased_at"], request.Data["expires_at"])
	}
}

// A purchase with no reading period is readable for good, and its receipt
// names no end.
func TestPurchaseReceiptEmailNamesNoEndForAPurchaseWithoutOne(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnv(t, ctx)
	purchase := env.purchase(t, ctx, "cs_receipt_forever", time.Date(2030, time.January, 15, 12, 0, 0, 0, time.UTC), sql.NullTime{})

	mailer := &recordingMailer{}
	if err := env.handler(mailer, nil)(ctx, env.event(t, purchase.ID)); err != nil {
		t.Fatalf("purchase receipt handler: %v", err)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d mails, want 1", len(mailer.sent))
	}
	if text := mailer.sent[0].email.Text; strings.Contains(text, "Readable until") {
		t.Errorf("the mail names an end the purchase does not have:\n%s", text)
	}
}

// A reader who deleted their account after paying keeps a purchase with no
// user, and there is nobody to send its receipt to.
func TestPurchaseReceiptEmailDropsAPurchaseWhoseReaderIsGone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnv(t, ctx)
	purchase := env.purchase(t, ctx, "cs_receipt_gone", time.Now(), sql.NullTime{})
	if _, err := env.pg.DB.ExecContext(ctx, `UPDATE purchases SET user_id = NULL WHERE id = $1`, purchase.ID); err != nil {
		t.Fatalf("detach the reader: %v", err)
	}

	mailer := &recordingMailer{}
	if err := env.handler(mailer, nil)(ctx, env.event(t, purchase.ID)); err != nil {
		t.Fatalf("purchase receipt handler: %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}

// A purchase the event names that does not exist in the event's tenant will
// not appear on a retry.
func TestPurchaseReceiptEmailFailsForGoodOnAPurchaseOfAnotherTenant(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	env := newPurchaseReceiptEnv(t, ctx)
	other := env.pg.SeedTenant(t, "OUTBOXPR002", "other.example.test", "Other Press")
	purchase := env.purchase(t, ctx, "cs_receipt_other", time.Now(), sql.NullTime{})

	event := env.event(t, purchase.ID)
	payload, err := json.Marshal(outbox.PurchaseReceiptPayload{TenantID: other.ID.String(), PurchaseID: purchase.ID.String()})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event.TenantID = uuid.NullUUID{UUID: other.ID, Valid: true}
	event.Payload = payload

	mailer := &recordingMailer{}
	err = env.handler(mailer, nil)(ctx, event)
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("sent %d mails, want none", len(mailer.sent))
	}
}
