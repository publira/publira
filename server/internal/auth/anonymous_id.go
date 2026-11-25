package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/google/uuid"
)

// anonymousIDDomain keeps the MAC over an anonymous identifier apart from every
// other use of the token secret: an HS256 signature is a MAC under the same
// key, and without the prefix one could be presented as the other.
const anonymousIDDomain = "publira:anonymous-id:v1\x00"

// SignAnonymousID returns id with a MAC under the token secret appended, in the
// form a signed-out reader carries it: "<uuid>.<mac>". The identifier is what
// the public API files a signed-out reader's views under, so it has to be one
// the server minted, not one a caller made up to count as a new viewer on
// every request.
//
// Rotating the token secret therefore also ends every anonymous identifier, and
// each signed-out reader is filed under a new one from their next view.
func (m *TokenManager) SignAnonymousID(id uuid.UUID) string {
	return id.String() + "." + base64.RawURLEncoding.EncodeToString(m.anonymousIDMAC(id))
}

// VerifyAnonymousID returns the identifier SignAnonymousID signed into value,
// and false for anything else: a bare UUID, a MAC that does not verify, or the
// nil UUID.
func (m *TokenManager) VerifyAnonymousID(value string) (uuid.UUID, bool) {
	raw, encodedMAC, ok := strings.Cut(strings.TrimSpace(value), ".")
	if !ok {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return uuid.Nil, false
	}
	mac, err := base64.RawURLEncoding.DecodeString(encodedMAC)
	if err != nil || !hmac.Equal(mac, m.anonymousIDMAC(id)) {
		return uuid.Nil, false
	}
	return id, true
}

func (m *TokenManager) anonymousIDMAC(id uuid.UUID) []byte {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(anonymousIDDomain))
	_, _ = mac.Write(id[:])
	return mac.Sum(nil)
}
