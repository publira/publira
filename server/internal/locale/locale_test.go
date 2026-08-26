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

func TestResolve(t *testing.T) {
	platformDefault := func(value string) func() string {
		return func() string { return value }
	}

	tests := []struct {
		name            string
		stored          string
		platformDefault func() string
		want            string
	}{
		{name: "configured value is kept", stored: "en", platformDefault: platformDefault("ja"), want: "en"},
		{name: "surrounding spaces are trimmed", stored: "  en  ", platformDefault: platformDefault("ja"), want: "en"},
		{name: "empty falls back to the platform default", stored: "", platformDefault: platformDefault("en"), want: "en"},
		{name: "blank falls back to the platform default", stored: "   ", platformDefault: platformDefault("en"), want: "en"},
		{name: "blank platform default falls back to Default", stored: "", platformDefault: platformDefault("  "), want: Default},
		{name: "missing platform default falls back to Default", stored: "", platformDefault: nil, want: Default},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Resolve(tt.stored, tt.platformDefault); got != tt.want {
				t.Fatalf("Resolve(%q) = %q, want %q", tt.stored, got, tt.want)
			}
		})
	}
}

func TestResolveSkipsPlatformDefaultForConfiguredValue(t *testing.T) {
	called := 0
	got := Resolve("en", func() string {
		called++
		return "ja"
	})
	if got != "en" {
		t.Fatalf("Resolve = %q, want en", got)
	}
	// The platform settings row must stay off the read path when the tenant has
	// a usable locale of its own.
	if called != 0 {
		t.Fatalf("platform default was consulted %d times, want 0", called)
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

func TestDefaultIsValid(t *testing.T) {
	got, err := Normalize(Default)
	if err != nil {
		t.Fatalf("Normalize(Default): %v", err)
	}
	if got != Default {
		t.Fatalf("Normalize(Default) = %q, want %q", got, Default)
	}
}

func TestSupportedMatchesNormalize(t *testing.T) {
	if len(Supported) == 0 {
		t.Fatal("Supported is empty")
	}
	for _, code := range Supported {
		got, err := Normalize(code)
		if err != nil {
			t.Fatalf("Normalize(%q): %v", code, err)
		}
		if got != code {
			t.Fatalf("Normalize(%q) = %q, want %q", code, got, code)
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
