package auth

import (
	"strings"
	"testing"
)

const testSecret = "publira-unit-test-auth-jwt-secret-32b!"

func TestNewTokenManagerFromEnv(t *testing.T) {
	t.Run("returns a manager for a configured secret", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", testSecret)

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != testSecret {
			t.Errorf("secret = %q, want %q", manager.secret, testSecret)
		}
	})

	t.Run("trims surrounding whitespace", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "  "+testSecret+"\n")

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != testSecret {
			t.Errorf("secret = %q, want %q", manager.secret, testSecret)
		}
	})

	// The three cases below used to yield a signing key committed to this
	// repository, which let anyone forge an access token.
	t.Run("fails when the variable is unset", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "")

		if _, err := NewTokenManagerFromEnv(); err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
	})

	t.Run("fails when the value is only whitespace", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", "   ")

		if _, err := NewTokenManagerFromEnv(); err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
	})

	t.Run("fails when the value is shorter than the minimum", func(t *testing.T) {
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", strings.Repeat("a", MinJWTSecretBytes-1))

		_, err := NewTokenManagerFromEnv()
		if err == nil {
			t.Fatal("NewTokenManagerFromEnv() error = nil, want an error")
		}
		if !strings.Contains(err.Error(), "at least 32 bytes") {
			t.Errorf("error = %q, want it to name the minimum length", err)
		}
	})

	t.Run("measures the length in bytes, not runes", func(t *testing.T) {
		// 12 runes, 36 UTF-8 bytes.
		const multibyte = "あいうえおかきくけこさし"
		t.Setenv("PUBLIRA_AUTH_JWT_SECRET", multibyte)

		manager, err := NewTokenManagerFromEnv()
		if err != nil {
			t.Fatalf("NewTokenManagerFromEnv() error = %v", err)
		}
		if string(manager.secret) != multibyte {
			t.Errorf("secret = %q, want %q", manager.secret, multibyte)
		}
	})
}
