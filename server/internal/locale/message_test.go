package locale

import (
	"errors"
	"testing"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

func TestMessageFillsInTheVariablesItReads(t *testing.T) {
	got, err := Message("en", "email.layout.footer", map[string]any{"brand": "Aoto Press"})
	if err != nil {
		t.Fatalf("Message: %v", err)
	}
	if want := "This email was sent by Aoto Press."; got != want {
		t.Errorf("Message = %q, want %q", got, want)
	}
}

func TestMessageAnswersInTheLocaleItIsGiven(t *testing.T) {
	for _, code := range Supported {
		got, err := Message(code, "email.reader_password_reset.subject", map[string]any{"tenant_name": "Aoto Press"})
		if err != nil {
			t.Fatalf("Message(%s): %v", code, err)
		}
		if got == "" {
			t.Errorf("Message(%s) is empty", code)
		}
	}
}

func TestMessageRefusesRatherThanWordingAMailWrongly(t *testing.T) {
	if _, err := Message("de", "email.layout.brand", nil); !errors.Is(err, ErrUnresolved) {
		t.Errorf("err = %v, want %v", err, ErrUnresolved)
	}
	if _, err := Message("en", "email.layout.wordmark", nil); !errors.Is(err, ErrUnknownMessage) {
		t.Errorf("err = %v, want %v", err, ErrUnknownMessage)
	}
	if _, err := Message("en", "email.layout.footer", nil); !errors.Is(err, ErrMissingValue) {
		t.Errorf("err = %v, want %v", err, ErrMissingValue)
	}
	if _, err := format(localegen.Intl["en"], "{$count :integer} episodes", map[string]any{"count": "many"}); !errors.Is(err, ErrFormat) {
		t.Errorf("err = %v, want %v", err, ErrFormat)
	}
}

// A count the way the catalog writes one, formatted the way Message formats a
// catalog entry.
const episodeCount = `.input {$count :integer}
.match $count
0   {{No new episodes}}
one {{{$count} new episode}}
*   {{{$count} new episodes}}`

func TestFormatSelectsByTheLocalesPluralRules(t *testing.T) {
	for _, testCase := range []struct {
		code  string
		count any
		want  string
	}{
		{code: "en", count: 0, want: "No new episodes"},
		{code: "en", count: 1, want: "1 new episode"},
		{code: "en", count: 1234, want: "1,234 new episodes"},
		{code: "ja", count: 0, want: "No new episodes"},
		// Japanese has no "one" category, so 1 takes the catch-all variant.
		{code: "ja", count: 1, want: "1 new episodes"},
		{code: "ja", count: 1234, want: "1,234 new episodes"},
	} {
		got, err := format(localegen.Intl[testCase.code], episodeCount, map[string]any{"count": testCase.count})
		if err != nil {
			t.Fatalf("format(%s, %v): %v", testCase.code, testCase.count, err)
		}
		if got != testCase.want {
			t.Errorf("format(%s, %v) = %q, want %q", testCase.code, testCase.count, got, testCase.want)
		}
	}
}
