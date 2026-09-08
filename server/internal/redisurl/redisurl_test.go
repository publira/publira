package redisurl

import "testing"

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
		if got := FromEnv(); got != "redis://redis:6379" {
			t.Fatalf("FromEnv() = %q, want the trimmed url", got)
		}
	})

	t.Run("returns nothing when redis is turned off", func(t *testing.T) {
		for _, raw := range []string{"", "disabled", "off", "false"} {
			t.Setenv(Env, raw)
			if got := FromEnv(); got != "" {
				t.Fatalf("FromEnv() with %q = %q, want an empty string", raw, got)
			}
		}
	})
}
