package outbox_test

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	consumePackageName = "com.example.reader"
	consumeProductID   = "episode_300"
	consumeToken       = "play-token-0001.AO-J1Oy"
)

// consumeEvent is the event ConfirmStorePurchase queues for a Google Play
// purchase of tenantID.
func consumeEvent(t *testing.T, tenantID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(outbox.GooglePlayPurchaseConsumePayload{
		TenantID:      tenantID.String(),
		PurchaseID:    uuid.NewString(),
		ProductID:     consumeProductID,
		PurchaseToken: consumeToken,
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType: outbox.EventTypeGooglePlayPurchaseConsume,
		Payload:   payload,
	}
}

// seedGooglePlayTenant saves an enabled Google Play store for a tenant whose
// Android app is consumePackageName.
func seedGooglePlayTenant(t *testing.T, pg *testutil.PostgresEnv, encryptor *secretcrypto.Manager, enabled bool) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tenant := pg.SeedTenant(t, "PLAYCONS0001", "play-consume.example.com", "Play Consume")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, android_application_id, android_sha256_cert_fingerprints)
		VALUES ($1, $2, ARRAY[$3])
	`, tenant.ID, consumePackageName, strings.Repeat("AB:", 31)+"AB"); err != nil {
		t.Fatalf("set app identity: %v", err)
	}
	if _, err := paymentsettings.NewAppStores(dbmodels.New(pg.DB), encryptor).Update(ctx, tenant.ID, paymentsettings.StoreUpdateInput{
		Route: paymentsettings.RouteExternalCheckout,
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     enabled,
			ServiceAccountKey:           testutil.ServiceAccountJSON(t, "reader-app", "publira@reader-app.iam.gserviceaccount.com"),
			ServiceAccountKeyUpdateMode: secretupdate.Replace,
		},
	}); err != nil {
		t.Fatalf("save google play settings: %v", err)
	}
	return tenant.ID
}

func newConsumeEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{9}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func TestGooglePlayPurchaseConsumeHandlerConsumesThePurchaseOnce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)
	play.Put(t, consumePackageName, consumeProductID, consumeToken, googleplaytest.Purchased, uuid.NewString())

	// The worker drains as publira_outbox, so the credentials are read through
	// the grants that role holds.
	handler := outbox.NewGooglePlayPurchaseConsumeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	event := consumeEvent(t, tenantID)
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	// A repeated delivery finds the purchase consumed and asks nothing more.
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler on redelivery: %v", err)
	}
	if got := play.Consumes(consumePackageName, consumeProductID, consumeToken); got != 1 {
		t.Fatalf("consume requests = %d, want 1", got)
	}
}

func TestGooglePlayPurchaseConsumeHandlerLeavesAPurchaseTheAppConsumed(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)
	play.Put(t, consumePackageName, consumeProductID, consumeToken, googleplaytest.Consumed, uuid.NewString())

	handler := outbox.NewGooglePlayPurchaseConsumeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	if err := handler(context.Background(), consumeEvent(t, tenantID)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if got := play.Consumes(consumePackageName, consumeProductID, consumeToken); got != 0 {
		t.Fatalf("consume requests = %d, want 0", got)
	}
}

func TestGooglePlayPurchaseConsumeHandlerRetriesWhileTheStoreIsOff(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, false)
	play := googleplaytest.NewServer(t)
	play.Put(t, consumePackageName, consumeProductID, consumeToken, googleplaytest.Purchased, uuid.NewString())

	handler := outbox.NewGooglePlayPurchaseConsumeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	err := handler(context.Background(), consumeEvent(t, tenantID))
	if err == nil || outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
	if got := play.Consumes(consumePackageName, consumeProductID, consumeToken); got != 0 {
		t.Fatalf("consume requests = %d, want 0", got)
	}
}

func TestGooglePlayPurchaseConsumeHandlerDropsAPurchaseGooglePlayDoesNotKnow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)

	handler := outbox.NewGooglePlayPurchaseConsumeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	if err := handler(context.Background(), consumeEvent(t, tenantID)); !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}
