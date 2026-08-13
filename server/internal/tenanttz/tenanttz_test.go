package tenanttz

import (
	"errors"
	"testing"
)

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
		{name: "configured value is kept", stored: "America/Los_Angeles", platformDefault: platformDefault("UTC"), want: "America/Los_Angeles"},
		{name: "surrounding spaces are trimmed", stored: "  Asia/Tokyo  ", platformDefault: platformDefault("UTC"), want: "Asia/Tokyo"},
		{name: "empty falls back to the platform default", stored: "", platformDefault: platformDefault("Europe/Berlin"), want: "Europe/Berlin"},
		{name: "blank falls back to the platform default", stored: "   ", platformDefault: platformDefault("Europe/Berlin"), want: "Europe/Berlin"},
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
	got := Resolve("America/Los_Angeles", func() string {
		called++
		return "UTC"
	})
	if got != "America/Los_Angeles" {
		t.Fatalf("Resolve = %q, want America/Los_Angeles", got)
	}
	// The platform settings row must stay off the read path when the tenant has
	// a usable time zone of its own.
	if called != 0 {
		t.Fatalf("platform default was consulted %d times, want 0", called)
	}
}

func TestNormalizeAcceptsIANANames(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{raw: "Asia/Tokyo", want: "Asia/Tokyo"},
		{raw: "America/Los_Angeles", want: "America/Los_Angeles"},
		{raw: "Europe/Berlin", want: "Europe/Berlin"},
		{raw: "UTC", want: "UTC"},
		{raw: "  Asia/Tokyo\n", want: "Asia/Tokyo"},
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

func TestNormalizeRejectsInvalidNames(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "empty", raw: ""},
		{name: "blank", raw: "   "},
		{name: "unknown zone", raw: "Mars/Olympus_Mons"},
		{name: "wrong case", raw: "asia/tokyo"},
		{name: "utc offset", raw: "+09:00"},
		{name: "abbreviation", raw: "JST"},
		{name: "process local zone", raw: "Local"},
		{name: "process local zone in other case", raw: "local"},
		{name: "path traversal", raw: "../../etc/passwd"},
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
