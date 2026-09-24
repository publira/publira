package secretupdate

import (
	"errors"
	"testing"
)

var errKeyRequired = errors.New("key is required")

func TestResolveAnswersWhatTheSaveDoesToTheStoredSecret(t *testing.T) {
	tests := []struct {
		name        string
		mode        Mode
		replacement string
		want        Mode
	}{
		{name: "no mode stated keeps it", mode: Unspecified, want: Unchanged},
		{name: "unchanged keeps it", mode: Unchanged, replacement: "ignored", want: Unchanged},
		{name: "replace with a value", mode: Replace, replacement: "new-secret", want: Replace},
		{name: "clear drops it", mode: Clear, replacement: "ignored", want: Clear},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resolve(tt.mode, tt.replacement, errKeyRequired)
			if err != nil {
				t.Fatalf("Resolve(%d) error = %v", tt.mode, err)
			}
			if got != tt.want {
				t.Fatalf("Resolve(%d) = %d, want %d", tt.mode, got, tt.want)
			}
		})
	}
}

func TestResolveRefusesABlankReplacementWithTheCallersError(t *testing.T) {
	for _, replacement := range []string{"", "  \t "} {
		if _, err := Resolve(Replace, replacement, errKeyRequired); !errors.Is(err, errKeyRequired) {
			t.Fatalf("Resolve(replace, %q) error = %v, want the caller's error", replacement, err)
		}
	}
}

func TestResolveRefusesAnUnknownMode(t *testing.T) {
	_, err := Resolve(99, "secret", errKeyRequired)
	if !errors.Is(err, ErrInvalidMode) {
		t.Fatalf("Resolve(99) error = %v, want ErrInvalidMode", err)
	}
	if got, want := err.Error(), "invalid secret update mode: 99"; got != want {
		t.Fatalf("Resolve(99) error = %q, want %q", got, want)
	}
}

func TestKeepsHoldsForTheModesThatLeaveTheStoredSecret(t *testing.T) {
	for mode, want := range map[Mode]bool{Unspecified: true, Unchanged: true, Replace: false, Clear: false} {
		if got := mode.Keeps(); got != want {
			t.Fatalf("Mode(%d).Keeps() = %v, want %v", mode, got, want)
		}
	}
}
