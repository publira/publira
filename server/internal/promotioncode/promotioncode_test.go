package promotioncode

import (
	"database/sql"
	"testing"
	"time"
)

func TestDiscountRoundsTheDiscountDownAndNeverGoesBelowZero(t *testing.T) {
	for _, tc := range []struct {
		name           string
		kind           string
		value, price   int32
		wantDiscount   int32
		wantDiscounted int32
	}{
		{name: "a percentage", kind: DiscountPercent, value: 20, price: 300, wantDiscount: 60, wantDiscounted: 240},
		{name: "a percentage rounded down", kind: DiscountPercent, value: 15, price: 199, wantDiscount: 29, wantDiscounted: 170},
		{name: "a percentage of a price too small to take anything off", kind: DiscountPercent, value: 10, price: 9, wantDiscount: 0, wantDiscounted: 9},
		{name: "the whole price", kind: DiscountPercent, value: 100, price: 300, wantDiscount: 300, wantDiscounted: 0},
		{name: "an amount", kind: DiscountAmount, value: 100, price: 300, wantDiscount: 100, wantDiscounted: 200},
		{name: "an amount above the price", kind: DiscountAmount, value: 500, price: 300, wantDiscount: 300, wantDiscounted: 0},
		{name: "a free price", kind: DiscountAmount, value: 100, price: 0, wantDiscount: 0, wantDiscounted: 0},
		{name: "a large price", kind: DiscountPercent, value: 99, price: 2_000_000_000, wantDiscount: 1_980_000_000, wantDiscounted: 20_000_000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			discount, discounted := Discount(tc.kind, tc.value, tc.price)
			if discount != tc.wantDiscount || discounted != tc.wantDiscounted {
				t.Fatalf("Discount(%q, %d, %d) = %d, %d; want %d, %d", tc.kind, tc.value, tc.price, discount, discounted, tc.wantDiscount, tc.wantDiscounted)
			}
		})
	}
}

func TestValidCodeAdmitsLettersAndDigitsUpToTheLimit(t *testing.T) {
	for code, want := range map[string]bool{
		"SPRING2026":                        true,
		"a":                                 true,
		"abcdefghijklmnopqrstuvwxyz012345":  true,
		"abcdefghijklmnopqrstuvwxyz0123456": false,
		"":                                  false,
		"SPRING-2026":                       false,
		"春":                                 false,
		" SPRING":                           false,
	} {
		if got := ValidCode(code); got != want {
			t.Errorf("ValidCode(%q) = %v, want %v", code, got, want)
		}
	}
}

func TestCheckRefusesInTheOrderAReaderWantsToHear(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) sql.NullTime { return sql.NullTime{Time: now.Add(d), Valid: true} }
	limit := func(n int32) sql.NullInt32 { return sql.NullInt32{Int32: n, Valid: true} }
	for _, tc := range []struct {
		name  string
		state State
		want  Refusal
	}{
		{name: "an open code", state: State{Applies: true}, want: Applicable},
		{name: "a paused code", state: State{Applies: true, PausedAt: at(-time.Hour)}, want: Invalid},
		{name: "a code not started", state: State{Applies: true, StartsAt: at(time.Minute)}, want: Invalid},
		{name: "a code started this instant", state: State{Applies: true, StartsAt: at(0)}, want: Applicable},
		{name: "a code ended this instant", state: State{Applies: true, EndsAt: at(0)}, want: Expired},
		{name: "a code ending later", state: State{Applies: true, EndsAt: at(time.Minute)}, want: Applicable},
		{name: "an ended code for another sale", state: State{EndsAt: at(-time.Minute)}, want: Expired},
		{name: "a code for another sale", state: State{}, want: NotApplicable},
		{name: "an exhausted code for another sale", state: State{MaxRedemptions: limit(1), RedemptionCount: 1}, want: NotApplicable},
		{name: "an exhausted code", state: State{Applies: true, MaxRedemptions: limit(2), RedemptionCount: 2}, want: Exhausted},
		{name: "a code redeemed below its limit", state: State{Applies: true, MaxRedemptions: limit(2), RedemptionCount: 1}, want: Applicable},
		{name: "a code the reader redeemed", state: State{Applies: true, MaxRedemptionsPerReader: limit(1), ReaderRedemptionCount: 1}, want: AlreadyRedeemed},
		{name: "an exhausted code the reader redeemed", state: State{Applies: true, MaxRedemptions: limit(1), RedemptionCount: 1, MaxRedemptionsPerReader: limit(1), ReaderRedemptionCount: 1}, want: Exhausted},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Check(tc.state, now); got != tc.want {
				t.Fatalf("Check = %v, want %v", got, tc.want)
			}
		})
	}
}
