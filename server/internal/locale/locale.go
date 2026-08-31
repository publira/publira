// Package locale resolves and validates the UI locale a tenant uses as its
// default language (tenants.default_locale).
package locale

import (
	"errors"
	"slices"
	"strings"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

// Default is the locale a read falls back to when neither the stored row nor
// the platform settings row yields one. It is not a creation default: both
// default_locale columns dropped theirs, and every write path names the locale
// it means. Removing this last read-side fallback is tracked in #1251.
const Default = "ja"

// Supported is generated from locales/index.json.
var Supported = localegen.Supported

// ErrInvalid is returned when a value is not a supported UI locale code.
var ErrInvalid = errors.New("default_locale must be a supported locale")

// Resolve returns the tenant default locale to expose through the API. Stored
// values are NOT NULL and constrained to the supported codes, so the fallback
// only guards rows written before those constraints existed. platformDefault
// yields the platform-wide default and is called only when the stored value is
// unusable, which keeps the platform settings row off the hot read path; a nil
// platformDefault, or one that yields a blank value, falls back to Default.
func Resolve(stored string, platformDefault func() string) string {
	if trimmed := strings.TrimSpace(stored); trimmed != "" {
		return trimmed
	}
	if platformDefault != nil {
		if trimmed := strings.TrimSpace(platformDefault()); trimmed != "" {
			return trimmed
		}
	}
	return Default
}

// Normalize validates an incoming locale code and returns the value to store.
// Blank input is rejected instead of falling back to the default so that
// callers cannot silently reset a configured tenant locale.
func Normalize(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !slices.Contains(Supported, trimmed) {
		return "", ErrInvalid
	}
	return trimmed, nil
}
