package signin

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// AppleIssuer and GoogleIssuer are the iss of the ID tokens each provider
	// issues. Google also issues tokens without the scheme.
	AppleIssuer   = "https://appleid.apple.com"
	GoogleIssuer  = "https://accounts.google.com"
	appleKeysURL  = "https://appleid.apple.com/auth/keys"
	googleKeysURL = "https://www.googleapis.com/oauth2/v3/certs"

	// keysLifetime is how long a fetched key set answers before it is fetched
	// again. Both providers rotate keys over days and publish the next one
	// ahead of using it.
	keysLifetime = time.Hour
	// keysRefetchInterval bounds how often a token naming a key the set does
	// not hold makes the set be fetched again, so a stream of forged key IDs
	// cannot turn into a stream of requests to the provider.
	keysRefetchInterval = time.Minute
	clockLeeway         = time.Minute
	fetchTimeout        = 10 * time.Second
)

var googleIssuers = []string{GoogleIssuer, "accounts.google.com"}

var (
	// ErrInvalidToken reports a token that is not one the provider issued to
	// the tenant for this sign-in: a bad signature, an issuer, audience, or
	// expiry that does not fit, or a nonce that is not the one given.
	ErrInvalidToken = errors.New("the ID token is not valid")
	// ErrKeysUnavailable reports a provider whose key set could not be read,
	// which a later attempt may not meet.
	ErrKeysUnavailable = errors.New("the provider's signing keys are unavailable")
	ErrUnknownProvider = errors.New("unknown sign-in provider")
)

// Claims are what a verified ID token says about the account.
type Claims struct {
	Subject       string
	Audience      string
	Email         string
	EmailVerified bool
	Name          string
	// AcceptedUntil is when the verifier stops accepting the token: its expiry
	// plus the clock leeway. A spent nonce is kept until then.
	AcceptedUntil time.Time
}

// VerifierConfig builds a [Verifier]. The zero value reads Apple's and
// Google's published keys.
type VerifierConfig struct {
	// AppleKeysURL and GoogleKeysURL replace the providers' key set URLs,
	// which is how the tests serve their own keys.
	AppleKeysURL  string
	GoogleKeysURL string
	HTTPClient    *http.Client
	Now           func() time.Time
}

// Verifier checks ID tokens against the keys their provider publishes.
type Verifier struct {
	sets map[string]*keySet
	now  func() time.Time
}

func NewVerifier(cfg VerifierConfig) *Verifier {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: fetchTimeout}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Verifier{
		sets: map[string]*keySet{
			ProviderApple:  {url: stringOr(cfg.AppleKeysURL, appleKeysURL), http: httpClient, now: now},
			ProviderGoogle: {url: stringOr(cfg.GoogleKeysURL, googleKeysURL), http: httpClient, now: now},
		},
		now: now,
	}
}

// Verify checks that rawToken is an ID token provider issued to one of
// audiences for the sign-in nonce stands for, and answers what it says.
func (v *Verifier) Verify(ctx context.Context, provider, rawToken string, audiences []string, nonce string) (Claims, error) {
	set, ok := v.sets[provider]
	if !ok {
		return Claims{}, ErrUnknownProvider
	}
	if len(audiences) == 0 || strings.TrimSpace(nonce) == "" {
		return Claims{}, ErrInvalidToken
	}

	var claims idTokenClaims
	var keysErr error
	_, err := jwt.ParseWithClaims(rawToken, &claims, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		key, err := set.key(ctx, kid)
		if err != nil {
			keysErr = err
		}
		return key, err
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(clockLeeway),
		jwt.WithTimeFunc(v.now),
	)
	if errors.Is(keysErr, ErrKeysUnavailable) {
		return Claims{}, keysErr
	}
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	issuers := googleIssuers
	if provider == ProviderApple {
		issuers = []string{AppleIssuer}
	}
	if !slices.Contains(issuers, claims.Issuer) {
		return Claims{}, fmt.Errorf("%w: issuer %q", ErrInvalidToken, claims.Issuer)
	}
	audience := ""
	for _, aud := range claims.Audience {
		if slices.Contains(audiences, aud) {
			audience = aud
			break
		}
	}
	if audience == "" {
		return Claims{}, fmt.Errorf("%w: audience %v", ErrInvalidToken, []string(claims.Audience))
	}
	if strings.TrimSpace(claims.Subject) == "" {
		return Claims{}, fmt.Errorf("%w: no subject", ErrInvalidToken)
	}
	if !nonceMatches(claims.Nonce, nonce) {
		return Claims{}, fmt.Errorf("%w: nonce", ErrInvalidToken)
	}
	return Claims{
		Subject:       claims.Subject,
		Audience:      audience,
		Email:         strings.TrimSpace(claims.Email),
		EmailVerified: bool(claims.EmailVerified),
		Name:          strings.TrimSpace(claims.Name),
		AcceptedUntil: claims.ExpiresAt.Add(clockLeeway),
	}, nil
}

// HashNonce is how a spent nonce is recorded.
func HashNonce(nonce string) string {
	sum := sha256.Sum256([]byte(nonce))
	return hex.EncodeToString(sum[:])
}

// nonceMatches accepts the nonce as the client generated it, and its SHA-256
// in hex, which is what an iOS app hands Apple so that the raw value never
// leaves the device before the server sees it.
func nonceMatches(claimed, nonce string) bool {
	if claimed == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(claimed), []byte(nonce)) == 1 ||
		subtle.ConstantTimeCompare([]byte(claimed), []byte(HashNonce(nonce))) == 1
}

type idTokenClaims struct {
	jwt.RegisteredClaims
	Nonce         string       `json:"nonce"`
	Email         string       `json:"email"`
	EmailVerified flexibleBool `json:"email_verified"`
	Name          string       `json:"name"`
}

// flexibleBool reads a claim Google sends as a boolean and Apple as the string
// "true" or "false".
type flexibleBool bool

func (b *flexibleBool) UnmarshalJSON(data []byte) error {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	switch v := value.(type) {
	case bool:
		*b = flexibleBool(v)
	case string:
		*b = flexibleBool(v == "true")
	default:
		*b = false
	}
	return nil
}

// keySet is a provider's published keys, fetched on first use and again when
// they grow old or a token names a key they do not hold.
type keySet struct {
	url  string
	http *http.Client
	now  func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func (s *keySet) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	stale := s.keys == nil || now.Sub(s.fetchedAt) > keysLifetime
	key, known := s.keys[kid]
	if stale || (!known && now.Sub(s.fetchedAt) > keysRefetchInterval) {
		keys, err := s.fetch(ctx)
		if err != nil {
			// Keys that have only grown old still verify what they signed.
			if known {
				return key, nil
			}
			return nil, err
		}
		s.keys, s.fetchedAt = keys, now
		key, known = keys[kid]
	}
	if !known {
		return nil, fmt.Errorf("no signing key %q", kid)
	}
	return key, nil
}

func (s *keySet) fetch(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrKeysUnavailable, err)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrKeysUnavailable, err)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrKeysUnavailable, resp.StatusCode)
	}
	var body struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrKeysUnavailable, err)
	}
	keys := make(map[string]*rsa.PublicKey, len(body.Keys))
	for _, jwk := range body.Keys {
		if jwk.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(jwk.N)
		e, errE := base64.RawURLEncoding.DecodeString(jwk.E)
		if errN != nil || errE != nil || len(e) == 0 || len(e) > 4 {
			continue
		}
		keys[jwk.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(n),
			E: int(new(big.Int).SetBytes(e).Int64()),
		}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%w: the key set holds no RSA key", ErrKeysUnavailable)
	}
	return keys, nil
}

func stringOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
