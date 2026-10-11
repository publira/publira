package platformconfig

import (
	"errors"
	"testing"

	"github.com/publira/publira/server/internal/fielderr"
)

func TestValidateReadsTheDefaultCurrencyAsAnISOCode(t *testing.T) {
	for _, tc := range []struct {
		name  string
		given string
		want  string
	}{
		{name: "blank keeps the stored one", given: "  ", want: ""},
		{name: "lower case", given: "eur", want: "EUR"},
		{name: "surrounding space", given: " JPY ", want: "JPY"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := SaveParams{DefaultTimezone: "UTC", DefaultLocale: "en", DefaultCurrency: tc.given}.Validate()
			if err != nil {
				t.Fatalf("Validate(%q) error = %v", tc.given, err)
			}
			if got.DefaultCurrency != tc.want {
				t.Fatalf("Validate(%q) currency = %q, want %q", tc.given, got.DefaultCurrency, tc.want)
			}
		})
	}
}

// Three letters that name no currency are refused, not only a value of
// another length: a mistyped code would otherwise be saved, and a tenant that
// sells in it would lock it in place.
func TestValidateRefusesACodeNoCurrencyHas(t *testing.T) {
	for _, given := range []string{"ABC", "USX", "EURO", "US", "U$D"} {
		t.Run(given, func(t *testing.T) {
			_, err := SaveParams{DefaultTimezone: "UTC", DefaultLocale: "en", DefaultCurrency: given}.Validate()
			var invalid *fielderr.Invalid
			if !errors.As(err, &invalid) || invalid.Field != FieldDefaultCurrency {
				t.Fatalf("Validate(%q) error = %v, want an invalid %s", given, err, FieldDefaultCurrency)
			}
		})
	}
}
