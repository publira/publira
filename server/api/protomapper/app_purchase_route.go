package protomapper

import (
	"github.com/publira/publira/server/internal/paymentsettings"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// AppPurchaseRouteFromStored maps tenant_config.app_purchase_route onto the
// enum the console and the app branch on. A stored value naming no route is
// reported rather than answered as the default, for the reason
// paymentsettings.ResolveAppPurchaseRoute gives.
func AppPurchaseRouteFromStored(stored string) (publirattypesv1.AppPurchaseRoute, error) {
	route, err := paymentsettings.ResolveAppPurchaseRoute(stored)
	if err != nil {
		return publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_UNSPECIFIED, err
	}
	if route == paymentsettings.RouteStore {
		return publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE, nil
	}
	return publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT, nil
}

// AppPurchaseRouteToStored maps a requested route onto the value to store.
// APP_PURCHASE_ROUTE_UNSPECIFIED names no route, so it is rejected.
func AppPurchaseRouteToStored(route publirattypesv1.AppPurchaseRoute) (string, error) {
	switch route {
	case publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT:
		return paymentsettings.RouteExternalCheckout, nil
	case publirattypesv1.AppPurchaseRoute_APP_PURCHASE_ROUTE_STORE:
		return paymentsettings.RouteStore, nil
	default:
		return "", paymentsettings.ErrInvalidAppPurchaseRoute
	}
}
