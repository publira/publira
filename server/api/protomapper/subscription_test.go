package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestSubscriptionPlanScopeRoundTripsEveryScope(t *testing.T) {
	for _, stored := range []string{SubscriptionPlanScopeAll, SubscriptionPlanScopeLabel, SubscriptionPlanScopeSeries} {
		scope, err := SubscriptionPlanScopeFromStored(stored)
		if err != nil {
			t.Fatalf("SubscriptionPlanScopeFromStored(%q): %v", stored, err)
		}
		back, err := SubscriptionPlanScopeFromRequest(scope)
		if err != nil {
			t.Fatalf("SubscriptionPlanScopeFromRequest(%s): %v", scope, err)
		}
		if back != stored {
			t.Fatalf("round trip of %q = %q", stored, back)
		}
	}
}

func TestSubscriptionPlanScopeFromRequestRefusesUnspecified(t *testing.T) {
	for _, scope := range []publirattypesv1.SubscriptionPlanScope{
		publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED,
		publirattypesv1.SubscriptionPlanScope(99),
	} {
		if _, err := SubscriptionPlanScopeFromRequest(scope); !errors.Is(err, ErrUnknownSubscriptionValue) {
			t.Errorf("SubscriptionPlanScopeFromRequest(%d) = %v, want ErrUnknownSubscriptionValue", scope, err)
		}
	}
}

// Every value the columns may hold maps to a named enum value, and anything
// else is reported rather than answered as unspecified.
func TestSubscriptionValuesFromStoredKnowEveryStoredValue(t *testing.T) {
	for _, stored := range []paymentprovider.Interval{paymentprovider.IntervalDay, paymentprovider.IntervalWeek, paymentprovider.IntervalMonth, paymentprovider.IntervalYear} {
		if interval, err := SubscriptionIntervalFromStored(string(stored)); err != nil || interval == publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_UNSPECIFIED {
			t.Errorf("SubscriptionIntervalFromStored(%q) = (%s, %v)", stored, interval, err)
		}
	}
	for _, stored := range []paymentprovider.SubscriptionStatus{
		paymentprovider.SubscriptionIncomplete, paymentprovider.SubscriptionIncompleteExpired, paymentprovider.SubscriptionTrialing,
		paymentprovider.SubscriptionActive, paymentprovider.SubscriptionPastDue, paymentprovider.SubscriptionCanceled,
		paymentprovider.SubscriptionUnpaid, paymentprovider.SubscriptionPaused,
	} {
		if status, err := SubscriptionStatusFromStored(string(stored)); err != nil || status == publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNSPECIFIED {
			t.Errorf("SubscriptionStatusFromStored(%q) = (%s, %v)", stored, status, err)
		}
	}
	if _, err := SubscriptionPlanScopeFromStored("genre"); !errors.Is(err, ErrUnknownSubscriptionValue) {
		t.Errorf("SubscriptionPlanScopeFromStored(genre) = %v", err)
	}
	if _, err := SubscriptionIntervalFromStored("fortnight"); !errors.Is(err, ErrUnknownSubscriptionValue) {
		t.Errorf("SubscriptionIntervalFromStored(fortnight) = %v", err)
	}
	if _, err := SubscriptionStatusFromStored("suspended"); !errors.Is(err, ErrUnknownSubscriptionValue) {
		t.Errorf("SubscriptionStatusFromStored(suspended) = %v", err)
	}
}
