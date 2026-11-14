package paypay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// contentType is the content type every request body is sent and signed as.
const contentType = "application/json;charset=UTF-8"

// emptyContent stands for both the content type and the body hash of a
// request without a body in what it is signed over.
const emptyContent = "empty"

// Authorization answers the Authorization header of a request of the Open
// Payment API under apiKey and apiSecret: an HMAC-SHA256, keyed by the
// secret, of the request's path without its query, its method, nonce, epoch
// in seconds, kind, the content type the body is sent as, and the Base64 MD5
// of kind followed by the body, joined by newlines. A request without a body
// signs [emptyContent] in place of both of the last two.
func Authorization(apiKey, apiSecret, method, path, nonce string, epoch int64, kind string, body []byte) string {
	hash := emptyContent
	if len(body) == 0 {
		kind = emptyContent
	} else {
		hash = BodyHash(kind, body)
	}
	timestamp := strconv.FormatInt(epoch, 10)
	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(strings.Join([]string{path, method, nonce, timestamp, kind, hash}, "\n")))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return "hmac OPA-Auth:" + strings.Join([]string{apiKey, signature, nonce, timestamp, hash}, ":")
}

// BodyHash answers the Base64 MD5 of kind followed by body, which a request
// with a body is signed over and carries as the last part of its
// Authorization header.
func BodyHash(kind string, body []byte) string {
	sum := md5.New()
	sum.Write([]byte(kind))
	sum.Write(body)
	return base64.StdEncoding.EncodeToString(sum.Sum(nil))
}

// money is an amount as the API carries it: in yen for JPY, its one currency.
type money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type resultInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	CodeID  string `json:"codeId"`
}

// envelope is what every answer of the API arrives in.
type envelope struct {
	ResultInfo resultInfo      `json:"resultInfo"`
	Data       json.RawMessage `json:"data"`
}

// The result codes the provider tells apart.
const (
	codeDuplicateCode       = "DUPLICATE_DYNAMIC_QR_REQUEST"
	codePaymentNotFound     = "DYNAMIC_QR_PAYMENT_NOT_FOUND"
	codeOrderNotAvailable   = "ORDER_NO_LONGER_AVAILABLE"
	codeResourceNotFound    = "RESOURCE_NOT_FOUND"
	codeRefundThrottled     = "THROTTLED_MULTIPLE_REFUND_REJECTED"
	codeUnauthorized        = "UNAUTHORIZED"
	codeOperationOutOfScope = "OP_OUT_OF_SCOPE"
)

// APIError is an answer of the API that is not a success.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("paypay: %d %s: %s", e.StatusCode, e.Code, e.Message)
}

// notFound reports that the API holds no such object under the credentials,
// or no longer holds it: a payment of a code that expired unpaid answers
// [codePaymentNotFound], and one past PayPay's retention of it
// [codeOrderNotAvailable].
func (e *APIError) notFound() bool {
	return e.StatusCode == http.StatusNotFound || slices.Contains([]string{codePaymentNotFound, codeOrderNotAvailable, codeResourceNotFound}, e.Code)
}

// refused reports credentials the API will not answer.
func (e *APIError) refused() bool {
	return e.Code == codeUnauthorized || e.Code == codeOperationOutOfScope
}

// do sends one request of the API under credentials, with body encoded as
// JSON when it is not nil, and decodes the data of its answer into out.
func (p *Provider) do(ctx context.Context, credentials paymentprovider.Credentials, method, path string, body, out any) error {
	apiKey := strings.TrimSpace(credentials[FieldAPIKey])
	apiSecret := strings.TrimSpace(credentials[FieldAPISecret])
	if apiKey == "" || apiSecret == "" {
		return errors.New("paypay api key or secret is not configured")
	}
	origin, err := p.origin(credentials)
	if err != nil {
		return err
	}
	var payload []byte
	if body != nil {
		if payload, err = json.Marshal(body); err != nil {
			return fmt.Errorf("encode the request: %w", err)
		}
	}
	nonce, err := newNonce()
	if err != nil {
		return err
	}
	var reader io.Reader = http.NoBody
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, origin+path, reader)
	if err != nil {
		return err
	}
	signedPath := req.URL.EscapedPath()
	req.Header.Set("Authorization", Authorization(apiKey, apiSecret, method, signedPath, nonce, time.Now().Unix(), contentType, payload))
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", contentType)
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
	var answer envelope
	decodeErr := json.Unmarshal(raw, &answer)
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return &APIError{StatusCode: res.StatusCode, Code: answer.ResultInfo.Code, Message: answer.ResultInfo.Message}
	}
	if decodeErr != nil {
		return fmt.Errorf("decode the answer: %w", decodeErr)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(answer.Data, out); err != nil {
		return fmt.Errorf("decode the answer's data: %w", err)
	}
	return nil
}

// origin answers the API host the credentials' environment names.
func (p *Provider) origin(credentials paymentprovider.Credentials) (string, error) {
	switch environment := strings.TrimSpace(credentials[FieldEnvironment]); environment {
	case "":
		return p.productionURL, nil
	case EnvironmentSandbox:
		return p.sandboxURL, nil
	default:
		return "", fmt.Errorf("paypay environment %q is neither empty nor %q", environment, EnvironmentSandbox)
	}
}

// newNonce answers the nonce of one request: eight hexadecimal digits, the
// length the API recommends.
func newNonce() (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("make a nonce: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
