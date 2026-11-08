// Package tenantapikeys makes and reads the API keys a tenant hands to its own
// systems. A key is "pbk_", a twelve-character prefix the key is looked up by,
// an underscore, and a 52-character secret, all lower-case base32. Only the
// SHA-256 of the whole key is stored: the key is 320 random bits, so a slow
// hash would buy nothing a fast one does not.
package tenantapikeys

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"fmt"
	"slices"
	"strings"
)

// Scopes, as tenant_api_keys.scopes stores them.
const (
	ScopeCatalogRead   = "catalog:read"
	ScopeCatalogWrite  = "catalog:write"
	ScopePurchasesRead = "purchases:read"
)

// Scopes are every scope a key can hold.
var Scopes = []string{ScopeCatalogRead, ScopeCatalogWrite, ScopePurchasesRead}

// ValidScope reports whether scope is one a key can hold.
func ValidScope(scope string) bool {
	return slices.Contains(Scopes, scope)
}

const (
	marker       = "pbk_"
	prefixLength = 12
	secretBytes  = 32
	secretLength = 52
)

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// Key is a key just made: the whole key, shown once, and what is stored of it.
type Key struct {
	Key    string
	Prefix string
	Hash   []byte
}

// New makes a key.
func New() (Key, error) {
	raw := make([]byte, 40)
	if _, err := rand.Read(raw); err != nil {
		return Key{}, fmt.Errorf("generate an API key: %w", err)
	}
	prefix := strings.ToLower(encoding.EncodeToString(raw[:8]))[:prefixLength]
	secret := strings.ToLower(encoding.EncodeToString(raw[8:]))
	key := marker + prefix + "_" + secret
	return Key{Key: key, Prefix: prefix, Hash: Hash(key)}, nil
}

// Looks reports whether a bearer token is shaped like an API key, which tells
// a request that sends one from a person's session.
func Looks(token string) bool {
	return strings.HasPrefix(token, marker)
}

// Parse answers the prefix of a key shaped like one New makes.
func Parse(key string) (string, bool) {
	rest, ok := strings.CutPrefix(key, marker)
	if !ok {
		return "", false
	}
	prefix, secret, ok := strings.Cut(rest, "_")
	if !ok || len(prefix) != prefixLength || len(secret) != secretLength {
		return "", false
	}
	if !lowerBase32(prefix) || !lowerBase32(secret) {
		return "", false
	}
	return prefix, true
}

// Hash is what is stored of key.
func Hash(key string) []byte {
	sum := sha256.Sum256([]byte(key))
	return sum[:]
}

// Matches reports, in constant time, whether key is the one stored as hash.
func Matches(key string, hash []byte) bool {
	return subtle.ConstantTimeCompare(Hash(key), hash) == 1
}

// DisplayPrefix is the part of a key the console shows once it is created.
func DisplayPrefix(prefix string) string {
	return marker + prefix
}

func lowerBase32(s string) bool {
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '2' || r > '7') {
			return false
		}
	}
	return true
}
