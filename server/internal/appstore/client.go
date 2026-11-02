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
	"strconv"
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
	body, err := c.get(ctx, credentials, environment, "/inApps/v1/transactions/"+url.PathEscape(transactionID), "get transaction info")
	if err != nil {
		return "", err
	}
	var decoded struct {
		SignedTransactionInfo string `json:"signedTransactionInfo"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil || decoded.SignedTransactionInfo == "" {
		return "", fmt.Errorf("appstore: transaction info response carries no signed transaction")
	}
	return decoded.SignedTransactionInfo, nil
}

// historyProductTypeConsumable is the productType that narrows a transaction
// history to the consumable products, which are the only ones a purchase is.
const historyProductTypeConsumable = "CONSUMABLE"

// GetTransactionHistory answers the signed transactions of consumable products
// the customer who made transactionID bought in environment from from up to
// to, oldest first, every page of them. Apple keeps one history per customer,
// so any of a customer's transactions reads all of them.
func (c *Client) GetTransactionHistory(ctx context.Context, credentials Credentials, environment, transactionID string, from, to time.Time) ([]string, error) {
	var signed []string
	revision := ""
	for {
		query := url.Values{
			"startDate":   {strconv.FormatInt(from.UnixMilli(), 10)},
			"endDate":     {strconv.FormatInt(to.UnixMilli(), 10)},
			"productType": {historyProductTypeConsumable},
			"sort":        {"ASCENDING"},
		}
		if revision != "" {
			query.Set("revision", revision)
		}
		body, err := c.get(ctx, credentials, environment, "/inApps/v2/history/"+url.PathEscape(transactionID)+"?"+query.Encode(), "get transaction history")
		if err != nil {
			return nil, err
		}
		var page struct {
			SignedTransactions []string `json:"signedTransactions"`
			Revision           string   `json:"revision"`
			HasMore            bool     `json:"hasMore"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("appstore: decode transaction history: %w", err)
		}
		signed = append(signed, page.SignedTransactions...)
		if !page.HasMore || page.Revision == "" || page.Revision == revision {
			return signed, nil
		}
		revision = page.Revision
	}
}

// Statuses of an auto-renewable subscription in Get All Subscription
// Statuses.
const (
	SubscriptionStatusActive             = 1
	SubscriptionStatusExpired            = 2
	SubscriptionStatusBillingRetry       = 3
	SubscriptionStatusBillingGracePeriod = 4
	SubscriptionStatusRevoked            = 5
)

// SubscriptionStatus is one subscription of the reader's in Get All
// Subscription Statuses: its status, and its latest transaction and renewal
// info, each signed on its own and checked with [Verifier.VerifyTransaction]
// and [Verifier.VerifyRenewalInfo].
type SubscriptionStatus struct {
	OriginalTransactionID string `json:"originalTransactionId"`
	Status                int    `json:"status"`
	SignedTransactionInfo string `json:"signedTransactionInfo"`
	SignedRenewalInfo     string `json:"signedRenewalInfo"`
}

// GetAllSubscriptionStatuses answers every subscription in the app of the
// customer transactionID belongs to, in environment, across all of the app's
// subscription groups.
func (c *Client) GetAllSubscriptionStatuses(ctx context.Context, credentials Credentials, environment, transactionID string) ([]SubscriptionStatus, error) {
	body, err := c.get(ctx, credentials, environment, "/inApps/v1/subscriptions/"+url.PathEscape(transactionID), "get all subscription statuses")
	if err != nil {
		return nil, err
	}
	var decoded struct {
		Data []struct {
			LastTransactions []SubscriptionStatus `json:"lastTransactions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("appstore: decode subscription statuses: %w", err)
	}
	var statuses []SubscriptionStatus
	for _, group := range decoded.Data {
		statuses = append(statuses, group.LastTransactions...)
	}
	return statuses, nil
}

// get sends a signed GET of path to the App Store Server API of environment
// and answers the body of a 200.
func (c *Client) get(ctx context.Context, credentials Credentials, environment, path, call string) ([]byte, error) {
	endpoint, ok := c.endpoints[environment]
	if !ok {
		return nil, fmt.Errorf("appstore: unknown environment %q", environment)
	}
	token, err := c.requestToken(credentials)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+path, nil)
	if err != nil {
		return nil, fmt.Errorf("appstore: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("appstore: %s: %w", call, err)
	}
	defer res.Body.Close() //nolint:errcheck
	// Bounded so a misrouted response cannot pull an unbounded body in; a
	// transaction's JWS is a few kilobytes, and a customer's subscription
	// statuses a few of them.
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("appstore: read response: %w", err)
	}
	switch res.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusNotFound:
		return nil, ErrTransactionNotFound
	case http.StatusUnauthorized:
		return nil, ErrUnauthorized
	default:
		return nil, fmt.Errorf("appstore: %s answered %d: %s", call, res.StatusCode, strings.TrimSpace(string(body)))
	}
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
