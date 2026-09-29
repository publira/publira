// Package signintest stands in for Apple and Google in tests: a provider that
// publishes a key set and signs ID tokens with it, and a recorder of the calls
// the worker makes to Apple's token endpoints.
package signintest

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/publira/publira/server/internal/signin"
)

// KeyID is the kid of the key a [Provider] signs with.
const KeyID = "signintest-key"

// Provider publishes a key set at KeysURL and signs ID tokens with its key.
type Provider struct {
	server *httptest.Server
	key    *rsa.PrivateKey
}

func NewProvider(t testing.TB) *Provider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate the provider key: %v", err)
	}
	p := &Provider{key: key}
	p.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA",
			"kid": KeyID,
			"alg": "RS256",
			"use": "sig",
			"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(p.server.Close)
	return p
}

func (p *Provider) KeysURL() string {
	return p.server.URL
}

// Token is what an ID token says. A zero ExpiresAt is an hour from now, and a
// nil EmailVerified is true.
type Token struct {
	Issuer        string
	Subject       string
	Audience      string
	Email         string
	EmailVerified any
	Name          string
	Nonce         string
	ExpiresAt     time.Time
	// KeyID replaces the kid the token names, for a token naming a key the
	// provider does not publish.
	KeyID string
}

// Sign issues token, signed with the provider's key.
func (p *Provider) Sign(t testing.TB, token Token) string {
	t.Helper()
	now := time.Now()
	expiresAt := token.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = now.Add(time.Hour)
	}
	var emailVerified any = true
	if token.EmailVerified != nil {
		emailVerified = token.EmailVerified
	}
	claims := jwt.MapClaims{
		"iss":            token.Issuer,
		"sub":            token.Subject,
		"aud":            token.Audience,
		"iat":            now.Unix(),
		"exp":            expiresAt.Unix(),
		"email_verified": emailVerified,
	}
	for name, value := range map[string]string{"email": token.Email, "name": token.Name, "nonce": token.Nonce} {
		if value != "" {
			claims[name] = value
		}
	}
	signed := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed.Header["kid"] = KeyID
	if token.KeyID != "" {
		signed.Header["kid"] = token.KeyID
	}
	raw, err := signed.SignedString(p.key)
	if err != nil {
		t.Fatalf("sign the ID token: %v", err)
	}
	return raw
}

// PrivateKeyPEM is a Sign in with Apple key in the form the Apple Developer
// account issues it: a P-256 key in a PKCS #8 PEM block.
func PrivateKeyPEM(t testing.TB) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate the apple key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal the apple key: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// Verifier checks tokens against apple's and google's key sets.
func Verifier(apple, google *Provider) *signin.Verifier {
	return signin.NewVerifier(signin.VerifierConfig{AppleKeysURL: apple.KeysURL(), GoogleKeysURL: google.KeysURL()})
}

// Exchange is one code the worker traded.
type Exchange struct {
	Credentials signin.AppleCredentials
	ClientID    string
	Code        string
	RedirectURI string
}

// Revocation is one refresh token the worker revoked.
type Revocation struct {
	Credentials  signin.AppleCredentials
	ClientID     string
	RefreshToken string
}

// AppleTokens records the calls the worker makes to Apple's token endpoints.
// Every exchange grants RefreshToken, or fails with ExchangeErr.
type AppleTokens struct {
	RefreshToken string
	ExchangeErr  error
	RevokeErr    error

	mu          sync.Mutex
	exchanges   []Exchange
	revocations []Revocation
}

func (a *AppleTokens) ExchangeCode(_ context.Context, creds signin.AppleCredentials, clientID, code, redirectURI string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.exchanges = append(a.exchanges, Exchange{Credentials: creds, ClientID: clientID, Code: code, RedirectURI: redirectURI})
	if a.ExchangeErr != nil {
		return "", a.ExchangeErr
	}
	return a.RefreshToken, nil
}

func (a *AppleTokens) RevokeRefreshToken(_ context.Context, creds signin.AppleCredentials, clientID, refreshToken string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.revocations = append(a.revocations, Revocation{Credentials: creds, ClientID: clientID, RefreshToken: refreshToken})
	return a.RevokeErr
}

func (a *AppleTokens) Exchanges() []Exchange {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]Exchange(nil), a.exchanges...)
}

func (a *AppleTokens) Revocations() []Revocation {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]Revocation(nil), a.revocations...)
}
