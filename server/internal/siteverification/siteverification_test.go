package siteverification

import (
	"errors"
	"strings"
	"testing"
)

func TestNormalizeCodeTrimsAndKeepsTheCase(t *testing.T) {
	for raw, want := range map[string]string{
		"":                                 "",
		" \t ":                             "",
		" AbC-123_xyz\n":                   "AbC-123_xyz",
		"0123456789ABCDEF0123456789ABCDEF": "0123456789ABCDEF0123456789ABCDEF",
		strings.Repeat("a", 128):           strings.Repeat("a", 128),
	} {
		got, err := NormalizeCode(raw)
		if err != nil || got != want {
			t.Fatalf("NormalizeCode(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
}

func TestNormalizeCodeRefusesAnythingButTheBareCode(t *testing.T) {
	for name, raw := range map[string]string{
		"a less-than sign":     "abc<def",
		"a double quote":       `abc"def`,
		"a single quote":       "abc'def",
		"an inner space":       "abc def",
		"a whole meta element": `<meta name="google-site-verification" content="AbC-123_xyz" />`,
		"a content attribute":  `content="AbC-123_xyz"`,
		"a non-ASCII letter":   "abcé",
		"a code too long":      strings.Repeat("a", 129),
	} {
		if _, err := NormalizeCode(raw); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("NormalizeCode(%s) error = %v, want ErrInvalidCode", name, err)
		}
	}
}

func TestCodesAnyOnlyWithACode(t *testing.T) {
	if (Codes{}).Any() {
		t.Fatal("Any() with no code = true, want false")
	}
	if !(Codes{Bing: "abc"}).Any() || !(Codes{Google: "abc"}).Any() {
		t.Fatal("Any() with a code = false, want true")
	}
}
