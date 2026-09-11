// Package catalogslug derives the slug stored alongside a genre or tag name.
//
// The slug is the identity of a name, not a second name the editor maintains:
// it is what the unique index per tenant is built on, so two genres cannot
// differ by case or spacing alone, and a tag typed a second time resolves to
// the tag that already exists rather than splitting the catalog in two.
//
// It is not the page slug of adminapi, which a console operator writes by hand as a URL
// path and which therefore only accepts ASCII path segments. A genre named
// "恋愛" has to keep an identity of its own, so letters of every script survive
// here; a URL carrying one percent-encodes it like any other path.
package catalogslug

import (
	"errors"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// ErrEmpty reports a name holding no letter or digit to build a slug from —
// punctuation alone, say. Such a name is refused rather than stored under a
// generated stand-in, which nothing could match a second use of the same name
// against.
var ErrEmpty = errors.New("name holds no letter or digit to build a slug from")

// FromName derives the slug of a genre or tag name.
//
// The name is NFKC-normalized first, so a full-width "Ｆａｎｔａｓｙ" and a
// half-width "ﾌｧﾝﾀｼﾞｰ" reach the same slug as the forms an editor would type
// on another keyboard. What survives is letters, digits, and combining marks,
// lowercased; every other run — spaces, punctuation, symbols — becomes a
// single hyphen, and leading and trailing hyphens are dropped.
func FromName(name string) (string, error) {
	normalized := strings.ToLower(norm.NFKC.String(strings.TrimSpace(name)))

	var slug strings.Builder
	separatorPending := false
	for _, r := range normalized {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) {
			if separatorPending && slug.Len() > 0 {
				slug.WriteByte('-')
			}
			separatorPending = false
			slug.WriteRune(r)
			continue
		}
		separatorPending = true
	}

	if slug.Len() == 0 {
		return "", ErrEmpty
	}
	return slug.String(), nil
}
