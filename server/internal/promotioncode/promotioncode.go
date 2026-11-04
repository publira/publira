// Package promotioncode is what a tenant's promotion code means to a sale:
// the discount it takes off a price, and the rules that decide whether it may
// be applied now. The handlers read a code from promotion_codes and ask this
// package what to do with it, so the storefront's checkout, the app's store
// purchase, and the quote a reader is shown before either agree.
package promotioncode

import (
	"database/sql"
	"errors"
	"regexp"
	"time"
)

// The kinds of discount promotion_codes.discount_kind stores.
const (
	DiscountPercent = "percent"
	DiscountAmount  = "amount"
)

// The kinds of target promotion_codes.target_kind stores.
const (
	TargetCatalog = "catalog"
	TargetLabel   = "label"
	TargetSeries  = "series"
	TargetVolume  = "volume"
	TargetEpisode = "episode"
)

// MaxCodeLength is the longest code promotion_codes_code_check admits.
const MaxCodeLength = 32

var codePattern = regexp.MustCompile(`^[A-Za-z0-9]{1,32}$`)

// ValidCode reports whether code is one promotion_codes can hold: 1 to
// MaxCodeLength ASCII letters and digits.
func ValidCode(code string) bool {
	return codePattern.MatchString(code)
}

// Discount answers what a code with the discount kind and value takes off
// price, and what price comes to after it: a percentage of the price rounded
// down, or the amount, never taking off more than the price. It is the same
// arithmetic as the SQL function promotion_code_discounted_price, which the
// store products are listed with, so a code applied here asks the store for
// a product the console listed.
func Discount(kind string, value, price int32) (discount, discounted int32) {
	if price <= 0 || value <= 0 {
		return 0, max(price, 0)
	}
	switch kind {
	case DiscountPercent:
		discount = int32(int64(price) * int64(min(value, 100)) / 100)
	case DiscountAmount:
		discount = min(value, price)
	}
	return discount, price - discount
}

// Refusal is why a code cannot be applied, each one an ErrorInfo reason the
// public API answers with.
type Refusal int

const (
	// Applicable is no refusal.
	Applicable Refusal = iota
	// Invalid is a code that does not exist, is deleted or paused, or whose
	// window has not opened yet. A reader learns nothing more of a code they
	// cannot use yet than of one that does not exist.
	Invalid
	// Expired is a code whose window has closed.
	Expired
	// NotApplicable is a code that does not apply to what is being bought.
	NotApplicable
	// Exhausted is a code redeemed as often as it may be in all.
	Exhausted
	// AlreadyRedeemed is a code the reader has redeemed as often as one reader
	// may.
	AlreadyRedeemed
)

// ErrRefused is wrapped by the error a refusal is reported with.
var ErrRefused = errors.New("the promotion code cannot be applied")

// State is what a check of a code reads of it: when it works, how often it may
// be redeemed and has been, whether it is paused, and whether it applies to
// what is being bought.
type State struct {
	StartsAt                sql.NullTime
	EndsAt                  sql.NullTime
	PausedAt                sql.NullTime
	MaxRedemptions          sql.NullInt32
	MaxRedemptionsPerReader sql.NullInt32
	RedemptionCount         int32
	ReaderRedemptionCount   int32
	Applies                 bool
}

// Check answers why a code in state cannot be applied at now, or Applicable.
// The refusals are checked in the order a reader would want to hear them: a
// code they cannot use at all before one that does not fit the sale, and the
// sale before the limits.
func Check(state State, now time.Time) Refusal {
	switch {
	case state.PausedAt.Valid:
		return Invalid
	case state.StartsAt.Valid && now.Before(state.StartsAt.Time):
		return Invalid
	case state.EndsAt.Valid && !now.Before(state.EndsAt.Time):
		return Expired
	case !state.Applies:
		return NotApplicable
	case state.MaxRedemptions.Valid && state.RedemptionCount >= state.MaxRedemptions.Int32:
		return Exhausted
	case state.MaxRedemptionsPerReader.Valid && state.ReaderRedemptionCount >= state.MaxRedemptionsPerReader.Int32:
		return AlreadyRedeemed
	}
	return Applicable
}
