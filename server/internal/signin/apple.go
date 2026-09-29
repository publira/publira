package signin

import (
	"context"
	"encoding/json"
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
	appleEndpoint = "https://appleid.apple.com"

	// clientSecretLifetime is how long a client secret is valid. Apple takes
	// up to six months; each request signs its own.
	clientSecretLifetime = 5 * time.Minute
	appleRequestTimeout  = 15 * time.Second
)

var (
	// ErrInvalidGrant reports a code or token Apple refused: expired, used
	// already, or issued to another client. A retry cannot change that.
	ErrInvalidGrant = errors.New("apple: the authorization grant was refused")
	// ErrInvalidClient reports a client secret Apple refused, which is the
	// tenant's key or team rather than anything a retry changes by itself.
	ErrInvalidClient = errors.New("apple: the client secret was refused")
)

// AppleClientConfig builds an [AppleClient].
type AppleClientConfig struct {
	// Endpoint replaces https://appleid.apple.com, which is how the tests
	// point the client at a local server.
	Endpoint   string
	HTTPClient *http.Client
	Now        func() time.Time
}

// AppleClient calls the token endpoints of Sign in with Apple.
type AppleClient struct {
	endpoint string
	http     *http.Client
	now      func() time.Time
}

func NewAppleClient(cfg AppleClientConfig) *AppleClient {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: appleRequestTimeout}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &AppleClient{endpoint: strings.TrimRight(stringOr(cfg.Endpoint, appleEndpoint), "/"), http: httpClient, now: now}
}

// ExchangeCode trades an authorization code for the refresh token it grants.
// clientID is the client the code was issued to, and redirectURI the one of
// the authorization request, empty for a code the app received.
func (c *AppleClient) ExchangeCode(ctx context.Context, creds AppleCredentials, clientID, code, redirectURI string) (string, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.post(ctx, "/auth/token", creds, clientID, form, &body); err != nil {
		return "", err
	}
	if body.RefreshToken == "" {
		return "", errors.New("apple: the token response carries no refresh token")
	}
	return body.RefreshToken, nil
}

// RevokeRefreshToken revokes a refresh token and every token it granted.
func (c *AppleClient) RevokeRefreshToken(ctx context.Context, creds AppleCredentials, clientID, refreshToken string) error {
	form := url.Values{"token": {refreshToken}, "token_type_hint": {"refresh_token"}}
	return c.post(ctx, "/auth/revoke", creds, clientID, form, nil)
}

func (c *AppleClient) post(ctx context.Context, path string, creds AppleCredentials, clientID string, form url.Values, out any) error {
	secret, err := c.clientSecret(creds, clientID)
	if err != nil {
		return err
	}
	form.Set("client_id", clientID)
	form.Set("client_secret", secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("apple: %s: %w", path, err)
	}
	defer resp.Body.Close() //nolint:errcheck
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("apple: %s: read response: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		var apiErr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(payload, &apiErr)
		switch apiErr.Error {
		case "invalid_grant":
			return ErrInvalidGrant
		case "invalid_client":
			return ErrInvalidClient
		}
		return fmt.Errorf("apple: %s: status %d: %s", path, resp.StatusCode, apiErr.Error)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("apple: %s: decode response: %w", path, err)
	}
	return nil
}

// clientSecret is the JWT Apple takes in place of a static secret: signed with
// the tenant's key, issued by its team, for the client the request is about.
func (c *AppleClient) clientSecret(creds AppleCredentials, clientID string) (string, error) {
	key, err := ParsePrivateKey(creds.PrivateKey)
	if err != nil {
		return "", err
	}
	now := c.now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    creds.TeamID,
		Subject:   clientID,
		Audience:  jwt.ClaimStrings{AppleIssuer},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(clientSecretLifetime)),
	})
	token.Header["kid"] = creds.KeyID
	return token.SignedString(key)
}
