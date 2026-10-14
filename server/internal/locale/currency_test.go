package locale

import (
	"fmt"
	"testing"
)

// The first five are the amounts packages/utils/src/format-number.test.ts
// checks formatPrice against, which must read the same here; the rest cover a
// symbol each locale writes differently and a minor unit of three digits.
func TestFormatPriceWritesAnAmountPerLocale(t *testing.T) {
	for _, testCase := range []struct {
		amount   int64
		currency string
		code     string
		want     string
	}{
		{amount: 1500, currency: "JPY", code: "en", want: "¥1,500"},
		{amount: 499, currency: "USD", code: "en", want: "$4.99"},
		{amount: 500, currency: "EUR", code: "en", want: "€5.00"},
		{amount: 1234567, currency: "JPY", code: "ja", want: "￥1,234,567"},
		{amount: 123456, currency: "USD", code: "ja", want: "$1,234.56"},
		{amount: 500, currency: "JPY", code: "ko", want: "JP¥500"},
		{amount: 5, currency: "USD", code: "en", want: "$0.05"},
		{amount: 0, currency: "USD", code: "zh-Hans", want: "US$0.00"},
		{amount: 1500, currency: "BHD", code: "en", want: "BHD 1.500"},
		{amount: 9900, currency: "TWD", code: "zh-Hant", want: "$99.00"},
	} {
		t.Run(fmt.Sprintf("%d %s in %s", testCase.amount, testCase.currency, testCase.code), func(t *testing.T) {
			got, err := FormatPrice(testCase.amount, testCase.currency, testCase.code)
			if err != nil {
				t.Fatalf("FormatPrice: %v", err)
			}
			if got != testCase.want {
				t.Errorf("FormatPrice(%d, %s, %s) = %q, want %q", testCase.amount, testCase.currency, testCase.code, got, testCase.want)
			}
		})
	}
}

func TestFormatPriceRefusesWhatItCannotWrite(t *testing.T) {
	if _, err := FormatPrice(500, "JPY", "de"); err == nil {
		t.Error("FormatPrice accepted a locale no catalog carries")
	}
	if _, err := FormatPrice(500, "XYZ", "en"); err == nil {
		t.Error("FormatPrice accepted a currency no table carries")
	}
	if _, err := FormatPrice(-500, "JPY", "en"); err == nil {
		t.Error("FormatPrice accepted a negative amount")
	}
}
