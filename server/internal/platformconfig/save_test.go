package platformconfig

import (
	"errors"
	"strings"
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

// currentISO4217Codes is ISO 4217 List One as the maintenance agency
// publishes it, funds and precious metals included.
var currentISO4217Codes = strings.Fields(`
	AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL
	BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK
	DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD
	HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD
	KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK
	MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR
	RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL
	THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES
	VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS
	XUA XXX YER ZAR ZMW ZWG
`)

// Every current code is saved, the ones newer than golang.org/x/text's table
// among them: the Platform Console offers MRU, SLE, VES, XCG, and ZWG, so a
// refusal would turn away a currency the operator was given to choose.
func TestValidateAcceptsEveryCurrentISOCode(t *testing.T) {
	for _, code := range currentISO4217Codes {
		t.Run(code, func(t *testing.T) {
			got, err := SaveParams{DefaultTimezone: "UTC", DefaultLocale: "en", DefaultCurrency: code}.Validate()
			if err != nil {
				t.Fatalf("SaveParams.Validate(%q) error = %v", code, err)
			}
			if got.DefaultCurrency != code {
				t.Fatalf("SaveParams.Validate(%q) currency = %q, want %q", code, got.DefaultCurrency, code)
			}
			initial, err := InitialParams{DefaultLocale: "en", DefaultCurrency: strings.ToLower(code)}.Validate()
			if err != nil {
				t.Fatalf("InitialParams.Validate(%q) error = %v", strings.ToLower(code), err)
			}
			if initial.DefaultCurrency != code {
				t.Fatalf("InitialParams.Validate(%q) currency = %q, want %q", strings.ToLower(code), initial.DefaultCurrency, code)
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
