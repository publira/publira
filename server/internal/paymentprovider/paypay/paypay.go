// Package paypay is the PayPay payment provider on its Open Payment API for
// Web Payment: a code per checkout, which the reader pays in the PayPay app
// or on PayPay's web page, confirmed by reading the payment back from the
// API.
//
// PayPay carries nothing of ours on a payment but the merchantPaymentId we
// give its code, signs no notification, sends none of a refund, may send that
// of a payment once, lists no payments, and runs its sandbox on a host of its
// own whose payments say nothing of being tests. So the provider declares
// stored checkouts named by their checkouts, reads everything a notification
// names from the API, follows its refunds and its checkouts, reads the
// payment of each checkout it is handed to list them, and takes its test mode
// from the credentials.
package paypay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/publira/publira/server/internal/paymentprovider"
)

const (
	// ID is the provider id stored in a tenant's payment settings.
	ID = "paypay"

	// FieldAPIKey and FieldAPISecret are the API key and its secret PayPay
	// for Developers issues, which sign every request.
	FieldAPIKey    = "api_key"
	FieldAPISecret = "api_secret"
	// FieldMerchantID is the merchant ID PayPay for Developers shows beside
	// the key, which every request names the merchant by.
	FieldMerchantID = "merchant_id"
	// FieldEnvironment names the host the key belongs to: empty for
	// production, and EnvironmentSandbox for PayPay's sandbox, whose keys
	// take test payments only.
	FieldEnvironment   = "environment"
	EnvironmentSandbox = "sandbox"

	// ProductionURL and SandboxURL are the origins of the API.
	ProductionURL = "https://apigw.paypay.ne.jp"
	SandboxURL    = "https://apigw.sandbox.paypay.ne.jp"

	// NotificationTransaction is the notification_type of PayPay's
	// notification of a payment's state.
	NotificationTransaction = "Transaction"
	// notificationRefunds is the notification_type of the provider's own
	// notification of a payment's refunds, which PayPay sends none of.
	notificationRefunds = "publira.refunds"

	// currency is the one currency PayPay charges in.
	currency = "JPY"

	// CheckoutLifetime bounds how long a code can be paid. PayPay sets a
	// code's expiry itself, answers it with the code, and may change it, so
	// the bound is well past any it answers; a code that runs out sooner is
	// answered as [paymentprovider.ErrCheckoutExpired] when it is started
	// again.
	CheckoutLifetime = time.Hour
)

// The states of a payment the provider tells apart. A payment refunded in
// part or in full is REFUNDED, and has been paid.
const (
	statusCreated       = "CREATED"
	statusAuthorized    = "AUTHORIZED"
	statusReauthorizing = "REAUTHORIZING"
	statusCompleted     = "COMPLETED"
	statusRefunded      = "REFUNDED"
	statusFailed        = "FAILED"
	statusCanceled      = "CANCELED"
	statusExpired       = "EXPIRED"

	refundCreated  = "CREATED"
	refundRefunded = "REFUNDED"
	refundFailed   = "REFUND_FAILED"
)

// merchantIDPattern is what a merchantPaymentId and a merchantRefundId hold.
var merchantIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Provider is PayPay's Web Payment.
type Provider struct {
	productionURL string
	sandboxURL    string
	httpClient    *http.Client
}

var (
	_ paymentprovider.RefundFollower        = (*Provider)(nil)
	_ paymentprovider.CheckoutFollower      = (*Provider)(nil)
	_ paymentprovider.TestModeByCredentials = (*Provider)(nil)
	_ paymentprovider.UnsignedNotifier      = (*Provider)(nil)
)

// Option configures a [Provider].
type Option func(*Provider)

// WithBaseURLs points the provider at other origins of the API for
// production and for the sandbox, as a test's fake of them.
func WithBaseURLs(production, sandbox string) Option {
	return func(p *Provider) {
		p.productionURL = production
		p.sandboxURL = sandbox
	}
}

// New answers the PayPay provider.
func New(options ...Option) *Provider {
	p := &Provider{
		productionURL: ProductionURL,
		sandboxURL:    SandboxURL,
		// The longest PayPay asks a client to wait for any of the endpoints
		// the provider calls, creating a code and refunding a payment.
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{
		ID:          ID,
		DisplayName: "PayPay",
		Fields: []paymentprovider.Field{
			{Name: FieldAPIKey, Secret: true, Required: true},
			{Name: FieldAPISecret, Secret: true, Required: true},
			{Name: FieldMerchantID, Required: true},
			{Name: FieldEnvironment},
		},
		Currencies:         []string{currency},
		StoredCheckouts:    true,
		PaymentsByCheckout: true,
		CheckoutLifetime:   CheckoutLifetime,
	}
}

// TestMode reports credentials of PayPay's sandbox.
func (*Provider) TestMode(credentials paymentprovider.Credentials) bool {
	return strings.TrimSpace(credentials[FieldEnvironment]) == EnvironmentSandbox
}

// code is the part of a code the provider reads.
type code struct {
	URL        string `json:"url"`
	ExpiryDate int64  `json:"expiryDate"`
}

// StartCheckout creates a code for the reader to pay under the checkout's id,
// which PayPay answers again, as it first made it, for every later request
// naming the same id. A code it answers as past its expiry, or one it
// refuses to answer again whose payment it no longer holds or holds as
// closed, is [paymentprovider.ErrCheckoutExpired].
func (p *Provider) StartCheckout(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.CheckoutRequest) (string, error) {
	if !merchantIDPattern.MatchString(req.CheckoutID) {
		return "", fmt.Errorf("paypay: checkout id %q is not a merchantPaymentId", req.CheckoutID)
	}
	if req.Purchase.Currency != currency {
		return "", fmt.Errorf("paypay charges in %s, not %s", currency, req.Purchase.Currency)
	}
	redirectURL, err := withReturnKey(req.SuccessURL, req.CheckoutID)
	if err != nil {
		return "", err
	}
	body := map[string]any{
		"merchantPaymentId": req.CheckoutID,
		"amount":            money{Amount: int64(req.Purchase.Price), Currency: currency},
		"codeType":          "ORDER_QR",
		"orderDescription":  orderDescription(req),
		"isAuthorization":   false,
		"redirectUrl":       redirectURL,
		"redirectType":      "WEB_LINK",
		"requestedAt":       time.Now().Unix(),
	}
	var created code
	err = p.do(ctx, credentials, http.MethodPost, "/v2/codes", body, &created)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Code == codeDuplicateCode {
		return "", p.duplicateCode(ctx, credentials, req.CheckoutID, err)
	}
	if err != nil {
		return "", fmt.Errorf("create a code: %w", err)
	}
	if created.ExpiryDate > 0 && !time.Now().Before(time.Unix(created.ExpiryDate, 0)) {
		return "", paymentprovider.ErrCheckoutExpired
	}
	if strings.TrimSpace(created.URL) == "" {
		return "", errors.New("paypay returned a code without a URL")
	}
	return created.URL, nil
}

// duplicateCode reads the payment of a checkout whose code PayPay refuses to
// answer again, as cause says it did, to tell one that can no longer be paid.
func (p *Provider) duplicateCode(ctx context.Context, credentials paymentprovider.Credentials, checkoutID string, cause error) error {
	payment, err := p.payment(ctx, credentials, checkoutID)
	var apiErr *APIError
	switch {
	case errors.As(err, &apiErr) && apiErr.notFound():
		return paymentprovider.ErrCheckoutExpired
	case err != nil:
		return fmt.Errorf("read the payment of a code answered as a duplicate: %w", err)
	case closed(payment.Status):
		return paymentprovider.ErrCheckoutExpired
	}
	return fmt.Errorf("create a code: %w", cause)
}

// orderDescription is what the reader sees the code is for: the line's name,
// or the names of a series bundle's lines, within the 255 characters PayPay
// takes.
func orderDescription(req paymentprovider.CheckoutRequest) string {
	description := req.LineItemName
	if len(req.LineItems) > 0 {
		names := make([]string, 0, len(req.LineItems))
		for _, line := range req.LineItems {
			names = append(names, line.Name)
		}
		description = strings.Join(names, ", ")
	}
	const limit = 255
	if utf8.RuneCountInString(description) <= limit {
		return description
	}
	runes := []rune(description)
	return string(runes[:limit-1]) + "…"
}

// withReturnKey names the checkout in the URL the reader returns to, which the
// storefront reads as `session_id` to key its first read after payment apart
// from the locked one cached before checkout.
func withReturnKey(successURL, checkoutID string) (string, error) {
	parsed, err := url.Parse(successURL)
	if err != nil {
		return "", fmt.Errorf("parse success URL: %w", err)
	}
	query := parsed.Query()
	query.Set("session_id", checkoutID)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// payment is the part of a payment's details the provider reads.
type payment struct {
	PaymentID         string `json:"paymentId"`
	Status            string `json:"status"`
	AcceptedAt        int64  `json:"acceptedAt"`
	MerchantPaymentID string `json:"merchantPaymentId"`
	Amount            money  `json:"amount"`
	Refunds           struct {
		Data []refund `json:"data"`
	} `json:"refunds"`
}

type refund struct {
	Status           string `json:"status"`
	AcceptedAt       int64  `json:"acceptedAt"`
	MerchantRefundID string `json:"merchantRefundId"`
	PaymentID        string `json:"paymentId"`
	Amount           money  `json:"amount"`
	RequestedAt      int64  `json:"requestedAt"`
}

// payment reads the payment of the code made under merchantPaymentID.
func (p *Provider) payment(ctx context.Context, credentials paymentprovider.Credentials, merchantPaymentID string) (payment, error) {
	if !merchantIDPattern.MatchString(merchantPaymentID) {
		return payment{}, &APIError{StatusCode: http.StatusNotFound, Code: codePaymentNotFound, Message: "not a merchantPaymentId"}
	}
	var read payment
	if err := p.do(ctx, credentials, http.MethodGet, "/v2/codes/payments/"+merchantPaymentID, nil, &read); err != nil {
		return payment{}, err
	}
	if read.MerchantPaymentID != "" && read.MerchantPaymentID != merchantPaymentID {
		return payment{}, fmt.Errorf("paypay answered the payment of %q for %q", read.MerchantPaymentID, merchantPaymentID)
	}
	return read, nil
}

// paid reports a payment the reader has paid, refunded since or not.
func paid(status string) bool {
	return status == statusCompleted || status == statusRefunded
}

// closed reports a payment that was never paid and can no longer be.
func closed(status string) bool {
	return status == statusFailed || status == statusCanceled || status == statusExpired
}

// notification is every notification the provider reads: PayPay's of a
// payment's state, the same shape for the provider's own of a checkout's
// payment, and the provider's own of a payment's refunds. Each names the
// payment by its merchantPaymentId and nothing else is taken from it.
type notification struct {
	Type            string `json:"notification_type"`
	MerchantOrderID string `json:"merchant_order_id"`
	OrderID         string `json:"order_id"`
	State           string `json:"state"`
	NotificationID  string `json:"notification_id"`
}

// id answers what a log calls the notification, which PayPay gives no id of
// its own.
func (n notification) id() string {
	parts := []string{n.Type, n.MerchantOrderID}
	if n.State != "" {
		parts = append(parts, n.State)
	}
	if n.NotificationID != "" {
		parts = append(parts, n.NotificationID)
	}
	return strings.Join(parts, ":")
}

// reads reports a notification ParseNotification does not ignore, which it
// reads the payment of from the API when it names one.
func (n notification) reads() bool {
	return n.Type == NotificationTransaction || n.Type == notificationRefunds
}

// NotificationSubject answers the checkout a notification names by its
// merchant_order_id, the id of the checkout its payment was made for.
func (*Provider) NotificationSubject(payload []byte) (paymentprovider.NotificationSubject, bool) {
	var n notification
	if err := json.Unmarshal(payload, &n); err != nil || !n.reads() || strings.TrimSpace(n.MerchantOrderID) == "" {
		return paymentprovider.NotificationSubject{}, false
	}
	return paymentprovider.NotificationSubject{CheckoutID: n.MerchantOrderID}, true
}

// ParseNotification reads the payment a notification names from the API
// under the tenant's credentials, since PayPay signs nothing: a payment the
// API does not hold under them is [paymentprovider.ErrInvalidSignature].
func (p *Provider) ParseNotification(ctx context.Context, payload []byte, _ http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	var n notification
	if err := json.Unmarshal(payload, &n); err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if !n.reads() {
		return paymentprovider.Ignored{ID: n.id(), Type: n.Type}, nil
	}
	if strings.TrimSpace(n.MerchantOrderID) == "" {
		return nil, fmt.Errorf("%w: the notification names no payment", paymentprovider.ErrMalformedNotification)
	}
	read, err := p.payment(ctx, credentials, n.MerchantOrderID)
	if err != nil {
		return nil, readError(err)
	}
	if n.Type == notificationRefunds {
		return refundEvent(n, read)
	}
	switch {
	case paid(read.Status):
		if read.Amount.Currency != currency {
			return nil, fmt.Errorf("%w: the payment is in %q", paymentprovider.ErrMalformedNotification, read.Amount.Currency)
		}
		if read.Amount.Amount <= 0 || read.Amount.Amount > math.MaxInt32 {
			return nil, fmt.Errorf("%w: the payment took %d", paymentprovider.ErrMalformedNotification, read.Amount.Amount)
		}
		// PayPay takes no promotion code of its own, so the reader paid what
		// the code charged.
		return paymentprovider.PurchaseCompleted{
			ID:         n.id(),
			CheckoutID: n.MerchantOrderID,
			PaymentID:  n.MerchantOrderID,
			Purchase:   paymentprovider.Purchase{Currency: read.Amount.Currency},
			AmountPaid: int32(read.Amount.Amount),
			Test:       p.TestMode(credentials),
		}, nil
	case closed(read.Status):
		return paymentprovider.CheckoutExpired{
			ID:         n.id(),
			CheckoutID: n.MerchantOrderID,
			Purchase:   paymentprovider.Purchase{Currency: read.Amount.Currency},
		}, nil
	case read.Status == statusCreated || read.Status == statusAuthorized || read.Status == statusReauthorizing:
		return paymentprovider.Ignored{ID: n.id(), Type: n.Type}, nil
	default:
		return nil, fmt.Errorf("paypay payment %s is in an unknown state %q", n.MerchantOrderID, read.Status)
	}
}

// readError reads what the API answered a read of a notification's payment
// with as what ParseNotification reports.
func readError(err error) error {
	var apiErr *APIError
	switch {
	case errors.As(err, &apiErr) && apiErr.notFound():
		return fmt.Errorf("%w: paypay holds no such payment: %v", paymentprovider.ErrInvalidSignature, err)
	case errors.As(err, &apiErr) && apiErr.refused():
		return fmt.Errorf("%w: %v", paymentprovider.ErrCredentialsRefused, err)
	}
	return fmt.Errorf("read the payment: %w", err)
}

// refundEvent is what the provider's own notification of a payment's refunds
// reports: the total refunded, or a failure when the latest of its refunds
// failed, once none is pending.
func refundEvent(n notification, read payment) (paymentprovider.Event, error) {
	var latest *refund
	var total int64
	for i := range read.Refunds.Data {
		r := &read.Refunds.Data[i]
		switch r.Status {
		case refundCreated:
			return nil, paymentprovider.ErrRefundPending
		case refundRefunded:
			total += r.Amount.Amount
		}
		if latest == nil || r.AcceptedAt >= latest.AcceptedAt {
			latest = r
		}
	}
	if latest != nil && latest.Status == refundFailed {
		return paymentprovider.RefundFailed{
			ID:             n.id(),
			PaymentID:      n.MerchantOrderID,
			AmountRefunded: total,
			Currency:       read.Amount.Currency,
			RefundKey:      refundKeyOf(latest.MerchantRefundID),
		}, nil
	}
	if total == 0 {
		return paymentprovider.Ignored{ID: n.id(), Type: n.Type}, nil
	}
	return paymentprovider.Refunded{ID: n.id(), PaymentID: n.MerchantOrderID, AmountRefunded: total, Currency: read.Amount.Currency}, nil
}

// RefundNotification answers the provider's own notification of the refunds
// of the payment paymentID, its merchantPaymentId, names.
func (*Provider) RefundNotification(paymentID string) []byte {
	return mustMarshal(notification{Type: notificationRefunds, MerchantOrderID: paymentID})
}

// CheckoutNotification answers a notification of the payment of the checkout
// checkoutID in the shape of PayPay's own, which ParseNotification reads the
// payment for.
func (*Provider) CheckoutNotification(checkoutID string) []byte {
	return mustMarshal(notification{Type: NotificationTransaction, MerchantOrderID: checkoutID})
}

func mustMarshal(n notification) []byte {
	payload, err := json.Marshal(n)
	if err != nil {
		panic(err)
	}
	return payload
}

// The prefixes of the merchantRefundId a refund is made under, which name the
// refund by the key it was requested under, since PayPay keeps nothing else
// of ours beside a refund. A refund of an amount is the key behind
// amountPrefix, so the key a failure of it carries is read back from it; a
// refund of the rest is the key behind restPrefix, which a failure carries no
// key of; and a key that does not fit a merchantRefundId behind either is
// hashed behind hashedPrefix, as nothing then reads it back. A refund made in
// PayPay's own tools carries an id of PayPay's, which may begin as one of
// these does; the key read from it then names no refund the server asked for.
const (
	amountPrefix = "k"
	restPrefix   = "r"
	hashedPrefix = "h"
)

// MerchantRefundID answers the merchantRefundId of the refund req asks for,
// as a test that looks the refund up in a fake of the API needs it.
func MerchantRefundID(req paymentprovider.RefundRequest) string {
	prefix := restPrefix
	if req.Amount > 0 {
		prefix = amountPrefix
	}
	if id := prefix + req.IdempotencyKey; merchantIDPattern.MatchString(id) {
		return id
	}
	sum := sha256.Sum256([]byte(prefix + req.IdempotencyKey))
	return hashedPrefix + hex.EncodeToString(sum[:20])
}

// refundKeyOf answers the key a refund of an amount was requested under, and
// none for any other refund.
func refundKeyOf(merchantRefundID string) string {
	key, ok := strings.CutPrefix(merchantRefundID, amountPrefix)
	if !ok {
		return ""
	}
	return key
}

// Refund refunds req.Amount, or what is left of the payment, under a
// merchantRefundId made from its key, which PayPay answers again as it first
// made it however often it is sent. A refund the payment already carries
// under that id is reported before another is asked for, so that one PayPay
// no longer answers again is not made twice. PayPay refunds asynchronously,
// so what a refund it accepted comes to reaches the purchase flow through
// [Provider.RefundNotification].
func (p *Provider) Refund(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	read, err := p.payment(ctx, credentials, req.PaymentID)
	if err != nil {
		return false, refundError("read the payment", err)
	}
	if !paid(read.Status) || read.PaymentID == "" {
		return false, fmt.Errorf("%w: the payment is %s", paymentprovider.ErrRefundRefused, read.Status)
	}
	id := MerchantRefundID(req)
	// What is refunded or still being refunded is no longer the payment's
	// to give back.
	var committed int64
	for _, r := range read.Refunds.Data {
		if r.MerchantRefundID == id {
			if r.Status == refundFailed {
				return false, fmt.Errorf("%w: the refund failed", paymentprovider.ErrRefundRefused)
			}
			return true, nil
		}
		if r.Status == refundRefunded || r.Status == refundCreated {
			committed += r.Amount.Amount
		}
	}
	remaining := read.Amount.Amount - committed
	amount := remaining
	if req.Amount > 0 {
		amount = req.Amount
	}
	if amount > remaining {
		return false, fmt.Errorf("%w: more than is left of the payment", paymentprovider.ErrRefundRefused)
	}
	if remaining <= 0 {
		return false, nil
	}
	body := map[string]any{
		"merchantRefundId": id,
		"paymentId":        read.PaymentID,
		"amount":           money{Amount: amount, Currency: read.Amount.Currency},
		"requestedAt":      time.Now().Unix(),
	}
	var made refund
	if err := p.do(ctx, credentials, http.MethodPost, "/v2/refunds", body, &made); err != nil {
		return false, refundError("refund the payment", err)
	}
	if made.Status == refundFailed {
		return false, fmt.Errorf("%w: the refund failed", paymentprovider.ErrRefundRefused)
	}
	return true, nil
}

// refundError reads an answer the API gives for a request it will not carry
// out, as opposed to one it failed to answer or asks to have sent again
// later, as a refund it refuses.
func refundError(action string, err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode >= http.StatusBadRequest && apiErr.StatusCode < http.StatusInternalServerError &&
		apiErr.StatusCode != http.StatusTooManyRequests && apiErr.Code != codeRefundThrottled {
		return fmt.Errorf("%w: %s: %v", paymentprovider.ErrRefundRefused, action, err)
	}
	return fmt.Errorf("%s: %w", action, err)
}

func (p *Provider) RefundMade(ctx context.Context, credentials paymentprovider.Credentials, paymentID, refundKey string) (bool, error) {
	read, err := p.payment(ctx, credentials, paymentID)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.notFound() {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read the payment: %w", err)
	}
	id := MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: refundKey, Amount: 1})
	for _, r := range read.Refunds.Data {
		if r.MerchantRefundID == id {
			return r.Status != refundFailed, nil
		}
	}
	return false, nil
}

// ListTransactions reads the payment of each checkout it is handed, since
// PayPay lists no payments, and answers those paid from from up to to.
func (p *Provider) ListTransactions(ctx context.Context, credentials paymentprovider.Credentials, from, to time.Time, checkouts []paymentprovider.StartedCheckout) ([]paymentprovider.Transaction, error) {
	var transactions []paymentprovider.Transaction
	for _, checkout := range checkouts {
		checkoutID := checkout.CheckoutID
		read, err := p.payment(ctx, credentials, checkoutID)
		var apiErr *APIError
		switch {
		case errors.As(err, &apiErr) && apiErr.notFound():
			continue
		case errors.As(err, &apiErr) && apiErr.refused():
			return nil, fmt.Errorf("%w: %v", paymentprovider.ErrCredentialsRefused, err)
		case err != nil:
			return nil, fmt.Errorf("read the payment of checkout %s: %w", checkoutID, err)
		}
		accepted := time.Unix(read.AcceptedAt, 0).UTC()
		if !paid(read.Status) || read.AcceptedAt == 0 || accepted.Before(from) || !accepted.Before(to) {
			continue
		}
		var refunded int64
		for _, r := range read.Refunds.Data {
			if r.Status == refundRefunded {
				refunded += r.Amount.Amount
			}
		}
		transactions = append(transactions, paymentprovider.Transaction{
			PaymentID:      checkoutID,
			Amount:         read.Amount.Amount,
			AmountRefunded: refunded,
			Currency:       read.Amount.Currency,
			Test:           p.TestMode(credentials),
			Created:        accepted,
		})
	}
	slices.SortStableFunc(transactions, func(a, b paymentprovider.Transaction) int {
		return a.Created.Compare(b.Created)
	})
	return transactions, nil
}
