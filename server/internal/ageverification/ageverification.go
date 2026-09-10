// Package ageverification resolves the rule a tenant applies to its age-rated
// series (tenant_config.age_verification) and answers what that rule asks of
// one reader.
//
// The rule and the ratings it acts on are stored strings, so the vocabulary of
// both lives here: a rating means nothing to this rule on its own, and the age
// it demands is the one thing every caller — the storefront's series page, the
// episode body, the console that saves the setting — has to agree on.
package ageverification

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
)

// The stored rules, matching the CHECK constraint on
// tenant_config.age_verification.
const (
	// None asks for no proof at all: this is the column's own default, and the
	// answer for a tenant with no config row.
	None = "none"
	// R18 demands a proven age for `r18` series alone.
	R18 = "r18"
	// R15AndR18 demands one for `r15` series as well.
	R15AndR18 = "r15_and_r18"
)

// The stored series ratings, matching the CHECK constraint on
// series_listings.age_rating.
const (
	RatingAll = "all"
	RatingR15 = "r15"
	RatingR18 = "r18"
)

// The ages the two rated ratings name. They are the rating's own number, so a
// rating and the age it demands cannot drift apart.
const (
	minimumAgeR15 = 15
	minimumAgeR18 = 18
)

// Supported lists every rule this build can act on, in the order a chooser
// offers them: off, then the two ways of being on.
var Supported = []string{None, R18, R15AndR18}

// ErrInvalid is returned when an incoming value names no supported rule. It
// belongs to a request the caller can correct.
var ErrInvalid = errors.New("age_verification must be a supported rule")

// ErrUnresolved is returned when a stored value names no supported rule, or a
// stored rating names none. There is no stand-in: reading an unknown rule as
// None opens rated work to everyone, and reading it as R15AndR18 closes a
// catalogue nobody asked to close.
var ErrUnresolved = errors.New("stored age verification value names nothing this build knows")

// ErrInvalidBirthDate is returned when an incoming birth date is not a
// calendar date this build will store.
var ErrInvalidBirthDate = errors.New("birth_date must be a YYYY-MM-DD calendar date in the past")

// birthDateLayout is the one shape a birth date is accepted and answered in.
const birthDateLayout = "2006-01-02"

// oldestPlausibleAge bounds how far back a birth date may reach. A reader
// older than this has mistyped a year, and storing it would leave an account
// carrying a date its owner cannot correct — the date is written once.
const oldestPlausibleAge = 130

// Resolve returns the stored rule to act on and to expose through the API. The
// column is NOT NULL with a CHECK listing the three rules, so a value this
// rejects is a data fault: a row written around the API, or one naming a rule
// this build does not know.
func Resolve(stored string) (string, error) {
	trimmed, ok := supported(stored)
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrUnresolved, stored)
	}
	return trimmed, nil
}

// Normalize validates an incoming rule and returns the value to store. Blank
// input is rejected rather than read as "off": asking for no proof is None,
// which a tenant chooses deliberately.
func Normalize(raw string) (string, error) {
	trimmed, ok := supported(raw)
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrInvalid, raw)
	}
	return trimmed, nil
}

// RequiredMinimumAge answers how many years old the rule makes a reader prove
// they are before a series with this rating opens to them. 0 means the rule
// asks nothing of that rating, which is every rating under None and the
// unrated ones under either of the others.
func RequiredMinimumAge(rule, rating string) (int, error) {
	resolvedRule, err := Resolve(rule)
	if err != nil {
		return 0, err
	}
	resolvedRating := strings.TrimSpace(rating)
	switch resolvedRating {
	case RatingAll, RatingR15, RatingR18:
	default:
		return 0, fmt.Errorf("%w: %q", ErrUnresolved, rating)
	}
	switch {
	case resolvedRule == R18 && resolvedRating == RatingR18:
		return minimumAgeR18, nil
	case resolvedRule == R15AndR18 && resolvedRating == RatingR18:
		return minimumAgeR18, nil
	case resolvedRule == R15AndR18 && resolvedRating == RatingR15:
		return minimumAgeR15, nil
	default:
		return 0, nil
	}
}

// Today is the tenant's own calendar day at the instant now, as midnight UTC
// of that civil date. An age is counted against the day the tenant is living
// through, so a reader's birthday arrives when the tenant's calendar says it
// does rather than when UTC does.
func Today(now time.Time, location *time.Location) time.Time {
	return civilDate(now.In(location))
}

// AgeOn reports how many completed years old someone born on birthDate is on
// the calendar day day. Both are read as calendar dates; whatever clock time
// and zone they carry is dropped first, so a birth date read out of a `date`
// column and a day resolved in the tenant's zone compare as the dates they
// are.
func AgeOn(birthDate, day time.Time) int {
	born := civilDate(birthDate)
	on := civilDate(day)
	years := on.Year() - born.Year()
	if on.Month() < born.Month() || (on.Month() == born.Month() && on.Day() < born.Day()) {
		years--
	}
	return years
}

// ParseBirthDate reads the date a reader gave and returns the calendar date to
// store. today bounds it: a date the tenant has not reached yet is a typo
// rather than a birth date, and so is one from before anyone alive was born.
func ParseBirthDate(raw string, today time.Time) (time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	// time.Parse accepts a single-digit month and day, which would let the same
	// date be written two ways and read back in only one of them.
	if len(trimmed) != len(birthDateLayout) {
		return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidBirthDate, raw)
	}
	parsed, err := time.Parse(birthDateLayout, trimmed)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidBirthDate, raw)
	}
	on := civilDate(today)
	if parsed.After(on) {
		return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidBirthDate, raw)
	}
	if AgeOn(parsed, on) > oldestPlausibleAge {
		return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidBirthDate, raw)
	}
	return parsed, nil
}

// FormatBirthDate writes a stored birth date in the one shape the API speaks.
func FormatBirthDate(birthDate time.Time) string {
	return civilDate(birthDate).Format(birthDateLayout)
}

func supported(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !slices.Contains(Supported, trimmed) {
		return "", false
	}
	return trimmed, true
}

func civilDate(at time.Time) time.Time {
	year, month, day := at.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
