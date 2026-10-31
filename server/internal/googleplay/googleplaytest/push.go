package googleplaytest

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/publira/publira/server/internal/googleplay"
)

// Issuer stands in for Google as the issuer of the OIDC tokens Cloud Pub/Sub
// pushes with: it publishes a key set of its own and signs tokens with it.
type Issuer struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	kid    string
}

// NewIssuer starts a key set server, closed when t ends.
func NewIssuer(t testing.TB) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	i := &Issuer{key: key, kid: "test-key"}
	i.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": i.kid,
			"kty": "RSA",
			"alg": "RS256",
			"use": "sig",
			"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(i.server.Close)
	return i
}

// CertsURL is where this issuer publishes its key set.
func (i *Issuer) CertsURL() string {
	return i.server.URL
}

// Verifier trusts this issuer's key set and nothing else.
func (i *Issuer) Verifier() *googleplay.PushVerifier {
	return googleplay.NewPushVerifier(googleplay.PushConfig{CertsURL: i.CertsURL()})
}

// Authorization answers the Authorization header of a push to audience,
// authenticated as serviceAccountEmail, as Cloud Pub/Sub sends it.
func (i *Issuer) Authorization(t testing.TB, audience, serviceAccountEmail string) string {
	t.Helper()
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":            "https://accounts.google.com",
		"aud":            audience,
		"sub":            "111111111111111111111",
		"email":          serviceAccountEmail,
		"email_verified": true,
		"iat":            now.Unix(),
		"exp":            now.Add(time.Hour).Unix(),
	})
	token.Header["kid"] = i.kid
	signed, err := token.SignedString(i.key)
	if err != nil {
		t.Fatalf("sign push token: %v", err)
	}
	return "Bearer " + signed
}

// PushBody answers the body Cloud Pub/Sub pushes for a message carrying
// notification.
func PushBody(t testing.TB, notification map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(notification)
	if err != nil {
		t.Fatalf("encode notification: %v", err)
	}
	body, err := json.Marshal(map[string]any{
		"message": map[string]any{
			"data":        base64.StdEncoding.EncodeToString(data),
			"messageId":   "2070443601311540",
			"publishTime": time.Now().UTC().Format(time.RFC3339Nano),
		},
		"subscription": "projects/reader-app/subscriptions/play-notifications",
	})
	if err != nil {
		t.Fatalf("encode push: %v", err)
	}
	return body
}
