// Package pageslug holds the paths of the public site a published page may not
// take.
//
// Two kinds of path are refused. The site serves a published page in place of
// its own screen at the same path, so a page at a reserved one would stand
// between readers and a screen they cannot use the site without: signing in
// and up, the links a mail carries, and the account settings. An unreachable
// one is answered before any page is looked up — a locale prefix, the API, a
// health probe — so a page there would never be served at its own path.
package pageslug

import (
	"slices"
	"strings"

	"github.com/publira/publira/server/internal/locale"
)

var reservedFirstSegments = map[string]struct{}{
	"confirm-email":       {},
	"confirm-password":    {},
	"login":               {},
	"resend-verification": {},
	"reset-password":      {},
	"settings":            {},
	"signup":              {},
	"verify":              {},
}

var unreachableFirstSegments = map[string]struct{}{
	"api":    {},
	"livez":  {},
	"readyz": {},
}

// ReservedFirstSegment returns the first segment of a slug in storage form
// ("/settings/help" → "settings") and whether the public site keeps it.
func ReservedFirstSegment(slug string) (string, bool) {
	first := firstSegment(slug)
	_, reserved := reservedFirstSegments[first]
	return first, reserved
}

// UnreachableFirstSegment returns the first segment of a slug in storage form
// ("/ja/about" → "ja") and whether the public site answers it before looking
// at pages.
func UnreachableFirstSegment(slug string) (string, bool) {
	first := firstSegment(slug)
	_, unreachable := unreachableFirstSegments[first]
	return first, unreachable || slices.Contains(locale.Supported, first)
}

func firstSegment(slug string) string {
	first, _, _ := strings.Cut(strings.TrimPrefix(slug, "/"), "/")
	return first
}
