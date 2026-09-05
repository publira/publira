package commentretention

import "testing"

func TestWithdrawnDays(t *testing.T) {
	t.Run("unset is the default window", func(t *testing.T) {
		t.Setenv(WithdrawnDaysEnv, "")
		if got, err := WithdrawnDays(); err != nil || got != DefaultWithdrawnDays {
			t.Fatalf("WithdrawnDays() = (%d, %v), want (%d, nil)", got, err, DefaultWithdrawnDays)
		}
	})

	t.Run("a configured window overrides it", func(t *testing.T) {
		t.Setenv(WithdrawnDaysEnv, " 30 ")
		if got, err := WithdrawnDays(); err != nil || got != 30 {
			t.Fatalf("WithdrawnDays() = (%d, %v), want (30, nil)", got, err)
		}
	})

	t.Run("a window of zero or less is rejected", func(t *testing.T) {
		// A cutoff at or after now would take every withdrawn comment with it,
		// which is never what a retention setting means.
		for _, raw := range []string{"0", "-1"} {
			t.Setenv(WithdrawnDaysEnv, raw)
			if _, err := WithdrawnDays(); err == nil {
				t.Fatalf("WithdrawnDays() with %q error = nil, want an error", raw)
			}
		}
	})

	t.Run("a non-numeric window is rejected", func(t *testing.T) {
		t.Setenv(WithdrawnDaysEnv, "six months")
		if _, err := WithdrawnDays(); err == nil {
			t.Fatal("WithdrawnDays() with a non-numeric value error = nil, want an error")
		}
	})
}
