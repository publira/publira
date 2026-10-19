package publicapi

import (
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func remainderRows(prices ...int32) []dbmodels.ListSeriesRemainderEpisodesRow {
	rows := make([]dbmodels.ListSeriesRemainderEpisodesRow, 0, len(prices))
	for i, price := range prices {
		rows = append(rows, dbmodels.ListSeriesRemainderEpisodesRow{ID: uuid.New(), Title: fmt.Sprintf("Episode %d", i+1), Price: price})
	}
	return rows
}

// The discount is spread over the episodes in proportion to their prices, and
// the parts always add up to the price charged, however the rounding falls.
func TestNewSeriesRemainderSaleSpreadsTheDiscountExactly(t *testing.T) {
	for _, testCase := range []struct {
		name            string
		prices          []int32
		discountPercent int32
		wantPrice       int32
		wantParts       []int32
	}{
		{name: "no discount", prices: []int32{300, 200}, wantPrice: 500, wantParts: []int32{300, 200}},
		{name: "an even discount", prices: []int32{300, 200}, discountPercent: 10, wantPrice: 450, wantParts: []int32{270, 180}},
		{name: "a price rounded down", prices: []int32{99, 99, 99}, discountPercent: 15, wantPrice: 252, wantParts: []int32{84, 84, 84}},
		{name: "parts rounded to add up", prices: []int32{100, 100, 100}, discountPercent: 33, wantPrice: 201, wantParts: []int32{67, 67, 67}},
		{name: "uneven parts", prices: []int32{1, 1, 1}, discountPercent: 50, wantPrice: 1, wantParts: []int32{0, 0, 1}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			sale, err := newSeriesRemainderSale(remainderRows(testCase.prices...), testCase.discountPercent)
			if err != nil {
				t.Fatalf("newSeriesRemainderSale: %v", err)
			}
			if sale.price != testCase.wantPrice || fmt.Sprint(sale.discountedPrices) != fmt.Sprint(testCase.wantParts) {
				t.Fatalf("sale = %d as %v, want %d as %v", sale.price, sale.discountedPrices, testCase.wantPrice, testCase.wantParts)
			}
			total := int32(0)
			for _, part := range sale.discountedPrices {
				total += part
			}
			if total != sale.price {
				t.Fatalf("parts add up to %d, want %d", total, sale.price)
			}
		})
	}
}

// Episodes the reader holds are left out, and every other reason the rest is
// no sale is told apart.
func TestNewSeriesRemainderSaleRefusesWhatItCannotSell(t *testing.T) {
	held := remainderRows(300, 200)
	held[0].Held = true
	sale, err := newSeriesRemainderSale(held, 0)
	if err != nil || len(sale.episodes) != 1 || sale.price != 200 {
		t.Fatalf("sale of one held episode and one not = %+v, %v; want the other at 200", sale, err)
	}

	allHeld := remainderRows(300)
	allHeld[0].Held = true
	credited := remainderRows(300)
	credited[0].Credited = true
	tooMany := remainderRows(make([]int32, maxSeriesRemainderEpisodes+1)...)
	for i := range tooMany {
		tooMany[i].Price = 100
	}
	tooDear := remainderRows(2_000_000_000, 2_000_000_000)
	for _, testCase := range []struct {
		name            string
		rows            []dbmodels.ListSeriesRemainderEpisodesRow
		discountPercent int32
		want            error
	}{
		{name: "nothing priced", want: errNothingToSell},
		{name: "everything held", rows: allHeld, want: errEverythingHeld},
		{name: "a credited reader", rows: credited, want: errReaderCredited},
		{name: "more than one checkout lists", rows: tooMany, want: errTooManyToSell},
		{name: "more than one checkout charges", rows: tooDear, want: errPriceOutOfRange},
		{name: "a price discounted down to nothing", rows: remainderRows(50), discountPercent: 99, want: errDiscountedAway},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := newSeriesRemainderSale(testCase.rows, testCase.discountPercent)
			if !errors.Is(err, testCase.want) || !errors.Is(err, errNoSeriesRemainderSale) {
				t.Fatalf("error = %v, want %v", err, testCase.want)
			}
		})
	}
}
