package locale

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

type localeIndex struct {
	Locales []struct {
		Code string `json:"code"`
	} `json:"locales"`
}

func TestResolveAcceptsStoredSupportedLocales(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		want   string
	}{
		{name: "configured value is kept", stored: "en", want: "en"},
		{name: "surrounding spaces are trimmed", stored: "  en  ", want: "en"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve(tt.stored)
			if err != nil {
				t.Fatalf("Resolve(%q): %v", tt.stored, err)
			}
			if got != tt.want {
				t.Fatalf("Resolve(%q) = %q, want %q", tt.stored, got, tt.want)
			}
		})
	}
}

// There is no locale of last resort: a stored value naming no supported locale
// is reported so the caller can fail, rather than being answered with a
// language nobody chose.
func TestResolveRejectsUnusableStoredValues(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "empty", stored: ""},
		{name: "blank", stored: "   "},
		{name: "unsupported code", stored: "fr"},
		{name: "wrong case", stored: "EN"},
		{name: "bcp47 region", stored: "ja-JP"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve(tt.stored)
			if !errors.Is(err, ErrUnresolved) {
				t.Fatalf("Resolve(%q) error = %v, want ErrUnresolved", tt.stored, err)
			}
			if got != "" {
				t.Fatalf("Resolve(%q) = %q, want empty", tt.stored, got)
			}
		})
	}
}

func TestNormalizeAcceptsSupportedLocales(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{raw: "ja", want: "ja"},
		{raw: "en", want: "en"},
		{raw: "  en\n", want: "en"},
	}

	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, err := Normalize(tt.raw)
			if err != nil {
				t.Fatalf("Normalize(%q): %v", tt.raw, err)
			}
			if got != tt.want {
				t.Fatalf("Normalize(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestNormalizeRejectsInvalidCodes(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "empty", raw: ""},
		{name: "blank", raw: "   "},
		{name: "unknown code", raw: "fr"},
		{name: "wrong case", raw: "EN"},
		{name: "bcp47 region", raw: "en-US"},
		{name: "language tag with script", raw: "ja-JP"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Normalize(tt.raw)
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("Normalize(%q) error = %v, want ErrInvalid", tt.raw, err)
			}
			if got != "" {
				t.Fatalf("Normalize(%q) = %q, want empty", tt.raw, got)
			}
		})
	}
}

// A code an operator may save has to be one a later read can resolve, or the
// setting would break the very screens that offered it.
func TestSupportedCodesRoundTripThroughNormalizeAndResolve(t *testing.T) {
	if len(Supported) == 0 {
		t.Fatal("Supported is empty")
	}
	for _, code := range Supported {
		saved, err := Normalize(code)
		if err != nil {
			t.Fatalf("Normalize(%q): %v", code, err)
		}
		got, err := Resolve(saved)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", saved, err)
		}
		if got != code {
			t.Fatalf("Resolve(Normalize(%q)) = %q, want %q", code, got, code)
		}
	}
}

func TestGeneratedLocalesMatchIndex(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "locales", "index.json"))
	if err != nil {
		t.Fatalf("read locale index: %v", err)
	}

	var index localeIndex
	if err := json.Unmarshal(raw, &index); err != nil {
		t.Fatalf("decode locale index: %v", err)
	}

	want := make([]string, 0, len(index.Locales))
	for _, locale := range index.Locales {
		want = append(want, locale.Code)
	}
	if !slices.Equal(Supported, want) {
		t.Fatalf("Supported = %q, want %q from locales/index.json", Supported, want)
	}
}
