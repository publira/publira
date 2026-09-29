// Package locale resolves and validates the UI locale a tenant uses as its
// default language (tenants.default_locale).
package locale

import (
	"errors"
	"slices"
	"strings"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

// Supported is generated from locales/index.json.
var Supported = localegen.Supported

// ErrInvalid is returned when an incoming value is not a supported UI locale
// code. It belongs to a request the caller can correct.
var ErrInvalid = errors.New("default_locale must be a supported locale")

// ErrUnresolved is returned when a stored value names no supported UI locale.
// There is no replacement default under any name: a path that cannot resolve a
// locale reports the failure instead of picking a language for the reader.
var ErrUnresolved = errors.New("stored default_locale names no supported locale")

// Resolve returns the stored locale to render in and expose through the API.
// Both default_locale columns are NOT NULL with a non-blank CHECK, and every
// write path validates against Supported, so a value this rejects is a data
// fault rather than an unstated preference: a row written around the API, or a
// build carrying no catalog for the code it names.
func Resolve(stored string) (string, error) {
	trimmed, ok := supported(stored)
	if !ok {
		return "", ErrUnresolved
	}
	return trimmed, nil
}

// Normalize validates an incoming locale code and returns the value to store.
// Blank input is rejected instead of falling back to a default so that callers
// cannot silently reset a configured tenant locale.
func Normalize(raw string) (string, error) {
	trimmed, ok := supported(raw)
	if !ok {
		return "", ErrInvalid
	}
	return trimmed, nil
}

func supported(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !slices.Contains(Supported, trimmed) {
		return "", false
	}
	return trimmed, true
}
