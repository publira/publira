package locale

import (
	"testing"
	"time"
)

// The same instant Intl.DateTimeFormat is checked against in
// packages/utils/src/format-date-time.test.ts: late evening in Tokyo, the
// morning of the same day in Los Angeles.
const displayInstant = "2030-01-15T12:00:00Z"

func TestFormatDateTimeWordsAnInstantPerLocale(t *testing.T) {
	at, err := time.Parse(time.RFC3339, displayInstant)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	for _, testCase := range []struct {
		code     string
		timeZone string
		want     string
	}{
		{code: "ja", timeZone: "Asia/Tokyo", want: "2030/01/15 21:00"},
		{code: "en", timeZone: "Asia/Tokyo", want: "Jan 15, 2030, 9:00\u202fPM"},
		{code: "ko", timeZone: "Asia/Tokyo", want: "2030. 1. 15. 오후 9:00"},
		{code: "zh-Hans", timeZone: "Asia/Tokyo", want: "2030年1月15日 21:00"},
		{code: "zh-Hant", timeZone: "Asia/Tokyo", want: "2030年1月15日 晚上9:00"},
		{code: "ja", timeZone: "America/Los_Angeles", want: "2030/01/15 4:00"},
		{code: "en", timeZone: "America/Los_Angeles", want: "Jan 15, 2030, 4:00\u202fAM"},
		{code: "zh-Hant", timeZone: "America/Los_Angeles", want: "2030年1月15日 凌晨4:00"},
	} {
		t.Run(testCase.code+" in "+testCase.timeZone, func(t *testing.T) {
			got, err := FormatDateTime(at, testCase.code, testCase.timeZone)
			if err != nil {
				t.Fatalf("FormatDateTime: %v", err)
			}
			if got != testCase.want {
				t.Errorf("FormatDateTime = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestFormatDateTimeRefusesWhatItCannotResolve(t *testing.T) {
	at := time.Now()

	if _, err := FormatDateTime(at, "de", "Asia/Tokyo"); err == nil {
		t.Error("FormatDateTime accepted a locale no catalog carries")
	}
	if _, err := FormatDateTime(at, "ja", "Mars/Olympus_Mons"); err == nil {
		t.Error("FormatDateTime accepted a time zone that does not exist")
	}
}
