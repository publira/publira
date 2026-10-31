package googleplay_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/googleplay/googleplaytest"
)

const subscriptionProductID = "plan_monthly"

func TestGetSubscriptionPurchaseReadsTheSubscription(t *testing.T) {
	server := googleplaytest.NewServer(t)
	expiry := time.Date(2025, 10, 24, 8, 0, 0, 0, time.UTC)
	server.PutSubscription(t, packageName, token, googleplaytest.SubscriptionActive, subscriptionProductID, accountID, expiry)

	got, err := server.Client().GetSubscriptionPurchase(context.Background(), key(t), packageName, token)
	if err != nil {
		t.Fatalf("GetSubscriptionPurchase: %v", err)
	}
	if got.SubscriptionState != googleplay.SubscriptionStateActive || got.ExternalAccountIdentifiers.ObfuscatedExternalAccountID != accountID || got.IsTest() {
		t.Fatalf("GetSubscriptionPurchase = %+v, want a paid subscription for %s", got, accountID)
	}
	item, ok := got.LineItem(subscriptionProductID)
	if !ok || item.ExpiryTime != expiry.Format(time.RFC3339Nano) || item.AutoRenewingPlan == nil || !item.AutoRenewingPlan.AutoRenewEnabled {
		t.Fatalf("line item = %+v, %v, want %s renewing after %s", item, ok, subscriptionProductID, expiry)
	}
	if _, ok := got.LineItem("plan_yearly"); ok {
		t.Fatal("LineItem found a product the subscription does not bill")
	}
}

func TestGetSubscriptionPurchaseTellsALicenseTestersSubscription(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.PutSubscription(t, packageName, token, googleplaytest.SubscriptionTestPurchase, subscriptionProductID, accountID, time.Now().Add(time.Hour))

	got, err := server.Client().GetSubscriptionPurchase(context.Background(), key(t), packageName, token)
	if err != nil {
		t.Fatalf("GetSubscriptionPurchase: %v", err)
	}
	if !got.IsTest() {
		t.Fatalf("GetSubscriptionPurchase = %+v, want a test subscription", got)
	}
}

func TestGetSubscriptionPurchaseAnswersNotFoundForAnUnknownToken(t *testing.T) {
	server := googleplaytest.NewServer(t)
	_, err := server.Client().GetSubscriptionPurchase(context.Background(), key(t), packageName, token)
	if !errors.Is(err, googleplay.ErrPurchaseNotFound) {
		t.Fatalf("error = %v, want ErrPurchaseNotFound", err)
	}
}

func TestAcknowledgeSubscriptionPurchaseAcknowledgesTheSubscription(t *testing.T) {
	server := googleplaytest.NewServer(t)
	server.PutSubscription(t, packageName, token, googleplaytest.SubscriptionActive, subscriptionProductID, accountID, time.Now().Add(time.Hour))
	client := server.Client()

	if err := client.AcknowledgeSubscriptionPurchase(context.Background(), key(t), packageName, subscriptionProductID, token); err != nil {
		t.Fatalf("AcknowledgeSubscriptionPurchase: %v", err)
	}
	got, err := client.GetSubscriptionPurchase(context.Background(), key(t), packageName, token)
	if err != nil {
		t.Fatalf("GetSubscriptionPurchase: %v", err)
	}
	if got.AcknowledgementState != googleplay.AcknowledgementStateAcknowledged || server.Acknowledgments(packageName, token) != 1 {
		t.Fatalf("after acknowledging: %+v, %d acknowledgements", got, server.Acknowledgments(packageName, token))
	}
}
