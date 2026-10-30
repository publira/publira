package storesubscription_test

import (
	"testing"
	"time"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/storesubscription"
)

func TestFromAppStoreMapsEveryStatus(t *testing.T) {
	expires := time.Date(2026, 11, 30, 12, 0, 0, 0, time.UTC)
	grace := expires.Add(16 * 24 * time.Hour)
	revoked := expires.Add(-10 * 24 * time.Hour)
	transaction := appstore.Transaction{ExpiresDate: expires.UnixMilli(), RevocationDate: revoked.UnixMilli()}
	renewing := appstore.RenewalInfo{AutoRenewStatus: appstore.AutoRenewOn, GracePeriodExpiresDate: grace.UnixMilli()}

	for _, tc := range []struct {
		name   string
		status int
		want   storesubscription.State
	}{
		{"active", appstore.SubscriptionStatusActive, storesubscription.State{Status: paymentprovider.SubscriptionActive, CurrentPeriodEnd: expires}},
		{"expired", appstore.SubscriptionStatusExpired, storesubscription.State{Status: paymentprovider.SubscriptionCanceled, CurrentPeriodEnd: expires}},
		{"billing retry", appstore.SubscriptionStatusBillingRetry, storesubscription.State{Status: paymentprovider.SubscriptionUnpaid, CurrentPeriodEnd: expires}},
		{"billing grace period", appstore.SubscriptionStatusBillingGracePeriod, storesubscription.State{Status: paymentprovider.SubscriptionPastDue, CurrentPeriodEnd: grace}},
		{"revoked", appstore.SubscriptionStatusRevoked, storesubscription.State{Status: paymentprovider.SubscriptionCanceled, CurrentPeriodEnd: revoked}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := storesubscription.FromAppStore(tc.status, transaction, renewing)
			if err != nil {
				t.Fatalf("FromAppStore: %v", err)
			}
			if got != tc.want {
				t.Fatalf("FromAppStore = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestFromAppStoreEndsASubscriptionWhoseRenewalIsOffWithItsPeriod(t *testing.T) {
	expires := time.Date(2026, 11, 30, 12, 0, 0, 0, time.UTC)
	got, err := storesubscription.FromAppStore(appstore.SubscriptionStatusActive,
		appstore.Transaction{ExpiresDate: expires.UnixMilli()},
		appstore.RenewalInfo{AutoRenewStatus: appstore.AutoRenewOff})
	if err != nil {
		t.Fatalf("FromAppStore: %v", err)
	}
	want := storesubscription.State{Status: paymentprovider.SubscriptionActive, CurrentPeriodEnd: expires, CancelAtPeriodEnd: true}
	if got != want {
		t.Fatalf("FromAppStore = %+v, want %+v", got, want)
	}
}

func TestFromAppStoreRefusesAStatusItDoesNotKnow(t *testing.T) {
	if _, err := storesubscription.FromAppStore(6, appstore.Transaction{}, appstore.RenewalInfo{AutoRenewStatus: appstore.AutoRenewOn}); err == nil {
		t.Fatal("FromAppStore accepted status 6")
	}
}

func TestFromGooglePlayMapsEveryState(t *testing.T) {
	expiry := time.Date(2026, 11, 30, 12, 0, 0, 0, time.UTC)
	renewing := googleplay.SubscriptionLineItem{
		ExpiryTime:       expiry.Format(time.RFC3339Nano),
		AutoRenewingPlan: &googleplay.AutoRenewingPlan{AutoRenewEnabled: true},
	}

	for _, tc := range []struct {
		state string
		want  storesubscription.State
	}{
		{googleplay.SubscriptionStateActive, storesubscription.State{Status: paymentprovider.SubscriptionActive, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStateCanceled, storesubscription.State{Status: paymentprovider.SubscriptionActive, CurrentPeriodEnd: expiry, CancelAtPeriodEnd: true}},
		{googleplay.SubscriptionStateInGracePeriod, storesubscription.State{Status: paymentprovider.SubscriptionPastDue, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStateOnHold, storesubscription.State{Status: paymentprovider.SubscriptionUnpaid, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStatePaused, storesubscription.State{Status: paymentprovider.SubscriptionPaused, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStateExpired, storesubscription.State{Status: paymentprovider.SubscriptionCanceled, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStatePending, storesubscription.State{Status: paymentprovider.SubscriptionIncomplete, CurrentPeriodEnd: expiry}},
		{googleplay.SubscriptionStatePendingPurchaseCanceled, storesubscription.State{Status: paymentprovider.SubscriptionIncompleteExpired, CurrentPeriodEnd: expiry}},
	} {
		t.Run(tc.state, func(t *testing.T) {
			got, err := storesubscription.FromGooglePlay(googleplay.SubscriptionPurchase{SubscriptionState: tc.state}, renewing)
			if err != nil {
				t.Fatalf("FromGooglePlay: %v", err)
			}
			if got != tc.want {
				t.Fatalf("FromGooglePlay = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestFromGooglePlayEndsASubscriptionWhoseRenewalIsOffWithItsPeriod(t *testing.T) {
	item := googleplay.SubscriptionLineItem{
		ExpiryTime:       "2026-11-30T12:00:00.123Z",
		AutoRenewingPlan: &googleplay.AutoRenewingPlan{},
	}
	got, err := storesubscription.FromGooglePlay(googleplay.SubscriptionPurchase{SubscriptionState: googleplay.SubscriptionStateActive}, item)
	if err != nil {
		t.Fatalf("FromGooglePlay: %v", err)
	}
	want := storesubscription.State{
		Status:            paymentprovider.SubscriptionActive,
		CurrentPeriodEnd:  time.Date(2026, 11, 30, 12, 0, 0, 123_000_000, time.UTC),
		CancelAtPeriodEnd: true,
	}
	if got != want {
		t.Fatalf("FromGooglePlay = %+v, want %+v", got, want)
	}
}

func TestFromGooglePlayRefusesAStateItDoesNotKnow(t *testing.T) {
	if _, err := storesubscription.FromGooglePlay(googleplay.SubscriptionPurchase{SubscriptionState: "SUBSCRIPTION_STATE_UNSPECIFIED"}, googleplay.SubscriptionLineItem{}); err == nil {
		t.Fatal("FromGooglePlay accepted an unspecified state")
	}
}
