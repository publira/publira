package commentmode

import (
	"errors"
	"testing"
)

func TestResolveAcceptsStoredSupportedModes(t *testing.T) {
	tests := []struct {
		name   string
		stored string
		want   string
	}{
		{name: "commenting off", stored: Disabled, want: Disabled},
		{name: "published on posting", stored: Immediate, want: Immediate},
		{name: "held for approval", stored: ApprovalRequired, want: ApprovalRequired},
		{name: "surrounding spaces are trimmed", stored: "  immediate  ", want: Immediate},
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

func TestResolveRejectsStoredValuesNamingNoMode(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "empty", stored: ""},
		{name: "whitespace only", stored: "   "},
		{name: "a mode this build does not know", stored: "moderated"},
		{name: "the proto spelling rather than the stored one", stored: "COMMENT_MODE_IMMEDIATE"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Resolve(tt.stored); !errors.Is(err, ErrUnresolved) {
				t.Fatalf("Resolve(%q) error = %v, want ErrUnresolved", tt.stored, err)
			}
		})
	}
}

func TestNormalizeAcceptsEverySupportedMode(t *testing.T) {
	for _, mode := range Supported {
		t.Run(mode, func(t *testing.T) {
			got, err := Normalize(mode)
			if err != nil {
				t.Fatalf("Normalize(%q): %v", mode, err)
			}
			if got != mode {
				t.Fatalf("Normalize(%q) = %q, want %q", mode, got, mode)
			}
		})
	}
}

// Blank input is a request that named nothing, not a request to turn commenting
// off: a caller that means off sends Disabled.
func TestNormalizeRejectsValuesNamingNoMode(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "empty", raw: ""},
		{name: "whitespace only", raw: "\t"},
		{name: "a mode this build does not know", raw: "moderated"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Normalize(tt.raw); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Normalize(%q) error = %v, want ErrInvalid", tt.raw, err)
			}
		})
	}
}
