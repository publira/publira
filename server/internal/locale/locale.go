// Package locale resolves and validates the UI locale a tenant uses as its
// default language (tenants.default_locale).
package locale

import (
	"errors"
	"slices"
	"strings"
)

// Default mirrors the tenants.default_locale and platform_config.default_locale
// column defaults in db/migrations. The platform default row is the source of
// truth for new tenants, so this constant is only the last resort for when that
// row cannot be read.
const Default = "ja"

// Supported is the first-cut UI locale list and must match LOCALES in
// packages/utils/src/i18n.ts. Adding a locale means updating both.
var Supported = []string{"ja", "en"}

// ErrInvalid is returned when a value is not a supported UI locale code.
var ErrInvalid = errors.New("default_locale must be a supported locale")

// Resolve returns the tenant default locale to expose through the API. Stored
// values are NOT NULL with a non-blank CHECK, so the fallback only guards rows
// written before those constraints existed. platformDefault yields the
// platform-wide default and is called only when the stored value is unusable,
// which keeps the platform settings row off the hot read path; a nil
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
