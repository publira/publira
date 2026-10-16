package inboundprovider

import (
	"crypto/subtle"
	"encoding/base64"
	"strings"
)

// BasicAuthorized reports whether an Authorization header carries token as the
// password of its basic auth, for a provider that signs nothing and is given
// a token in the webhook URL instead
// (`https://inbound:<token>@<storefront>/api/v1/webhook/email/<id>`). The user
// name is whatever the tenant wrote in the URL, and is not compared. An empty
// token authorizes nothing.
func BasicAuthorized(header, token string) bool {
	if token == "" {
		return false
	}
	scheme, encoded, ok := strings.Cut(strings.TrimSpace(header), " ")
	if !ok || !strings.EqualFold(scheme, "Basic") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return false
	}
	_, password, ok := strings.Cut(string(decoded), ":")
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(token)) == 1
}
