package buildinfo

import "testing"

func TestVersionPrefersTheStampedValue(t *testing.T) {
	original := version
	t.Cleanup(func() { version = original })

	version = "  v1.4.2  "
	if got := Version(); got != "v1.4.2" {
		t.Errorf("Version() = %q, want v1.4.2", got)
	}
}

// Nothing stamps the test binary, and `go test` builds it without VCS
// information, so the fallback chain has to end somewhere reportable.
func TestVersionFallsBackToSomethingNonEmpty(t *testing.T) {
	original := version
	t.Cleanup(func() { version = original })

	version = ""
	if got := Version(); got == "" {
		t.Errorf("Version() = %q, want a non-empty fallback such as %q", got, DevVersion)
	}
}
