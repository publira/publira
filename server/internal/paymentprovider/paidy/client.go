package paidy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// paymentIDPattern is what the provider sends as the id of a payment in a
// request's path. The page hands the server the id its script answered, so
// the id is checked before it reaches a URL.
var paymentIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// The statuses of a payment the provider tells apart, which Paidy's
// documentation writes in capitals in one place and in lower case in
// another, so they are compared in lower case. A captured payment and one
// closed without a capture are both closed, and only its captures tell them
// apart.
const (
	statusAuthorized = "authorized"
	statusClosed     = "closed"
)

// payment is the part of a payment the provider reads.
type payment struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	// Amount is in yen, which Paidy writes as a number that may carry a
	// fraction.
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Test     bool    `json:"test"`
	Status   string  `json:"status"`
	Order    struct {
		OrderRef string `json:"order_ref"`
	} `json:"order"`
	Captures []capture `json:"captures"`
	Refunds  []refund  `json:"refunds"`
}

type capture struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Amount    float64   `json:"amount"`
}

type refund struct {
	ID        string         `json:"id"`
	CaptureID string         `json:"capture_id"`
	Amount    float64        `json:"amount"`
	Metadata  map[string]any `json:"metadata"`
}

// status answers the payment's status in lower case.
func (p *payment) status() string {
	return strings.ToLower(strings.TrimSpace(p.Status))
}

// captured answers the capture of a payment the merchant captured, and nil
// for one not captured, which has taken no money.
func (p *payment) captured() *capture {
	if p.status() != statusClosed || len(p.Captures) == 0 {
		return nil
	}
	return &p.Captures[0]
}

// refunded answers the total refunded on the payment, in yen.
func (p *payment) refunded() (int64, error) {
	var total int64
	for _, r := range p.Refunds {
		amount, err := yen(r.Amount)
		if err != nil {
			return 0, fmt.Errorf("refund %s: %w", r.ID, err)
		}
		total += amount
	}
	return total, nil
}

// refundBy answers the refund the provider made under the idempotency key
// key, which it writes into the refund's metadata, or nil.
func (p *payment) refundBy(key string) *refund {
	for i := range p.Refunds {
		if value, ok := p.Refunds[i].Metadata[metadataRefundKey].(string); ok && value == key {
			return &p.Refunds[i]
		}
	}
	return nil
}

// yen answers amount as a whole number of yen.
func yen(amount float64) (int64, error) {
	if amount < 0 || amount != math.Trunc(amount) || amount > math.MaxInt32 {
		return 0, fmt.Errorf("the amount %v is not a whole number of yen", amount)
	}
	return int64(amount), nil
}

// APIError is an answer of the API that is not a success.
type APIError struct {
	StatusCode int
	Code       string
	Title      string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("paidy: %d %s: %s", e.StatusCode, e.Code, e.Title)
}

// notFound reports a payment the API does not hold under the credentials.
func (e *APIError) notFound() bool {
	return e.StatusCode == http.StatusNotFound
}

// refused reports credentials the API will not answer.
func (e *APIError) refused() bool {
	return e.StatusCode == http.StatusUnauthorized || e.Code == "authorization.failed"
}

// rejected reports a request the API answered it will not carry out, which
// the same request sent again is answered alike: a 4xx other than one about
// the credentials or the rate of requests.
func (e *APIError) rejected() bool {
	return e.StatusCode >= http.StatusBadRequest && e.StatusCode < http.StatusInternalServerError &&
		e.StatusCode != http.StatusTooManyRequests && e.StatusCode != http.StatusRequestTimeout && !e.refused()
}

// errorBody is what the API answers a request it does not carry out with.
type errorBody struct {
	Code  string `json:"code"`
	Title string `json:"title"`
}

// readPayment reads the payment id names under credentials.
func (p *Provider) readPayment(ctx context.Context, credentials paymentprovider.Credentials, id string) (*payment, error) {
	var out payment
	if err := p.do(ctx, credentials, http.MethodGet, paymentPath(id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// paymentPath answers the path of the payment id names, or of what follows
// it.
func paymentPath(id string, rest ...string) string {
	return "/payments/" + url.PathEscape(id) + strings.Join(rest, "")
}

// do sends one request of the API under credentials, with body encoded as
// JSON when it is not nil, and decodes its answer into out.
func (p *Provider) do(ctx context.Context, credentials paymentprovider.Credentials, method, path string, body, out any) error {
	secretKey := strings.TrimSpace(credentials[FieldSecretKey])
	if secretKey == "" {
		return errors.New("paidy secret key is not configured")
	}
	var reader io.Reader = http.NoBody
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode the request: %w", err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.apiURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+secretKey)
	req.Header.Set("Paidy-Version", APIVersion)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read the answer: %w", err)
	}
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		var answer errorBody
		_ = json.Unmarshal(raw, &answer)
		return &APIError{StatusCode: res.StatusCode, Code: answer.Code, Title: answer.Title}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode the answer: %w", err)
	}
	return nil
}
