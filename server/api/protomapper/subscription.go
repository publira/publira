package protomapper

import (
	"errors"
	"fmt"

	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// The values subscription_plans.scope holds.
const (
	SubscriptionPlanScopeAll    = "all"
	SubscriptionPlanScopeLabel  = "label"
	SubscriptionPlanScopeSeries = "series"
)

// ErrUnknownSubscriptionValue reports a stored plan scope, interval, or
// subscription status this build does not know, or a requested scope it does
// not.
var ErrUnknownSubscriptionValue = errors.New("unknown subscription value")

// SubscriptionPlanScopeFromStored maps subscription_plans.scope.
func SubscriptionPlanScopeFromStored(stored string) (publirattypesv1.SubscriptionPlanScope, error) {
	switch stored {
	case SubscriptionPlanScopeAll:
		return publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_ALL, nil
	case SubscriptionPlanScopeLabel:
		return publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_LABEL, nil
	case SubscriptionPlanScopeSeries:
		return publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES, nil
	default:
		return publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED, fmt.Errorf("%w: plan scope %q", ErrUnknownSubscriptionValue, stored)
	}
}

// SubscriptionPlanScopeFromRequest maps the scope a plan is saved with.
// Unspecified is refused: a plan states what it opens.
func SubscriptionPlanScopeFromRequest(scope publirattypesv1.SubscriptionPlanScope) (string, error) {
	switch scope {
	case publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_ALL:
		return SubscriptionPlanScopeAll, nil
	case publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_LABEL:
		return SubscriptionPlanScopeLabel, nil
	case publirattypesv1.SubscriptionPlanScope_SUBSCRIPTION_PLAN_SCOPE_SERIES:
		return SubscriptionPlanScopeSeries, nil
	default:
		return "", fmt.Errorf("%w: plan scope %d", ErrUnknownSubscriptionValue, scope)
	}
}

// SubscriptionIntervalFromStored maps subscription_plans.recurring_interval.
func SubscriptionIntervalFromStored(stored string) (publirattypesv1.SubscriptionInterval, error) {
	switch paymentprovider.Interval(stored) {
	case paymentprovider.IntervalDay:
		return publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_DAY, nil
	case paymentprovider.IntervalWeek:
		return publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_WEEK, nil
	case paymentprovider.IntervalMonth:
		return publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_MONTH, nil
	case paymentprovider.IntervalYear:
		return publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_YEAR, nil
	default:
		return publirattypesv1.SubscriptionInterval_SUBSCRIPTION_INTERVAL_UNSPECIFIED, fmt.Errorf("%w: interval %q", ErrUnknownSubscriptionValue, stored)
	}
}

// SubscriptionStatusFromStored maps subscriptions.status.
func SubscriptionStatusFromStored(stored string) (publirattypesv1.SubscriptionStatus, error) {
	switch paymentprovider.SubscriptionStatus(stored) {
	case paymentprovider.SubscriptionIncomplete:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_INCOMPLETE, nil
	case paymentprovider.SubscriptionIncompleteExpired:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_INCOMPLETE_EXPIRED, nil
	case paymentprovider.SubscriptionTrialing:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_TRIALING, nil
	case paymentprovider.SubscriptionActive:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE, nil
	case paymentprovider.SubscriptionPastDue:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE, nil
	case paymentprovider.SubscriptionCanceled:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELED, nil
	case paymentprovider.SubscriptionUnpaid:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNPAID, nil
	case paymentprovider.SubscriptionPaused:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAUSED, nil
	default:
		return publirattypesv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNSPECIFIED, fmt.Errorf("%w: subscription status %q", ErrUnknownSubscriptionValue, stored)
	}
}
