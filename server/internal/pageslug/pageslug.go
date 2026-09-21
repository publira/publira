// Package pageslug holds the paths of the public site a published page may not
// take over.
//
// The site serves a published page in place of its own screen at the same
// path, so a page at one of these would stand between readers and a screen
// they cannot use the site without: signing in and up, the links a mail
// carries, and the account settings.
package pageslug

import "strings"

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

// ReservedFirstSegment returns the first segment of a slug in storage form
// ("/settings/help" → "settings") and whether the public site keeps it.
func ReservedFirstSegment(slug string) (string, bool) {
	first, _, _ := strings.Cut(strings.TrimPrefix(slug, "/"), "/")
	_, reserved := reservedFirstSegments[first]
	return first, reserved
}
