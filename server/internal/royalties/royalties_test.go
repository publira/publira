package royalties

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestParsePeriodAcceptsOnlyYearAndMonth(t *testing.T) {
	period, err := ParsePeriod("2026-07")
	if err != nil {
		t.Fatalf("ParsePeriod(2026-07): %v", err)
	}
	if want := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC); !period.Equal(want) {
		t.Fatalf("ParsePeriod(2026-07) = %s, want %s", period, want)
	}
	if got := FormatPeriod(period); got != "2026-07" {
		t.Fatalf("FormatPeriod = %q, want 2026-07", got)
	}

	for _, raw := range []string{"", "2026-7", "2026-07-01", "2026/07", "2026-13"} {
		if _, err := ParsePeriod(raw); !errors.Is(err, ErrInvalidPeriod) {
			t.Fatalf("ParsePeriod(%q) error = %v, want ErrInvalidPeriod", raw, err)
		}
	}
}

// The tax of an amount is the amount less the amount without tax rounded
// down, and an adjustment's negative amount includes the negation of what its
// absolute value would.
func TestTaxIncludedRoundsTheAmountWithoutTaxDown(t *testing.T) {
	for _, testCase := range []struct {
		amount int64
		rate   int32
		want   int64
	}{
		{amount: 1100, rate: 1000, want: 100},
		{amount: 105, rate: 1000, want: 10},
		{amount: 108, rate: 850, want: 9},
		{amount: 0, rate: 1000, want: 0},
		{amount: -330, rate: 1000, want: -30},
		{amount: -105, rate: 1000, want: -10},
	} {
		if got := TaxIncluded(testCase.amount, testCase.rate); got != testCase.want {
			t.Errorf("TaxIncluded(%d, %d) = %d, want %d", testCase.amount, testCase.rate, got, testCase.want)
		}
	}
}

func TestWithholdingTakesTheRateOfThePayoutLessItsTax(t *testing.T) {
	rate := sql.NullInt32{Int32: 1021, Valid: true}
	if got := Withholding(rate, 810, sql.NullInt64{Int64: 60, Valid: true}); got != (sql.NullInt64{Int64: 76, Valid: true}) {
		t.Errorf("withholding of 810 with 60 of tax = %v, want 76", got)
	}
	if got := Withholding(rate, 1000, sql.NullInt64{}); got != (sql.NullInt64{Int64: 102, Valid: true}) {
		t.Errorf("withholding of 1000 without tax = %v, want 102", got)
	}
	if got := Withholding(rate, -330, sql.NullInt64{Int64: -30, Valid: true}); got != (sql.NullInt64{Int64: 0, Valid: true}) {
		t.Errorf("withholding of a negative payout = %v, want 0", got)
	}
	if got := Withholding(sql.NullInt32{}, 810, sql.NullInt64{Int64: 60, Valid: true}); got.Valid {
		t.Errorf("withholding without a rate = %v, want none", got)
	}
}

// An Author's lines of sales, of subscription payments, and of adjustments
// add up into one subtotal, in the order of their first line, and a creator
// whose lines have no rate has no tax.
func TestSubtotalsAddUpEachCreatorsLinesInTheOrderOfTheirFirstLine(t *testing.T) {
	artist, author := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	rate := sql.NullInt32{Int32: 1000, Valid: true}
	computation := Computation{
		Lines: []dbmodels.ListRoyaltyLinesForPeriodRow{
			{CreatorID: author, CreatorName: "Author", PayoutAmount: 100},
			{CreatorID: artist, CreatorName: "Artist", PayoutAmount: 660, TaxRateBps: rate},
		},
		SubscriptionLines: []dbmodels.ListRoyaltySubscriptionLinesForPeriodRow{
			{CreatorID: artist, CreatorName: "Artist", PayoutAmount: 110, TaxRateBps: rate},
		},
		Adjustments: []dbmodels.ListRoyaltyAdjustmentLinesForPeriodRow{
			{CreatorID: uuid.NullUUID{UUID: artist, Valid: true}, CreatorName: "Artist (old name)", PayoutAmount: -330, TaxRateBps: rate},
		},
		WithholdingRate: sql.NullInt32{Int32: 1021, Valid: true},
	}
	got := subtotalsOf(computation)
	if len(got) != 2 {
		t.Fatalf("subtotals = %+v, want one per creator", got)
	}
	if got[0].CreatorName != "Author" || got[0].Payout != 100 || got[0].Tax.Valid || got[0].Withholding.Int64 != 10 {
		t.Errorf("first subtotal = %+v, want the Author's 100 with no tax and 10 withheld", got[0])
	}
	// 660 + 110 - 330 pays 440, of which 60 + 10 - 30 is tax; 400 * 10.21%.
	if got[1].CreatorName != "Artist" || got[1].Payout != 440 || got[1].Tax.Int64 != 40 || got[1].Withholding.Int64 != 40 {
		t.Errorf("second subtotal = %+v, want the Artist's 440 with 40 of tax and 40 withheld", got[1])
	}
}
