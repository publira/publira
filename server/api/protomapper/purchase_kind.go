package protomapper

import (
	"errors"
	"fmt"

	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// ErrUnknownPurchaseKind reports a purchases.kind value this build does not
// know, or a requested kind it does not.
var ErrUnknownPurchaseKind = errors.New("unknown purchase kind")

// PurchaseKindFromStored maps purchases.kind. A value naming neither sale is
// reported rather than answered as the permanent copy, which would show a
// reader a rental as theirs for good.
func PurchaseKindFromStored(stored string) (publirattypesv1.PurchaseKind, error) {
	switch paymentprovider.Kind(stored) {
	case paymentprovider.KindPurchase:
		return publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE, nil
	case paymentprovider.KindRental:
		return publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL, nil
	default:
		return publirattypesv1.PurchaseKind_PURCHASE_KIND_UNSPECIFIED, fmt.Errorf("%w: %q", ErrUnknownPurchaseKind, stored)
	}
}

// PurchaseKindFromRequest maps the kind a checkout asks for. Unspecified is
// the permanent copy, which every client that predates the field buys.
func PurchaseKindFromRequest(kind publirattypesv1.PurchaseKind) (paymentprovider.Kind, error) {
	switch kind {
	case publirattypesv1.PurchaseKind_PURCHASE_KIND_UNSPECIFIED, publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE:
		return paymentprovider.KindPurchase, nil
	case publirattypesv1.PurchaseKind_PURCHASE_KIND_RENTAL:
		return paymentprovider.KindRental, nil
	default:
		return "", fmt.Errorf("%w: %d", ErrUnknownPurchaseKind, kind)
	}
}
