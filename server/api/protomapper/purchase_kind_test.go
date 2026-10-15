package protomapper

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func TestPurchaseKindRoundTripsEveryKind(t *testing.T) {
	for _, stored := range []paymentprovider.Kind{paymentprovider.KindPurchase, paymentprovider.KindRental} {
		kind, err := PurchaseKindFromStored(string(stored))
		if err != nil {
			t.Fatalf("PurchaseKindFromStored(%q): %v", stored, err)
		}
		back, err := PurchaseKindFromRequest(kind)
		if err != nil {
			t.Fatalf("PurchaseKindFromRequest(%s): %v", kind, err)
		}
		if back != stored {
			t.Fatalf("round trip of %q = %q", stored, back)
		}
	}
}

func TestPurchaseKindFromStoredFailsOnAValueItDoesNotKnow(t *testing.T) {
	if _, err := PurchaseKindFromStored("subscription"); !errors.Is(err, ErrUnknownPurchaseKind) {
		t.Fatalf("err = %v, want ErrUnknownPurchaseKind", err)
	}
}

func TestPurchaseKindFromRequestReadsUnspecifiedAsThePermanentCopy(t *testing.T) {
	kind, err := PurchaseKindFromRequest(publirattypesv1.PurchaseKind_PURCHASE_KIND_UNSPECIFIED)
	if err != nil || kind != paymentprovider.KindPurchase {
		t.Fatalf("PurchaseKindFromRequest(unspecified) = (%q, %v), want %q", kind, err, paymentprovider.KindPurchase)
	}
	if _, err := PurchaseKindFromRequest(publirattypesv1.PurchaseKind(99)); !errors.Is(err, ErrUnknownPurchaseKind) {
		t.Fatalf("err = %v, want ErrUnknownPurchaseKind", err)
	}
}
