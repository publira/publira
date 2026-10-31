// Package storesubscription holds what the public API and the worker share
// about a subscription the App Store or Google Play bills: the values of
// subscriptions.provider that name a store, and how each store's report of a
// subscription becomes the state subscriptions records for it, in the
// statuses a Stripe subscription takes, so episode_grants and every other
// reader of the table need no store of their own.
package storesubscription

import (
	"fmt"
	"time"

	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/storepurchase"
)

// Values of subscriptions.provider for a subscription a store bills, the same
// as the purchases.store a store purchase is recorded with.
const (
	ProviderAppStore   = storepurchase.StoreAppStore
	ProviderGooglePlay = storepurchase.StoreGooglePlay
)

// State is what subscriptions records of a store subscription.
type State struct {
	Status paymentprovider.SubscriptionStatus
	// CurrentPeriodEnd is where the subscription stops opening its plan's
	// episodes; zero when the store reported none.
	CurrentPeriodEnd  time.Time
	CancelAtPeriodEnd bool
}

// FromAppStore reads the state of a subscription from its status in Get All
// Subscription Statuses, its latest transaction, and its renewal info.
//
// The period paid for ends at the transaction's expiry, except where the App
// Store says otherwise: a renewal it is retrying in the billing grace period
// opens the plan until the grace period ends, and a revoked subscription ends
// when Apple revoked it. A renewal it is retrying past the grace period is
// unpaid, which opens nothing, and the reader turning renewal off leaves the
// subscription to end with the period paid for.
func FromAppStore(status int, transaction appstore.Transaction, renewal appstore.RenewalInfo) (State, error) {
	state := State{
		CurrentPeriodEnd:  fromMillis(transaction.ExpiresDate),
		CancelAtPeriodEnd: renewal.AutoRenewStatus == appstore.AutoRenewOff,
	}
	switch status {
	case appstore.SubscriptionStatusActive:
		state.Status = paymentprovider.SubscriptionActive
	case appstore.SubscriptionStatusBillingGracePeriod:
		state.Status = paymentprovider.SubscriptionPastDue
		if renewal.GracePeriodExpiresDate != 0 {
			state.CurrentPeriodEnd = fromMillis(renewal.GracePeriodExpiresDate)
		}
	case appstore.SubscriptionStatusBillingRetry:
		state.Status = paymentprovider.SubscriptionUnpaid
	case appstore.SubscriptionStatusExpired:
		state.Status = paymentprovider.SubscriptionCanceled
	case appstore.SubscriptionStatusRevoked:
		state.Status = paymentprovider.SubscriptionCanceled
		if transaction.RevocationDate != 0 {
			state.CurrentPeriodEnd = fromMillis(transaction.RevocationDate)
		}
	default:
		return State{}, fmt.Errorf("storesubscription: the App Store reports subscription status %d", status)
	}
	return state, nil
}

// FromGooglePlay reads the state of a subscription from its purchase and the
// line item of the product it bills.
//
// A subscription the reader has canceled stays active until its period ends,
// and so does one with renewal turned off. One in its grace period is past due
// and opens the plan until the expiry Google Play reports; one on hold is
// unpaid, which opens nothing. A pending purchase is incomplete, and one
// canceled before it was paid is incomplete_expired.
func FromGooglePlay(purchase googleplay.SubscriptionPurchase, item googleplay.SubscriptionLineItem) (State, error) {
	state := State{
		CancelAtPeriodEnd: item.AutoRenewingPlan != nil && !item.AutoRenewingPlan.AutoRenewEnabled,
	}
	if item.ExpiryTime != "" {
		expiry, err := time.Parse(time.RFC3339Nano, item.ExpiryTime)
		if err != nil {
			return State{}, fmt.Errorf("storesubscription: Google Play reports an expiry of %q: %w", item.ExpiryTime, err)
		}
		state.CurrentPeriodEnd = expiry.UTC()
	}
	switch purchase.SubscriptionState {
	case googleplay.SubscriptionStateActive:
		state.Status = paymentprovider.SubscriptionActive
	case googleplay.SubscriptionStateCanceled:
		state.Status = paymentprovider.SubscriptionActive
		state.CancelAtPeriodEnd = true
	case googleplay.SubscriptionStateInGracePeriod:
		state.Status = paymentprovider.SubscriptionPastDue
	case googleplay.SubscriptionStateOnHold:
		state.Status = paymentprovider.SubscriptionUnpaid
	case googleplay.SubscriptionStatePaused:
		state.Status = paymentprovider.SubscriptionPaused
	case googleplay.SubscriptionStateExpired:
		state.Status = paymentprovider.SubscriptionCanceled
	case googleplay.SubscriptionStatePending:
		state.Status = paymentprovider.SubscriptionIncomplete
	case googleplay.SubscriptionStatePendingPurchaseCanceled:
		state.Status = paymentprovider.SubscriptionIncompleteExpired
	default:
		return State{}, fmt.Errorf("storesubscription: Google Play reports subscription state %q", purchase.SubscriptionState)
	}
	return state, nil
}

func fromMillis(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}
