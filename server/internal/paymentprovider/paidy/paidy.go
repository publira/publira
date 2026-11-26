// Package paidy is the Paidy payment provider: a reader pays later through
// Paidy Checkout, the script Paidy serves for the merchant's page, which
// authorizes a payment that the merchant reads from Paidy's API and captures.
//
// Paidy's API creates no payment and answers no page to send the reader to,
// so the provider runs its checkouts in the reader's browser: the storefront
// page launches the script with what [Provider.CheckoutScript] answers, and
// the payment names its checkout by the order_ref the payload carries.
// Paidy signs no notification, and a notification names its payment and
// nothing else the purchase flow needs, so every notification is read back
// from the API. Paidy takes no idempotency key, so the provider writes the
// key of each refund into the refund's metadata and reads the payment's
// refunds before asking for another. Paidy lists no payments, so the
// provider reads the payment of each checkout it is handed. A payment made
// with an account's test keys says so in its own test field.
package paidy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // Asia/Tokyo, which buyer_data's dates are written in.

	"github.com/publira/publira/server/internal/paymentprovider"
)

const (
	// ID is the provider id stored in a tenant's payment settings.
	ID = "paidy"

	// FieldPublicKey is the public key Paidy Checkout is configured with,
	// which the storefront page hands the script, and FieldSecretKey the
	// secret key every request of the API is made under. Each Paidy account
	// holds a pair for its test mode and another for live payments.
	FieldPublicKey = "public_key"
	FieldSecretKey = "secret_key"

	// APIURL is the origin of the API, which serves test and live payments
	// alike.
	APIURL = "https://api.paidy.com"
	// APIVersion is the version of the API the provider is written against,
	// which every request names.
	APIVersion = "2018-04-10"

	// NotificationAuthorized, NotificationCaptured, and NotificationRefunded
	// are the statuses of the notifications of a payment the provider reads.
	NotificationAuthorized = "authorize_success"
	NotificationCaptured   = "capture_success"
	NotificationRefunded   = "refund_success"

	// metadataRefundKey is the key of a refund's metadata the provider writes
	// the refund's idempotency key under.
	metadataRefundKey = "publira_refund_key"

	// currency is the one currency Paidy charges in.
	currency = "JPY"

	// CheckoutLifetime bounds how long after it starts a checkout can still
	// be paid. Paidy Checkout sets no time of its own within which the reader
	// has to finish, so the bound is a day: long past any reader who leaves the
	// page open, and short enough that a reconciliation reads the payment of
	// a day's checkouts besides those of its period.
	CheckoutLifetime = 24 * time.Hour
)

// japan is the time zone buyer_data's dates are written in.
var japan = func() *time.Location {
	location, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		panic(err)
	}
	return location
}()

// Provider is Paidy.
type Provider struct {
	apiURL     string
	httpClient *http.Client
	now        func() time.Time
}

var (
	_ paymentprovider.BrowserCheckout  = (*Provider)(nil)
	_ paymentprovider.UnsignedNotifier = (*Provider)(nil)
)

// Option configures a [Provider].
type Option func(*Provider)

// WithAPIURL points the provider at another origin of the API, as the E2E
// stack's stand-in for it or a test's fake.
func WithAPIURL(apiURL string) Option {
	return func(p *Provider) {
		p.apiURL = strings.TrimRight(apiURL, "/")
	}
}

// WithClock makes the provider read the time from now, which the days
// buyer_data counts are counted to.
func WithClock(now func() time.Time) Option {
	return func(p *Provider) {
		p.now = now
	}
}

// New answers the Paidy provider.
func New(options ...Option) *Provider {
	p := &Provider{
		apiURL:     APIURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		now:        time.Now,
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{
		ID:          ID,
		DisplayName: "Paidy",
		Fields: []paymentprovider.Field{
			{Name: FieldPublicKey, Public: true, Required: true},
			{Name: FieldSecretKey, Secret: true, Required: true},
		},
		Currencies:       []string{currency},
		StoredCheckouts:  true,
		CheckoutLifetime: CheckoutLifetime,
	}
}

// StartCheckout answers the storefront page that runs Paidy Checkout, and
// sends nothing to Paidy, which makes the payment once the reader pays.
func (*Provider) StartCheckout(_ context.Context, credentials paymentprovider.Credentials, req paymentprovider.CheckoutRequest) (string, error) {
	if strings.TrimSpace(credentials[FieldPublicKey]) == "" || strings.TrimSpace(credentials[FieldSecretKey]) == "" {
		return "", errors.New("paidy public key or secret key is not configured")
	}
	if req.Purchase.Currency != currency {
		return "", fmt.Errorf("paidy charges in %s, not %s", currency, req.Purchase.Currency)
	}
	if req.CheckoutID == "" || req.PageURL == "" {
		return "", errors.New("paidy: the checkout names no id or no page to run the script on")
	}
	return req.PageURL, nil
}

// item is one line of the order Paidy Checkout shows.
type item struct {
	Title     string `json:"title"`
	UnitPrice int32  `json:"unit_price"`
	Quantity  int    `json:"quantity"`
}

type order struct {
	Items []item `json:"items"`
	// OrderRef is the checkout's id, which the payment names it by.
	OrderRef string `json:"order_ref"`
}

// buyerData is what Paidy judges the reader by: their history with the
// tenant, in days and in yen.
type buyerData struct {
	UserID                  string `json:"user_id"`
	Age                     int64  `json:"age"`
	AccountRegistrationDate string `json:"account_registration_date"`
	LTV                     int64  `json:"ltv"`
	OrderCount              int64  `json:"order_count"`
	LastOrderAmount         int64  `json:"last_order_amount,omitempty"`
	LastOrderAt             *int64 `json:"last_order_at,omitempty"`
	LastOrderDate           string `json:"last_order_date,omitempty"`
}

// scriptPayload is what Paidy Checkout is launched with, less the buyer's
// name and address, which the page asks the reader for and adds.
type scriptPayload struct {
	Amount    int32     `json:"amount"`
	Currency  string    `json:"currency"`
	BuyerData buyerData `json:"buyer_data"`
	Order     order     `json:"order"`
}

// CheckoutScript answers the payload Paidy Checkout is launched with for
// checkout: its amount, its lines, the checkout's id as the order_ref the
// payment names it by, and buyer's history with the tenant, configured with
// the tenant's public key.
func (p *Provider) CheckoutScript(credentials paymentprovider.Credentials, checkout paymentprovider.StoredCheckout, buyer paymentprovider.Buyer) (paymentprovider.Script, error) {
	if strings.TrimSpace(credentials[FieldPublicKey]) == "" {
		return paymentprovider.Script{}, errors.New("paidy public key is not configured")
	}
	if checkout.Purchase.Currency != currency {
		return paymentprovider.Script{}, fmt.Errorf("paidy charges in %s, not %s", currency, checkout.Purchase.Currency)
	}
	payload, err := json.Marshal(scriptPayload{
		Amount:    checkout.Purchase.Price,
		Currency:  currency,
		BuyerData: p.buyerData(buyer),
		Order:     order{Items: items(checkout), OrderRef: checkout.CheckoutID},
	})
	if err != nil {
		return paymentprovider.Script{}, err
	}
	return paymentprovider.Script{Credentials: p.Declaration().PublicCredentials(credentials), Payload: payload}, nil
}

// items answers the lines of checkout, whose prices add up to what it
// charges: its one line at its price, or each line of a series bundle and
// the bundle's discount as a line of a negative price, as Paidy takes a
// discount.
func items(checkout paymentprovider.StoredCheckout) []item {
	if len(checkout.LineItems) == 0 {
		return []item{{Title: checkout.LineItemName, UnitPrice: checkout.Purchase.Price, Quantity: 1}}
	}
	lines := make([]item, 0, len(checkout.LineItems)+1)
	for _, line := range checkout.LineItems {
		lines = append(lines, item{Title: line.Name, UnitPrice: line.Price, Quantity: 1})
	}
	if checkout.Discount != nil && checkout.Discount.Amount > 0 {
		lines = append(lines, item{Title: checkout.Discount.Name, UnitPrice: -checkout.Discount.Amount, Quantity: 1})
	}
	return lines
}

// buyerData answers buyer as Paidy reads a buyer's history: days counted to
// now, and dates in Japan.
func (p *Provider) buyerData(buyer paymentprovider.Buyer) buyerData {
	now := p.now()
	data := buyerData{
		UserID:                  buyer.ID,
		Age:                     daysBetween(buyer.RegisteredAt, now),
		AccountRegistrationDate: buyer.RegisteredAt.In(japan).Format(time.DateOnly),
		LTV:                     buyer.AmountPaid,
		OrderCount:              buyer.Payments,
	}
	if buyer.Payments > 0 && !buyer.LastPaidAt.IsZero() {
		days := daysBetween(buyer.LastPaidAt, now)
		data.LastOrderAmount = buyer.LastAmount
		data.LastOrderAt = &days
		data.LastOrderDate = buyer.LastPaidAt.In(japan).Format(time.DateOnly)
	}
	return data
}

// daysBetween answers the whole days from since to now, and zero for a since
// after now.
func daysBetween(since, now time.Time) int64 {
	return max(int64(now.Sub(since)/(24*time.Hour)), 0)
}

// CompleteCheckout reads the payment paymentID names and captures it when
// Paidy Checkout authorized it for checkout and its amount is the
// checkout's, so the money is committed before the purchase is recorded. A
// payment captured before is answered as it is, and so is one a capture that
// answered no success has captured all the same.
func (p *Provider) CompleteCheckout(ctx context.Context, credentials paymentprovider.Credentials, checkout paymentprovider.StoredCheckout, paymentID string) (paymentprovider.PurchaseCompleted, error) {
	held, amount, err := p.checkoutPayment(ctx, credentials, checkout, paymentID)
	if err != nil {
		return paymentprovider.PurchaseCompleted{}, err
	}
	if held.captured() == nil {
		if held.status() != statusAuthorized {
			return paymentprovider.PurchaseCompleted{}, fmt.Errorf("%w: the payment is %s and was never captured", paymentprovider.ErrPaymentMismatch, held.Status)
		}
		var captured payment
		captureErr := p.do(ctx, credentials, http.MethodPost, paymentPath(paymentID, "/captures"), struct{}{}, &captured)
		if captureErr != nil {
			// A capture whose answer was lost, or one another request made
			// first, has captured the payment all the same.
			again, err := p.readPayment(ctx, credentials, paymentID)
			if err != nil || again.captured() == nil {
				return paymentprovider.PurchaseCompleted{}, completionError("capture the payment", captureErr)
			}
			captured = *again
		}
		if captured.captured() == nil {
			return paymentprovider.PurchaseCompleted{}, fmt.Errorf("paidy: the capture of %s left it %s", paymentID, captured.Status)
		}
		held = &captured
	}
	return completion(checkout, held, amount), nil
}

// CapturedCheckout reads the payment paymentID names and answers it as
// CompleteCheckout does once it is captured, and captures nothing: a payment
// Paidy Checkout authorized and nothing captured is
// [paymentprovider.ErrPaymentNotCaptured].
func (p *Provider) CapturedCheckout(ctx context.Context, credentials paymentprovider.Credentials, checkout paymentprovider.StoredCheckout, paymentID string) (paymentprovider.PurchaseCompleted, error) {
	held, amount, err := p.checkoutPayment(ctx, credentials, checkout, paymentID)
	if err != nil {
		return paymentprovider.PurchaseCompleted{}, err
	}
	if held.captured() == nil {
		if held.status() != statusAuthorized {
			return paymentprovider.PurchaseCompleted{}, fmt.Errorf("%w: the payment is %s and was never captured", paymentprovider.ErrPaymentMismatch, held.Status)
		}
		return paymentprovider.PurchaseCompleted{}, paymentprovider.ErrPaymentNotCaptured
	}
	return completion(checkout, held, amount), nil
}

// checkoutPayment reads the payment paymentID names, and answers it with its
// amount when it is a payment of checkout.
func (p *Provider) checkoutPayment(ctx context.Context, credentials paymentprovider.Credentials, checkout paymentprovider.StoredCheckout, paymentID string) (*payment, int64, error) {
	if !paymentIDPattern.MatchString(paymentID) {
		return nil, 0, fmt.Errorf("%w: %q is not a payment id", paymentprovider.ErrPaymentMismatch, paymentID)
	}
	held, err := p.readPayment(ctx, credentials, paymentID)
	if err != nil {
		return nil, 0, completionError("read the payment", err)
	}
	amount, err := checkPayment(held, checkout)
	if err != nil {
		return nil, 0, err
	}
	return held, amount, nil
}

// completion answers the captured payment held of amount as the completion
// of checkout.
func completion(checkout paymentprovider.StoredCheckout, held *payment, amount int64) paymentprovider.PurchaseCompleted {
	return paymentprovider.PurchaseCompleted{
		CheckoutID: checkout.CheckoutID,
		PaymentID:  held.ID,
		Purchase:   paymentprovider.Purchase{Currency: currency},
		AmountPaid: int32(amount),
		Test:       held.Test,
	}
}

// checkPayment answers the amount of held when it is a payment of checkout,
// and [paymentprovider.ErrPaymentMismatch] when it is not.
func checkPayment(held *payment, checkout paymentprovider.StoredCheckout) (int64, error) {
	amount, err := yen(held.Amount)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", paymentprovider.ErrPaymentMismatch, err)
	}
	switch {
	case held.Order.OrderRef != checkout.CheckoutID:
		return 0, fmt.Errorf("%w: the payment is of order %q", paymentprovider.ErrPaymentMismatch, held.Order.OrderRef)
	case !strings.EqualFold(held.Currency, checkout.Purchase.Currency) || amount != int64(checkout.Purchase.Price):
		return 0, fmt.Errorf("%w: the payment took %d %s", paymentprovider.ErrPaymentMismatch, amount, held.Currency)
	}
	return amount, nil
}

// completionError answers the error of completing a checkout when a request
// of the API failed with err: [paymentprovider.ErrPaymentMismatch] for one
// the API answered it will not carry out, as it answers a payment the
// account does not hold or one past its time to be captured, and
// [paymentprovider.ErrCredentialsRefused] for credentials it will not answer.
func completionError(doing string, err error) error {
	var apiErr *APIError
	switch {
	case errors.As(err, &apiErr) && apiErr.refused():
		return fmt.Errorf("%w: %v", paymentprovider.ErrCredentialsRefused, err)
	case errors.As(err, &apiErr) && apiErr.rejected():
		return fmt.Errorf("%w: %v", paymentprovider.ErrPaymentMismatch, err)
	}
	return fmt.Errorf("%s: %w", doing, err)
}

// notification is a notification Paidy sends of a payment, or of a token,
// which the provider has no use for.
type notification struct {
	PaymentID string `json:"payment_id"`
	CaptureID string `json:"capture_id"`
	EventType string `json:"event_type"`
	Status    string `json:"status"`
	TokenID   string `json:"token_id"`
	Timestamp string `json:"timestamp"`
}

// reads reports a notification ParseNotification does not ignore, which it
// reads the payment of from the API when it names one: an authorization, a
// capture, or a refund of a payment. A notification of a token, which only a
// subscription has, is ignored.
func (n notification) reads() bool {
	switch {
	case n.EventType != "" && n.EventType != "payment", n.PaymentID == "" && n.TokenID != "":
		return false
	}
	return n.Status == NotificationAuthorized || n.Status == NotificationCaptured || n.Status == NotificationRefunded
}

// NotificationSubject answers the payment a notification names, since Paidy
// names no checkout in one.
func (*Provider) NotificationSubject(payload []byte) (paymentprovider.NotificationSubject, bool) {
	var n notification
	if err := json.Unmarshal(payload, &n); err != nil || !n.reads() || !paymentIDPattern.MatchString(n.PaymentID) {
		return paymentprovider.NotificationSubject{}, false
	}
	return paymentprovider.NotificationSubject{PaymentID: n.PaymentID}, true
}

// ParseNotification reads the payment a notification names from the API,
// since Paidy signs nothing: the authorization or the capture of a payment
// Paidy Checkout made for one of the tenant's checkouts as
// [paymentprovider.CheckoutAuthorized], which the server completes, and a
// refund as [paymentprovider.Refunded] with the total refunded on it.
func (p *Provider) ParseNotification(ctx context.Context, payload []byte, _ http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	var n notification
	if err := json.Unmarshal(payload, &n); err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}
	// Paidy gives a notification no id, so the one logs carry is made of what
	// it names.
	id := strings.Join(slices.DeleteFunc([]string{n.PaymentID, n.TokenID, n.Status, n.CaptureID, n.Timestamp}, func(part string) bool { return part == "" }), ":")
	switch {
	case n.Status == "":
		return nil, fmt.Errorf("%w: the notification names no status", paymentprovider.ErrMalformedNotification)
	case !n.reads():
		return paymentprovider.Ignored{ID: id, Type: n.Status}, nil
	}
	if !paymentIDPattern.MatchString(n.PaymentID) {
		return nil, fmt.Errorf("%w: %q is not a payment id", paymentprovider.ErrMalformedNotification, n.PaymentID)
	}
	held, err := p.readPayment(ctx, credentials, n.PaymentID)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.notFound() {
		return nil, paymentprovider.ErrInvalidSignature
	}
	if err != nil {
		return nil, fmt.Errorf("read the payment of a notification: %w", err)
	}
	if n.Status == NotificationRefunded {
		total, err := held.refunded()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
		}
		return paymentprovider.Refunded{
			ID:             id,
			PaymentID:      held.ID,
			AmountRefunded: total,
			Currency:       strings.ToUpper(held.Currency),
		}, nil
	}
	// A payment Paidy rejected, one closed without a capture, and one that
	// names no checkout complete nothing.
	if (held.status() != statusAuthorized && held.captured() == nil) || held.Order.OrderRef == "" {
		return paymentprovider.Ignored{ID: id, Type: n.Status}, nil
	}
	return paymentprovider.CheckoutAuthorized{ID: id, CheckoutID: held.Order.OrderRef, PaymentID: held.ID}, nil
}

// refundRequest is what the API takes to refund part or all of a capture.
type refundRequest struct {
	CaptureID string            `json:"capture_id"`
	Amount    int64             `json:"amount"`
	Metadata  map[string]string `json:"metadata"`
}

// Refund refunds req.Amount of the payment's capture, or what is left of it,
// once per idempotency key: Paidy takes no key, so the provider reads the
// payment's refunds first and answers a refund made under the key as made.
// A payment not captured has taken nothing, and has nothing to refund.
func (p *Provider) Refund(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	if !paymentIDPattern.MatchString(req.PaymentID) {
		return false, fmt.Errorf("%w: %q is not a payment id", paymentprovider.ErrRefundRefused, req.PaymentID)
	}
	held, err := p.readPayment(ctx, credentials, req.PaymentID)
	if err != nil {
		return false, refundError("read the payment", err)
	}
	if held.refundBy(req.IdempotencyKey) != nil {
		return true, nil
	}
	captured := held.captured()
	if captured == nil {
		return false, fmt.Errorf("%w: the payment is %s and was never captured", paymentprovider.ErrRefundRefused, held.Status)
	}
	paid, err := yen(captured.Amount)
	if err != nil {
		return false, err
	}
	refunded, err := held.refunded()
	if err != nil {
		return false, err
	}
	remaining := paid - refunded
	amount := remaining
	if req.Amount > 0 {
		amount = req.Amount
	}
	if amount > remaining {
		return false, fmt.Errorf("%w: %d is more than the %d left of the payment", paymentprovider.ErrRefundRefused, amount, remaining)
	}
	if remaining <= 0 {
		return false, nil
	}
	body := refundRequest{CaptureID: captured.ID, Amount: amount, Metadata: map[string]string{metadataRefundKey: req.IdempotencyKey}}
	if err := p.do(ctx, credentials, http.MethodPost, paymentPath(req.PaymentID, "/refunds"), body, nil); err != nil {
		return false, refundError("refund the payment", err)
	}
	return true, nil
}

// refundError answers the error of a refund when a request of the API failed
// with err: [paymentprovider.ErrRefundRefused] for one the API answered it
// will not carry out, which the same request is answered alike, and err
// itself, for another attempt, otherwise.
func refundError(doing string, err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.rejected() {
		return fmt.Errorf("%w: %v", paymentprovider.ErrRefundRefused, err)
	}
	return fmt.Errorf("%s: %w", doing, err)
}

// RefundMade reports whether the payment holds a refund made under
// refundKey. Paidy makes a refund when it is asked or refuses it, and never
// fails one it made.
func (p *Provider) RefundMade(ctx context.Context, credentials paymentprovider.Credentials, paymentID, refundKey string) (bool, error) {
	if !paymentIDPattern.MatchString(paymentID) {
		return false, nil
	}
	held, err := p.readPayment(ctx, credentials, paymentID)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.notFound() {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return held.refundBy(refundKey) != nil, nil
}

// ListTransactions reads the payment the server kept as the completion of
// each checkout it is handed, since Paidy lists none, and answers those
// captured within the period, dated by their capture.
func (p *Provider) ListTransactions(ctx context.Context, credentials paymentprovider.Credentials, from, to time.Time, checkouts []paymentprovider.StartedCheckout) ([]paymentprovider.Transaction, error) {
	var transactions []paymentprovider.Transaction
	for _, checkout := range checkouts {
		if !paymentIDPattern.MatchString(checkout.PaymentID) {
			continue
		}
		held, err := p.readPayment(ctx, credentials, checkout.PaymentID)
		var apiErr *APIError
		switch {
		case errors.As(err, &apiErr) && apiErr.refused():
			return nil, fmt.Errorf("%w: %v", paymentprovider.ErrCredentialsRefused, err)
		case errors.As(err, &apiErr) && apiErr.notFound():
			continue
		case err != nil:
			return nil, fmt.Errorf("read the payment of checkout %s: %w", checkout.CheckoutID, err)
		}
		captured := held.captured()
		if captured == nil || held.Order.OrderRef != checkout.CheckoutID || captured.CreatedAt.Before(from) || !captured.CreatedAt.Before(to) {
			continue
		}
		amount, err := yen(captured.Amount)
		if err != nil {
			return nil, fmt.Errorf("payment %s: %w", held.ID, err)
		}
		refunded, err := held.refunded()
		if err != nil {
			return nil, fmt.Errorf("payment %s: %w", held.ID, err)
		}
		transactions = append(transactions, paymentprovider.Transaction{
			PaymentID:      held.ID,
			Amount:         amount,
			AmountRefunded: refunded,
			Currency:       strings.ToUpper(held.Currency),
			Test:           held.Test,
			Created:        captured.CreatedAt.UTC(),
		})
	}
	slices.SortStableFunc(transactions, func(a, b paymentprovider.Transaction) int {
		return a.Created.Compare(b.Created)
	})
	return transactions, nil
}
