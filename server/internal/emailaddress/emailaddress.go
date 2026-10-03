// Package emailaddress decides when two email addresses reach one inbox.
package emailaddress

import "strings"

// Canonical answers the form in which two addresses that reach one inbox
// compare equal: address lowercased, with the sub-address tag, the + and
// whatever follows it in the local part, dropped. john+news@Example.com and
// john@example.com are both john@example.com.
//
// The form decides comparisons and nothing else: the address a reader types is
// still the one stored and mailed. Provider-specific rules, such as Gmail
// ignoring dots, are not applied; the tag is the one convention shared across
// providers.
//
// The local part is everything before the last @, since a quoted local part
// may hold an @ of its own and mail.ParseAddress accepts one. A string with no
// @ has no local part and is only lowercased.
//
// The database's canonical_email function is the same rule for the lookups
// made in SQL, and TestCanonicalEmailMatchesTheServer holds the two together.
func Canonical(address string) string {
	lowered := strings.ToLower(address)
	at := strings.LastIndexByte(lowered, '@')
	if at < 0 {
		return lowered
	}
	mailbox, _, _ := strings.Cut(lowered[:at], "+")
	return mailbox + lowered[at:]
}
