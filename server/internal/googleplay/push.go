package googleplay

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// defaultCertsURL is where Google publishes the keys it signs OIDC tokens
// with, as a JSON Web Key Set.
const defaultCertsURL = "https://www.googleapis.com/oauth2/v3/certs"

// minCertsRefresh bounds how often a token signed by a key the cached set
// does not hold sends the verifier back to Google, so a stream of forged key
// IDs cannot turn into a stream of requests.
const minCertsRefresh = time.Minute

// defaultCertsTTL is how long a key set is kept when Google's answer names no
// max-age.
const defaultCertsTTL = time.Hour

// pushClockSkew is how far Google's clock and this server's may disagree
// about when a token was issued or expires.
const pushClockSkew = time.Minute

// googleIssuers are the issuers Google's OIDC tokens name.
var googleIssuers = []string{"https://accounts.google.com", "accounts.google.com"}

// ErrInvalidPushToken reports a push whose bearer token is missing, is not
// signed by Google, has expired, or names another audience or another service
// account.
var ErrInvalidPushToken = errors.New("googleplay: the push token does not verify")

// PushConfig builds a [PushVerifier].
type PushConfig struct {
	// CertsURL replaces Google's key set, which is how the tests verify tokens
	// they signed themselves. Empty uses Google's.
	CertsURL string
	// Now is the instant a token has to be valid at; time.Now when nil.
	Now func() time.Time
}

// PushVerifier checks the OIDC token Cloud Pub/Sub sends with a push to an
// endpoint that authenticates its pushes.
type PushVerifier struct {
	certsURL string
	now      func() time.Time
	client   *http.Client

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	expires   time.Time
	refreshed time.Time
}

func NewPushVerifier(cfg PushConfig) *PushVerifier {
	certsURL := strings.TrimSpace(cfg.CertsURL)
	if certsURL == "" {
		certsURL = defaultCertsURL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &PushVerifier{certsURL: certsURL, now: now, client: &http.Client{Timeout: defaultTimeout}}
}

// VerifyPush checks that authorization is a bearer token Google signed for
// serviceAccountEmail, with a verified email, for audience, and valid now.
func (v *PushVerifier) VerifyPush(ctx context.Context, authorization, audience, serviceAccountEmail string) error {
	raw, ok := strings.CutPrefix(strings.TrimSpace(authorization), "Bearer ")
	if !ok || strings.TrimSpace(raw) == "" {
		return fmt.Errorf("%w: no bearer token", ErrInvalidPushToken)
	}
	var claims struct {
		jwt.RegisteredClaims
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	_, err := jwt.ParseWithClaims(strings.TrimSpace(raw), &claims, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		return v.key(ctx, kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(pushClockSkew),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		var unavailable *certsUnavailableError
		if errors.As(err, &unavailable) {
			return unavailable.err
		}
		return fmt.Errorf("%w: %v", ErrInvalidPushToken, err)
	}
	issued := false
	for _, issuer := range googleIssuers {
		issued = issued || claims.Issuer == issuer
	}
	if !issued {
		return fmt.Errorf("%w: issued by %q", ErrInvalidPushToken, claims.Issuer)
	}
	if !claims.EmailVerified || !strings.EqualFold(claims.Email, serviceAccountEmail) {
		return fmt.Errorf("%w: issued to another service account", ErrInvalidPushToken)
	}
	return nil
}

// certsUnavailableError carries a failure to read Google's key set out of the
// JWT parser, which would otherwise report it as a token that does not verify:
// a push Google signed is retried rather than refused while the keys cannot
// be read.
type certsUnavailableError struct{ err error }

func (e *certsUnavailableError) Error() string { return e.err.Error() }

// key answers the key kid names, reading the key set again once it has
// expired, or when it lacks kid and was not read within [minCertsRefresh]:
// Google rotates its keys and publishes a new one before signing with it.
func (v *PushVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.now()
	if key, ok := v.keys[kid]; ok && now.Before(v.expires) {
		return key, nil
	}
	if !now.Before(v.expires) || now.Sub(v.refreshed) >= minCertsRefresh {
		if err := v.refresh(ctx, now); err != nil {
			return nil, &certsUnavailableError{err: err}
		}
	}
	if key, ok := v.keys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("no key %q in Google's key set", kid)
}

func (v *PushVerifier) refresh(ctx context.Context, now time.Time) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.certsURL, nil)
	if err != nil {
		return fmt.Errorf("googleplay: build key set request: %w", err)
	}
	res, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("googleplay: read Google's key set: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("googleplay: Google's key set answered %d", res.StatusCode)
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&set); err != nil {
		return fmt.Errorf("googleplay: decode Google's key set: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(k.N)
		e, errE := base64.RawURLEncoding.DecodeString(k.E)
		if errN != nil || errE != nil || len(e) == 0 || len(e) > 4 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	v.keys = keys
	v.refreshed = now
	v.expires = now.Add(maxAge(res.Header.Get("Cache-Control")))
	return nil
}

// maxAge reads the max-age of a Cache-Control header, which is how long
// Google says its key set stays current.
func maxAge(cacheControl string) time.Duration {
	for directive := range strings.SplitSeq(cacheControl, ",") {
		value, ok := strings.CutPrefix(strings.TrimSpace(directive), "max-age=")
		if !ok {
			continue
		}
		var seconds int64
		if _, err := fmt.Sscanf(value, "%d", &seconds); err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
	}
	return defaultCertsTTL
}
