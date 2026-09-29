package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestAppPurchaseRouteRoundTripsEveryRoute(t *testing.T) {
	for _, stored := range []string{paymentsettings.RouteExternalCheckout, paymentsettings.RouteStore} {
		route, err := AppPurchaseRouteFromStored(stored)
		if err != nil {
			t.Fatalf("AppPurchaseRouteFromStored(%q): %v", stored, err)
		}
		back, err := AppPurchaseRouteToStored(route)
		if err != nil {
			t.Fatalf("AppPurchaseRouteToStored(%s): %v", route, err)
		}
		if back != stored {
			t.Fatalf("round trip of %q = %q", stored, back)
		}
	}
}

func TestAppPurchaseRouteFromStoredFailsOnAValueItDoesNotKnow(t *testing.T) {
	if _, err := AppPurchaseRouteFromStored("coins"); !errors.Is(err, paymentsettings.ErrUnresolvedAppPurchaseRoute) {
		t.Fatalf("err = %v, want ErrUnresolvedAppPurchaseRoute", err)
	}
}

func TestAppPurchaseRouteToStoredRejectsUnspecified(t *testing.T) {
	if _, err := AppPurchaseRouteToStored(publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_UNSPECIFIED); !errors.Is(err, paymentsettings.ErrInvalidAppPurchaseRoute) {
		t.Fatalf("err = %v, want ErrInvalidAppPurchaseRoute", err)
	}
}
