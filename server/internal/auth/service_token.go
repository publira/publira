package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"strings"
)

// ServiceToken is the shared secret the web apps present as a bearer when
// they call an API as themselves rather than on an operator's behalf. A nil
// one accepts nothing, which is what a deployment that sets no token gets.
type ServiceToken struct {
	digest [sha256.Size]byte
}

// NewServiceToken answers nil for an empty raw value.
func NewServiceToken(raw string) *ServiceToken {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return &ServiceToken{digest: sha256.Sum256([]byte(raw))}
}

// Matches compares digests rather than the values themselves, so the time it
// takes does not depend on the length of either.
func (t *ServiceToken) Matches(bearer string) bool {
	if t == nil {
		return false
	}
	digest := sha256.Sum256([]byte(bearer))
	return subtle.ConstantTimeCompare(digest[:], t.digest[:]) == 1
}
