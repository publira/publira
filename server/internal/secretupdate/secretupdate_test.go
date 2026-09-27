package secretupdate

import (
	"errors"
	"strings"
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

type reversingDecrypter struct{}

// EncryptedWithPrimary treats a value starting with "old:" as sealed with a
// retired key and one starting with "plain:" as stored in the clear.
func (reversingDecrypter) EncryptedWithPrimary(value string) bool {
	return !strings.HasPrefix(value, "old:") && !strings.HasPrefix(value, "plain:")
}

func (reversingDecrypter) DecryptString(value string) (string, error) {
	if value == "unreadable" {
		return "", errors.New("unknown key")
	}
	value = strings.TrimPrefix(strings.TrimPrefix(value, "old:"), "plain:")
	runes := []rune(value)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes), nil
}

func TestKeepIfSameKeepsOnlyARepeatedSecret(t *testing.T) {
	tests := []struct {
		name        string
		mode        Mode
		replacement string
		stored      string
		d           Decrypter
		want        Mode
	}{
		{name: "the stored secret again", mode: Replace, replacement: "secret", stored: "terces", d: reversingDecrypter{}, want: Unchanged},
		{name: "another secret", mode: Replace, replacement: "other", stored: "terces", d: reversingDecrypter{}, want: Replace},
		{name: "nothing stored", mode: Replace, replacement: "secret", d: reversingDecrypter{}, want: Replace},
		{name: "no decrypter", mode: Replace, replacement: "secret", stored: "terces", want: Replace},
		{name: "unreadable stored secret", mode: Replace, replacement: "secret", stored: "unreadable", d: reversingDecrypter{}, want: Replace},
		{name: "the same secret under a retired key", mode: Replace, replacement: "secret", stored: "old:terces", d: reversingDecrypter{}, want: Replace},
		{name: "the same secret stored in the clear", mode: Replace, replacement: "secret", stored: "plain:terces", d: reversingDecrypter{}, want: Replace},
		{name: "clear", mode: Clear, stored: "terces", d: reversingDecrypter{}, want: Clear},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := KeepIfSame(tt.mode, tt.replacement, tt.stored, tt.d); got != tt.want {
				t.Fatalf("KeepIfSame = %d, want %d", got, tt.want)
			}
		})
	}
}
