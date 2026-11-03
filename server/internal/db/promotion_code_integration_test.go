package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/promotioncode"
	"github.com/publira/publira/server/internal/testutil"
)

// The store products are listed with promotion_code_discounted_price and a
// purchase is priced with promotioncode.Discount, so the two have to agree on
// every price, or the app would be asked for a product the console never
// listed.
func TestPromotionCodeDiscountedPriceAgreesWithTheServer(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, kind := range []string{promotioncode.DiscountPercent, promotioncode.DiscountAmount} {
		for _, value := range []int32{1, 7, 15, 33, 50, 99, 100, 150, 1000} {
			if kind == promotioncode.DiscountPercent && value > 100 {
				continue
			}
			for _, price := range []int32{1, 9, 99, 100, 199, 333, 500, 999, 12000, 2_000_000_000} {
				var got int32
				if err := pg.DB.QueryRowContext(ctx, `SELECT promotion_code_discounted_price($1, $2, $3)`, kind, value, price).Scan(&got); err != nil {
					t.Fatalf("promotion_code_discounted_price(%s, %d, %d): %v", kind, value, price, err)
				}
				if _, want := promotioncode.Discount(kind, value, price); got != want {
					t.Fatalf("promotion_code_discounted_price(%s, %d, %d) = %d, want %d as the server prices it", kind, value, price, got, want)
				}
			}
		}
	}
}

// What a royalty statement credits a purchase at is its list price where a
// code discounted it, and a refund takes back the same share of that as of
// what was paid, rounded down and never more than the list price. A purchase
// without a list price is credited what was paid, and refunded as it was.
func TestPurchaseRoyaltyBasisCreditsTheListPrice(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, tc := range []struct {
		name                         string
		refunded, listPrice, paid    any
		wantBasis, wantRefundedBasis int32
	}{
		{name: "no code", refunded: 100, listPrice: nil, paid: 400, wantBasis: 400, wantRefundedBasis: 100},
		{name: "a code, half refunded", refunded: 200, listPrice: 500, paid: 400, wantBasis: 500, wantRefundedBasis: 250},
		{name: "a code, refunded in full", refunded: 400, listPrice: 500, paid: 400, wantBasis: 500, wantRefundedBasis: 500},
		{name: "a code, rounded down", refunded: 1, listPrice: 500, paid: 300, wantBasis: 500, wantRefundedBasis: 1},
		{name: "a code, refunded beyond the payment", refunded: 450, listPrice: 500, paid: 400, wantBasis: 500, wantRefundedBasis: 500},
		{name: "a code that took the whole price", refunded: 0, listPrice: 500, paid: 0, wantBasis: 500, wantRefundedBasis: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var basis, refunded int32
			if err := pg.DB.QueryRowContext(ctx, `
				SELECT purchase_royalty_basis($2::integer, $3::integer), purchase_royalty_refunded_amount($1::bigint, $2::integer, $3::integer)
			`, tc.refunded, tc.listPrice, tc.paid).Scan(&basis, &refunded); err != nil {
				t.Fatalf("royalty basis: %v", err)
			}
			if basis != tc.wantBasis || refunded != tc.wantRefundedBasis {
				t.Fatalf("basis = %d with %d refunded, want %d with %d", basis, refunded, tc.wantBasis, tc.wantRefundedBasis)
			}
		})
	}
}
