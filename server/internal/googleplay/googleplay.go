// Package googleplay asks the Google Play Developer API about a tenant's
// one-time product purchases, as the service account the tenant granted
// access to its app in the Play Console.
package googleplay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const (
	androidPublisherScope = "https://www.googleapis.com/auth/androidpublisher"
	defaultEndpoint       = "https://androidpublisher.googleapis.com"
	defaultTimeout        = 15 * time.Second
)

// Purchase states of a one-time product purchase.
const (
	PurchaseStatePurchased = 0
	PurchaseStateCanceled  = 1
	PurchaseStatePending   = 2
)

// ConsumptionStateConsumed is a purchase that has been consumed.
const ConsumptionStateConsumed = 1

// PurchaseTypeTest is a license tester's purchase, which charged nobody.
const PurchaseTypeTest = 0

var (
	// ErrPurchaseNotFound reports a token Google Play knows no purchase of the
	// product by, in the tenant's app.
	ErrPurchaseNotFound = errors.New("googleplay: purchase not found")
	// ErrUnauthorized reports a service account Google Play refused, which is
	// the tenant's credentials rather than anything a retry changes.
	ErrUnauthorized = errors.New("googleplay: the service account was refused")
	// ErrInvalidCredentials reports a service account key that cannot sign a
	// request.
	ErrInvalidCredentials = errors.New("googleplay: service account key cannot sign a request")
)

// ProductPurchase is the part of a ProductPurchase resource a purchase is
// decided on.
type ProductPurchase struct {
	PurchaseState    int    `json:"purchaseState"`
	ConsumptionState int    `json:"consumptionState"`
	OrderID          string `json:"orderId"`
	// PurchaseType is absent for a purchase someone paid for.
	PurchaseType *int `json:"purchaseType"`
	// ObfuscatedExternalAccountID is the value the app set on the purchase,
	// which is the intent the purchase was opened with.
	ObfuscatedExternalAccountID string `json:"obfuscatedExternalAccountId"`
}

// IsTest reports a license tester's purchase.
func (p ProductPurchase) IsTest() bool {
	return p.PurchaseType != nil && *p.PurchaseType == PurchaseTypeTest
}

// Config builds a [Client].
type Config struct {
	// Endpoint and TokenURL replace Google's hosts, which is how the tests
	// point a client at a local server. Empty uses Google's; the token URL a
	// key file names is never used, so a key cannot aim the signed assertion
	// elsewhere.
	Endpoint string
	TokenURL string
}

// Client calls the Google Play Developer API.
type Client struct {
	endpoint string
	tokenURL string
}

func NewClient(cfg Config) *Client {
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.Endpoint), "/")
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	tokenURL := strings.TrimSpace(cfg.TokenURL)
	if tokenURL == "" {
		tokenURL = google.JWTTokenURL
	}
	return &Client{endpoint: endpoint, tokenURL: tokenURL}
}

// GetProductPurchase answers the purchase token was bought by, of productID
// in the app packageName.
func (c *Client) GetProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) (ProductPurchase, error) {
	body, err := c.do(ctx, serviceAccountKey, http.MethodGet, c.purchaseURL(packageName, productID, token))
	if err != nil {
		return ProductPurchase{}, err
	}
	var purchase ProductPurchase
	if err := json.Unmarshal(body, &purchase); err != nil {
		return ProductPurchase{}, fmt.Errorf("googleplay: decode product purchase: %w", err)
	}
	return purchase, nil
}

// ConsumeProductPurchase consumes a purchase, which also acknowledges it. A
// consumable left unconsumed cannot be bought again, and one left
// unacknowledged for three days is refunded by Google Play.
func (c *Client) ConsumeProductPurchase(ctx context.Context, serviceAccountKey []byte, packageName, productID, token string) error {
	_, err := c.do(ctx, serviceAccountKey, http.MethodPost, c.purchaseURL(packageName, productID, token)+":consume")
	return err
}

// VoidedPurchase is a purchase Google Play refunded, canceled, or charged
// back.
type VoidedPurchase struct {
	PurchaseToken string `json:"purchaseToken"`
	OrderID       string `json:"orderId"`
	// VoidedTimeMillis is when the purchase was voided, in milliseconds since
	// the epoch, as a decimal string.
	VoidedTimeMillis string `json:"voidedTimeMillis"`
}

// MaxVoidedPurchaseAge is how far back the Voided Purchases API reads.
const MaxVoidedPurchaseAge = 30 * 24 * time.Hour

// voidedPurchasesPageSize is the most the API answers in one page.
const voidedPurchasesPageSize = 1000

// ListVoidedPurchases answers every one-time product purchase in packageName
// voided between since and until, following the pages the API splits them
// into. since may be at most [MaxVoidedPurchaseAge] ago.
func (c *Client) ListVoidedPurchases(ctx context.Context, serviceAccountKey []byte, packageName string, since, until time.Time) ([]VoidedPurchase, error) {
	var voided []VoidedPurchase
	pageToken := ""
	for {
		query := url.Values{
			"startTime":  {strconv.FormatInt(since.UnixMilli(), 10)},
			"endTime":    {strconv.FormatInt(until.UnixMilli(), 10)},
			"type":       {"0"},
			"maxResults": {strconv.Itoa(voidedPurchasesPageSize)},
		}
		if pageToken != "" {
			query.Set("token", pageToken)
		}
		target := fmt.Sprintf("%s/androidpublisher/v3/applications/%s/purchases/voidedpurchases?%s",
			c.endpoint, url.PathEscape(packageName), query.Encode())
		body, err := c.do(ctx, serviceAccountKey, http.MethodGet, target)
		if err != nil {
			return nil, err
		}
		var page struct {
			VoidedPurchases []VoidedPurchase `json:"voidedPurchases"`
			TokenPagination struct {
				NextPageToken string `json:"nextPageToken"`
			} `json:"tokenPagination"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("googleplay: decode voided purchases: %w", err)
		}
		voided = append(voided, page.VoidedPurchases...)
		pageToken = page.TokenPagination.NextPageToken
		if pageToken == "" {
			return voided, nil
		}
	}
}

func (c *Client) purchaseURL(packageName, productID, token string) string {
	return fmt.Sprintf("%s/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s",
		c.endpoint, url.PathEscape(packageName), url.PathEscape(productID), url.PathEscape(token))
}

func (c *Client) do(ctx context.Context, serviceAccountKey []byte, method, target string) ([]byte, error) {
	httpClient, err := c.httpClient(ctx, serviceAccountKey)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(nil))
	if err != nil {
		return nil, fmt.Errorf("googleplay: build request: %w", err)
	}
	res, err := httpClient.Do(req)
	if err != nil {
		var retrieve *oauth2.RetrieveError
		if errors.As(err, &retrieve) && retrieve.Response != nil &&
			(retrieve.Response.StatusCode == http.StatusBadRequest || retrieve.Response.StatusCode == http.StatusUnauthorized) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("googleplay: %s: %w", method, err)
	}
	defer res.Body.Close() //nolint:errcheck
	// Bounded so a misrouted response cannot pull an unbounded body in; a
	// purchase resource is under a kilobyte.
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("googleplay: read response: %w", err)
	}
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return body, nil
	// Google Play answers a token it has no purchase for with 400 as readily as
	// with 404, and with 410 once the purchase is gone.
	case res.StatusCode == http.StatusBadRequest, res.StatusCode == http.StatusNotFound, res.StatusCode == http.StatusGone:
		return nil, ErrPurchaseNotFound
	case res.StatusCode == http.StatusUnauthorized, res.StatusCode == http.StatusForbidden:
		return nil, ErrUnauthorized
	default:
		return nil, fmt.Errorf("googleplay: %s answered %d: %s", method, res.StatusCode, strings.TrimSpace(string(body)))
	}
}

func (c *Client) httpClient(ctx context.Context, serviceAccountKey []byte) (*http.Client, error) {
	jwtConfig, err := google.JWTConfigFromJSON(serviceAccountKey, androidPublisherScope)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	jwtConfig.TokenURL = c.tokenURL
	tokenCtx := context.WithValue(context.WithoutCancel(ctx), oauth2.HTTPClient, &http.Client{Timeout: defaultTimeout})
	httpClient := oauth2.NewClient(tokenCtx, jwtConfig.TokenSource(tokenCtx))
	httpClient.Timeout = defaultTimeout
	return httpClient, nil
}
