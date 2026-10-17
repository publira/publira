// Package locale resolves and validates the UI locale a tenant uses as its
// default language (tenants.default_locale), and the set of locales its site
// offers (tenants.supported_locales).
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

// ErrSupportedRequired, ErrInvalidSupported, and ErrDefaultNotSupported refuse
// an incoming set of offered locales. Each belongs to a request the caller can
// correct.
var (
	ErrSupportedRequired   = errors.New("supported_locales must not be empty")
	ErrInvalidSupported    = errors.New("supported_locales must name supported locales")
	ErrDefaultNotSupported = errors.New("supported_locales must include default_locale")
)

// ErrSupportedUnresolved is returned when a stored set of offered locales
// names a code that is not a supported UI locale, for the reason
// [ErrUnresolved] gives.
var ErrSupportedUnresolved = errors.New("stored supported_locales names an unsupported locale")

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

// NormalizeSupported validates an incoming set of offered locales against
// defaultLocale, a value [Normalize] already returned, and returns the set to
// store: deduplicated and in the order of [Supported], whatever order it
// arrived in, so every reader of the column sees the registry's order without
// sorting it again.
func NormalizeSupported(defaultLocale string, raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, ErrSupportedRequired
	}
	codes := make([]string, 0, len(raw))
	for _, code := range raw {
		trimmed, ok := supported(code)
		if !ok {
			return nil, ErrInvalidSupported
		}
		codes = append(codes, trimmed)
	}
	if !slices.Contains(codes, defaultLocale) {
		return nil, ErrDefaultNotSupported
	}
	return InRegistryOrder(codes), nil
}

// ResolveSupported returns a stored set of offered locales in the order of
// [Supported]. Like [Resolve], it reports a code naming no supported locale
// instead of leaving it out: a set quietly narrowed by a build that dropped a
// catalog would hide the fault the same way a stand-in language would.
func ResolveSupported(stored []string) ([]string, error) {
	codes := make([]string, 0, len(stored))
	for _, code := range stored {
		trimmed, ok := supported(code)
		if !ok {
			return nil, ErrSupportedUnresolved
		}
		codes = append(codes, trimmed)
	}
	if len(codes) == 0 {
		return nil, ErrSupportedUnresolved
	}
	return InRegistryOrder(codes), nil
}

// InRegistryOrder returns the codes of [Supported] that codes holds, once each
// and in the order of [Supported]. A code the registry does not name is left
// out: it is no locale a page of this build can be served in.
func InRegistryOrder(codes []string) []string {
	ordered := make([]string, 0, len(codes))
	for _, code := range Supported {
		if slices.Contains(codes, code) {
			ordered = append(ordered, code)
		}
	}
	return ordered
}

func supported(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !slices.Contains(Supported, trimmed) {
		return "", false
	}
	return trimmed, true
}
