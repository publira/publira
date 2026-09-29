package appstore

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	productionEndpoint = "https://api.storekit.itunes.apple.com"
	sandboxEndpoint    = "https://api.storekit-sandbox.itunes.apple.com"

	defaultTimeout = 15 * time.Second

	// tokenLifetime is how long a request token is valid. Apple refuses one
	// that lives past an hour; each request signs its own.
	tokenLifetime = 5 * time.Minute
)

var (
	// ErrTransactionNotFound reports a transaction ID the App Store does not
	// know in the environment asked.
	ErrTransactionNotFound = errors.New("appstore: transaction not found")
	// ErrUnauthorized reports an API key the App Store refused, which is the
	// tenant's credentials rather than anything a retry changes.
	ErrUnauthorized = errors.New("appstore: the App Store Connect API key was refused")
	// ErrInvalidCredentials reports credentials that cannot sign a request.
	ErrInvalidCredentials = errors.New("appstore: credentials cannot sign a request")
)

// Credentials are a tenant's App Store Connect API key and the app it sells
// in.
type Credentials struct {
	IssuerID string
	KeyID    string
	// PrivateKey is the .p8 file's PEM.
	PrivateKey       string
	BundleIdentifier string
}

// Config builds a [Client].
type Config struct {
	// ProductionEndpoint and SandboxEndpoint replace Apple's hosts, which is
	// how the tests point a client at a local server. Empty uses Apple's.
	ProductionEndpoint string
	SandboxEndpoint    string
	HTTPClient         *http.Client
	Now                func() time.Time
}

// Client calls the App Store Server API.
type Client struct {
	endpoints map[string]string
	http      *http.Client
	now       func() time.Time
}

func NewClient(cfg Config) *Client {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultTimeout}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Client{
		endpoints: map[string]string{
			EnvironmentProduction: endpointOr(cfg.ProductionEndpoint, productionEndpoint),
			EnvironmentSandbox:    endpointOr(cfg.SandboxEndpoint, sandboxEndpoint),
		},
		http: httpClient,
		now:  now,
	}
}

func endpointOr(value, fallback string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		return fallback
	}
	return value
}

// GetTransactionInfo answers the signed transaction the App Store holds for
// transactionID in environment, which the caller verifies like one the app
// sent.
func (c *Client) GetTransactionInfo(ctx context.Context, credentials Credentials, environment, transactionID string) (string, error) {
	endpoint, ok := c.endpoints[environment]
	if !ok {
		return "", fmt.Errorf("appstore: unknown environment %q", environment)
	}
	token, err := c.requestToken(credentials)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/inApps/v1/transactions/"+url.PathEscape(transactionID), nil)
	if err != nil {
		return "", fmt.Errorf("appstore: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("appstore: get transaction info: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck
	// Bounded so a misrouted response cannot pull an unbounded body in; a
	// transaction's JWS is a few kilobytes.
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("appstore: read response: %w", err)
	}
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return "", ErrTransactionNotFound
	case http.StatusUnauthorized:
		return "", ErrUnauthorized
	default:
		return "", fmt.Errorf("appstore: get transaction info answered %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var decoded struct {
		SignedTransactionInfo string `json:"signedTransactionInfo"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil || decoded.SignedTransactionInfo == "" {
		return "", fmt.Errorf("appstore: transaction info response carries no signed transaction")
	}
	return decoded.SignedTransactionInfo, nil
}

// requestToken signs the bearer token the App Store Server API authenticates
// a request with.
func (c *Client) requestToken(credentials Credentials) (string, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(credentials.PrivateKey)))
	if block == nil {
		return "", ErrInvalidCredentials
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", ErrInvalidCredentials
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || credentials.IssuerID == "" || credentials.KeyID == "" || credentials.BundleIdentifier == "" {
		return "", ErrInvalidCredentials
	}
	now := c.now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": credentials.IssuerID,
		"iat": now.Unix(),
		"exp": now.Add(tokenLifetime).Unix(),
		"aud": "appstoreconnect-v1",
		"bid": credentials.BundleIdentifier,
	})
	token.Header["kid"] = credentials.KeyID
	signed, err := token.SignedString(key)
	if err != nil {
		return "", fmt.Errorf("appstore: sign request token: %w", err)
	}
	return signed, nil
}
