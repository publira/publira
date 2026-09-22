package redisurl

import (
	"strings"
	"testing"
)

func TestEnabled(t *testing.T) {
	tests := map[string]bool{
		"":                    false,
		"   ":                 false,
		"disabled":            false,
		"DISABLED":            false,
		"off":                 false,
		"false":               false,
		" off ":               false,
		"redis://redis:6379":  true,
		"rediss://host:6380":  true,
		"redis://localhost:1": true,
	}
	for raw, want := range tests {
		if got := Enabled(raw); got != want {
			t.Errorf("Enabled(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestFromEnv(t *testing.T) {
	t.Run("returns the configured url", func(t *testing.T) {
		t.Setenv(Env, "  redis://redis:6379  ")
		got, err := FromEnv()
		if err != nil || got != "redis://redis:6379" {
			t.Fatalf("FromEnv() = %q, %v, want the trimmed url", got, err)
		}
	})

	t.Run("returns nothing when redis is turned off", func(t *testing.T) {
		for _, raw := range []string{"", "disabled", "off", "false"} {
			t.Setenv(Env, raw)
			got, err := FromEnv()
			if err != nil || got != "" {
				t.Fatalf("FromEnv() with %q = %q, %v, want an empty string", raw, got, err)
			}
		}
	})

	t.Run("refuses a password over plaintext", func(t *testing.T) {
		t.Setenv(Env, "redis://:secret@redis:6379")
		got, err := FromEnv()
		if err == nil || got != "" {
			t.Fatalf("FromEnv() = %q, %v, want an error and no url", got, err)
		}
	})
}

func TestCheck(t *testing.T) {
	t.Run("refuses a password over redis://", func(t *testing.T) {
		for _, raw := range []string{
			"redis://user:secret@redis:6379",
			"redis://:secret@redis:6379",
			"REDIS://:secret@redis:6379",
		} {
			err := Check(raw)
			if err == nil {
				t.Fatalf("Check(%q) = nil, want an error", raw)
			}
			if msg := err.Error(); !strings.Contains(msg, Env) || !strings.Contains(msg, "rediss://") {
				t.Fatalf("Check(%q) = %q, want it to name %s and rediss://", raw, msg, Env)
			}
		}
	})

	t.Run("accepts a password over rediss://", func(t *testing.T) {
		for _, raw := range []string{
			"rediss://user:secret@redis:6380",
			"rediss://:secret@redis:6380",
		} {
			if err := Check(raw); err != nil {
				t.Fatalf("Check(%q) = %v, want nil", raw, err)
			}
		}
	})

	t.Run("accepts redis:// without a password", func(t *testing.T) {
		for _, raw := range []string{
			"redis://redis:6379",
			"redis://user@redis:6379",
			"redis://user:@redis:6379",
		} {
			if err := Check(raw); err != nil {
				t.Fatalf("Check(%q) = %v, want nil", raw, err)
			}
		}
	})
}
