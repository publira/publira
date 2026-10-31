package outbox_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	acknowledgeProductID = "plan_monthly"
	acknowledgeToken     = "play-subscription-0001.AO-J1Oy"
)

// acknowledgeEvent is the event ConfirmStoreSubscription queues for a Google
// Play subscription of tenantID.
func acknowledgeEvent(t *testing.T, tenantID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(outbox.GooglePlaySubscriptionAcknowledgePayload{
		TenantID:       tenantID.String(),
		SubscriptionID: uuid.NewString(),
		ProductID:      acknowledgeProductID,
		PurchaseToken:  acknowledgeToken,
	})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType: outbox.EventTypeGooglePlaySubscriptionAcknowledge,
		Payload:   payload,
	}
}

func TestGooglePlaySubscriptionAcknowledgeHandlerAcknowledgesTheSubscriptionOnce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)
	play.PutSubscription(t, consumePackageName, acknowledgeToken, googleplaytest.SubscriptionActive, acknowledgeProductID, uuid.NewString(), time.Now().Add(30*24*time.Hour))

	// The worker drains as publira_outbox, so the credentials are read through
	// the grants that role holds.
	handler := outbox.NewGooglePlaySubscriptionAcknowledgeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	event := acknowledgeEvent(t, tenantID)
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	// A repeated delivery finds the subscription acknowledged and asks nothing
	// more.
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler on redelivery: %v", err)
	}
	if got := play.Acknowledgments(consumePackageName, acknowledgeToken); got != 1 {
		t.Fatalf("acknowledge requests = %d, want 1", got)
	}
}

func TestGooglePlaySubscriptionAcknowledgeHandlerLeavesASubscriptionTheAppAcknowledged(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)
	play.PutSubscription(t, consumePackageName, acknowledgeToken, googleplaytest.SubscriptionCanceled, acknowledgeProductID, uuid.NewString(), time.Now().Add(30*24*time.Hour))

	handler := outbox.NewGooglePlaySubscriptionAcknowledgeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	if err := handler(context.Background(), acknowledgeEvent(t, tenantID)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if got := play.Acknowledgments(consumePackageName, acknowledgeToken); got != 0 {
		t.Fatalf("acknowledge requests = %d, want 0", got)
	}
}

func TestGooglePlaySubscriptionAcknowledgeHandlerRetriesWhileTheStoreIsOff(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, false)
	play := googleplaytest.NewServer(t)
	play.PutSubscription(t, consumePackageName, acknowledgeToken, googleplaytest.SubscriptionActive, acknowledgeProductID, uuid.NewString(), time.Now().Add(30*24*time.Hour))

	handler := outbox.NewGooglePlaySubscriptionAcknowledgeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	err := handler(context.Background(), acknowledgeEvent(t, tenantID))
	if err == nil || outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable error", err)
	}
	if got := play.Acknowledgments(consumePackageName, acknowledgeToken); got != 0 {
		t.Fatalf("acknowledge requests = %d, want 0", got)
	}
}

func TestGooglePlaySubscriptionAcknowledgeHandlerDropsASubscriptionGooglePlayDoesNotKnow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newConsumeEncryptor(t)
	tenantID := seedGooglePlayTenant(t, pg, encryptor, true)
	play := googleplaytest.NewServer(t)

	handler := outbox.NewGooglePlaySubscriptionAcknowledgeHandler(outbox.GooglePlayHandlerConfig{
		DB:        pg.OpenOutboxDB(t),
		Encryptor: encryptor,
		Purchases: play.Client(),
	})
	if err := handler(context.Background(), acknowledgeEvent(t, tenantID)); !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent error", err)
	}
}
