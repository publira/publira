package paypay_test

import (
	"errors"
	"maps"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paypay"
	"github.com/publira/publira/server/internal/paymentprovider/paypay/paypaytest"
)

var testCredentials = paymentprovider.Credentials{
	paypay.FieldAPIKey:     "a_ProviderTestAAAA",
	paypay.FieldAPISecret:  "ProviderTestSecretAAAA",
	paypay.FieldMerchantID: "000000000000000001",
}

// withCredential answers testCredentials with name holding value instead.
func withCredential(name, value string) paymentprovider.Credentials {
	credentials := maps.Clone(testCredentials)
	credentials[name] = value
	return credentials
}

func newAPI(t *testing.T) (*paypaytest.API, *paypay.Provider) {
	t.Helper()
	api := paypaytest.NewAPI(t)
	api.Register(testCredentials)
	return api, api.Provider()
}

func checkoutRequest(checkoutID string) paymentprovider.CheckoutRequest {
	return paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:  uuid.New(),
			ReaderID:  uuid.New(),
			EpisodeID: uuid.New(),
			Kind:      paymentprovider.KindPurchase,
			Price:     500,
			Currency:  "JPY",
		},
		LineItemName:   "Episode 1",
		SuccessURL:     "https://store.example/series/SR01/episodes/EP01?checkout=success",
		CancelURL:      "https://store.example/series/SR01/episodes/EP01?checkout=cancelled",
		IdempotencyKey: "episode-checkout:" + checkoutID,
		CheckoutID:     checkoutID,
	}
}

func TestAuthorizationMatchesTheExampleInPayPaysDocumentation(t *testing.T) {
	// The example of the API's authorization guide, which is a request to
	// create a code.
	body := []byte(`{"sampleRequestBodyKey1":"sampleRequestBodyValue1","sampleRequestBodyKey2":"sampleRequestBodyValue2"}`)
	got := paypay.Authorization("APIKeyGenerated", "APIKeySecretGenerated", "POST", "/v2/codes", "acd028", 1579843452, "application/json;charset=UTF-8;", body)
	const want = "hmac OPA-Auth:APIKeyGenerated:NW1jKIMnzR7tEhMWtcJcaef+nFVBt7jjAGcVuxHhchc=:acd028:1579843452:1j0FnY4flNp5CtIKa7x9MQ=="
	if got != want {
		t.Fatalf("Authorization = %q, want %q", got, want)
	}
}

func TestAuthorizationOfARequestWithoutABodySignsItAsEmpty(t *testing.T) {
	got := paypay.Authorization("key", "secret", "GET", "/v2/codes/payments/abc", "acd028", 1579843452, "application/json;charset=UTF-8", nil)
	if !strings.HasSuffix(got, ":acd028:1579843452:empty") {
		t.Fatalf("Authorization = %q, want one ending in the nonce, the epoch, and empty", got)
	}
	if got != paypay.Authorization("key", "secret", "GET", "/v2/codes/payments/abc", "acd028", 1579843452, "empty", nil) {
		t.Fatal("a request without a body is signed over the content type it is sent with")
	}
}

func TestStartCheckoutCreatesACodeUnderTheCheckoutsID(t *testing.T) {
	api, provider := newAPI(t)
	checkoutURL, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	codes := api.Codes()
	if len(codes) != 1 {
		t.Fatalf("codes = %d, want 1", len(codes))
	}
	body := codes[0].Body
	if !strings.HasPrefix(checkoutURL, "https://qr-stg.sandbox.paypay.ne.jp/") {
		t.Fatalf("url = %q, want the code's", checkoutURL)
	}
	if codes[0].APIKey != testCredentials[paypay.FieldAPIKey] || body["merchantPaymentId"] != "0123456789abcdef0123456789abcdef" || body["codeType"] != "ORDER_QR" {
		t.Fatalf("code = %v under %q, want an ORDER_QR code under the checkout's id", body, codes[0].APIKey)
	}
	if amount, _ := body["amount"].(map[string]any); amount["amount"] != float64(500) || amount["currency"] != "JPY" {
		t.Fatalf("amount = %v, want 500 JPY", body["amount"])
	}
	if body["orderDescription"] != "Episode 1" || body["isAuthorization"] != false || body["redirectType"] != "WEB_LINK" {
		t.Fatalf("code = %v, want an instant payment of Episode 1 returning to a web page", body)
	}
	redirect, err := url.Parse(body["redirectUrl"].(string))
	if err != nil {
		t.Fatalf("redirectUrl: %v", err)
	}
	if redirect.Path != "/series/SR01/episodes/EP01" || redirect.Query().Get("checkout") != "success" || redirect.Query().Get("session_id") != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("redirectUrl = %s, want the episode with checkout=success and the checkout's id", redirect)
	}
}

func TestStartCheckoutNamesASeriesBundleByItsLines(t *testing.T) {
	api, provider := newAPI(t)
	req := checkoutRequest("bundle0123456789abcdef0123456789")
	req.LineItemName = ""
	req.LineItems = []paymentprovider.LineItem{{Name: "Episode 2", Price: 300, DiscountedPrice: 250}, {Name: "Episode 3", Price: 300, DiscountedPrice: 250}}
	if _, err := provider.StartCheckout(t.Context(), testCredentials, req); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	if got := api.Codes()[0].Body["orderDescription"]; got != "Episode 2, Episode 3" {
		t.Fatalf("orderDescription = %v, want the lines' names", got)
	}
}

func TestStartCheckoutCutsADescriptionToWhatPayPayTakes(t *testing.T) {
	api, provider := newAPI(t)
	req := checkoutRequest("long0123456789abcdef0123456789ab")
	req.LineItemName = strings.Repeat("話", 300)
	if _, err := provider.StartCheckout(t.Context(), testCredentials, req); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	description, _ := api.Codes()[0].Body["orderDescription"].(string)
	if got := len([]rune(description)); got != 255 || !strings.HasSuffix(description, "…") {
		t.Fatalf("orderDescription is %d characters, want 255 ending in an ellipsis", got)
	}
}

func TestStartCheckoutRefusesWhatPayPayCannotCharge(t *testing.T) {
	_, provider := newAPI(t)
	usd := checkoutRequest("usd0123456789abcdef0123456789abc")
	usd.Purchase.Currency = "USD"
	if _, err := provider.StartCheckout(t.Context(), testCredentials, usd); err == nil {
		t.Fatal("StartCheckout in USD = nil error, want one")
	}
	unnamed := checkoutRequest("")
	if _, err := provider.StartCheckout(t.Context(), testCredentials, unnamed); err == nil {
		t.Fatal("StartCheckout without a checkout id = nil error, want one")
	}
}

func TestStartCheckoutRefusesAnEnvironmentItDoesNotKnow(t *testing.T) {
	_, provider := newAPI(t)
	credentials := withCredential(paypay.FieldEnvironment, "staging")
	if _, err := provider.StartCheckout(t.Context(), credentials, checkoutRequest("env0123456789abcdef0123456789abc")); err == nil {
		t.Fatal("StartCheckout under an unknown environment = nil error, want one")
	}
	if provider.TestMode(credentials) {
		t.Fatal("an unknown environment is the sandbox")
	}
}

func TestStartCheckoutUnderAWrongSecretOrMerchantIsRefused(t *testing.T) {
	for name, credentials := range map[string]paymentprovider.Credentials{
		"another secret":   withCredential(paypay.FieldAPISecret, "AnotherSecret"),
		"another merchant": withCredential(paypay.FieldMerchantID, "000000000000000009"),
	} {
		t.Run(name, func(t *testing.T) {
			_, provider := newAPI(t)
			_, err := provider.StartCheckout(t.Context(), credentials, checkoutRequest("auth0123456789abcdef0123456789ab"))
			var apiErr *paypay.APIError
			if !errors.As(err, &apiErr) || apiErr.Code != "UNAUTHORIZED" {
				t.Fatalf("StartCheckout error = %v, want PayPay's UNAUTHORIZED", err)
			}
		})
	}
}

func TestEveryRequestNamesTheMerchant(t *testing.T) {
	api, provider := newAPI(t)
	// The fake refuses a request whose merchant is not the key's, so each of
	// these reaching it is a request that named the merchant.
	const checkoutID = "merchant0123456789abcdef01234567"
	if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	api.Pay(testCredentials, checkoutID, 500, "JPY", time.Now())
	if _, err := provider.ParseNotification(t.Context(), provider.CheckoutNotification(checkoutID), nil, testCredentials); err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	if _, err := provider.Refund(t.Context(), testCredentials, paymentprovider.RefundRequest{PaymentID: checkoutID, IdempotencyKey: "merchant-refund"}); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	// Without one, nothing is sent.
	if _, err := provider.StartCheckout(t.Context(), withCredential(paypay.FieldMerchantID, ""), checkoutRequest("nomerchant0123456789abcdef012345")); err == nil {
		t.Fatal("StartCheckout without a merchant id = nil error, want one")
	}
}

func TestStartCheckoutOfACodePayPayRefusesAsADuplicate(t *testing.T) {
	api, provider := newAPI(t)
	api.RefuseDuplicateCodes()
	const checkoutID = "dup0123456789abcdef0123456789abc"
	if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	// A code that can still be paid is not one to start again.
	if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); err == nil || errors.Is(err, paymentprovider.ErrCheckoutExpired) {
		t.Fatalf("StartCheckout of an open code refused as a duplicate: error = %v, want one that is not ErrCheckoutExpired", err)
	}
	api.Expire(testCredentials, checkoutID)
	if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); !errors.Is(err, paymentprovider.ErrCheckoutExpired) {
		t.Fatalf("StartCheckout of an expired code refused as a duplicate: error = %v, want ErrCheckoutExpired", err)
	}
}

func TestParseNotificationReadsAPaymentThatClosedUnpaidAsExpired(t *testing.T) {
	for _, status := range []string{"FAILED", "CANCELED", "EXPIRED"} {
		t.Run(status, func(t *testing.T) {
			api, provider := newAPI(t)
			checkoutID := "closed_" + strings.ToLower(status)
			if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); err != nil {
				t.Fatalf("StartCheckout: %v", err)
			}
			api.SetStatus(testCredentials, checkoutID, status)
			event, err := provider.ParseNotification(t.Context(), provider.CheckoutNotification(checkoutID), nil, testCredentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			expired, ok := event.(paymentprovider.CheckoutExpired)
			if !ok || expired.CheckoutID != checkoutID || expired.Purchase.Currency != "JPY" {
				t.Fatalf("event = %+v, want the checkout expired in JPY", event)
			}
		})
	}
}

func TestParseNotificationOfACodeThatRanOutUnpaidIsOneThePaymentIsNotHeldFor(t *testing.T) {
	api, provider := newAPI(t)
	const checkoutID = "ranout0123456789abcdef0123456789"
	if _, err := provider.StartCheckout(t.Context(), testCredentials, checkoutRequest(checkoutID)); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	api.Expire(testCredentials, checkoutID)
	if _, err := provider.ParseNotification(t.Context(), provider.CheckoutNotification(checkoutID), nil, testCredentials); !errors.Is(err, paymentprovider.ErrInvalidSignature) {
		t.Fatalf("ParseNotification error = %v, want ErrInvalidSignature", err)
	}
}

func TestParseNotificationUnderAWrongSecretIsCredentialsRefused(t *testing.T) {
	_, provider := newAPI(t)
	credentials := withCredential(paypay.FieldAPISecret, "AnotherSecret")
	payload, headers := paypaytest.Notification(t, "transaction.completed.json", map[string]any{"merchant_order_id": "credentials0123456789abcdef01234"})
	if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrCredentialsRefused) {
		t.Fatalf("ParseNotification error = %v, want ErrCredentialsRefused", err)
	}
}

func TestParseNotificationOfAMalformedPayloadIsMalformed(t *testing.T) {
	_, provider := newAPI(t)
	for name, payload := range map[string]string{
		"not JSON":             `{`,
		"no merchant_order_id": `{"notification_type":"Transaction","state":"COMPLETED"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := provider.ParseNotification(t.Context(), []byte(payload), nil, testCredentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
				t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
			}
		})
	}
}

func TestARefundPayPayHasNotMadeYetIsPendingUntilItSettles(t *testing.T) {
	for name, fail := range map[string]bool{"made": false, "failed": true} {
		t.Run(name, func(t *testing.T) {
			api, provider := newAPI(t)
			const checkoutID = "pending0123456789abcdef012345678"
			api.Pay(testCredentials, checkoutID, 500, "JPY", time.Now())
			api.HoldNextRefund(testCredentials, checkoutID)
			const key = "publira-purchase-refund-00000000-0000-0000-0000-000000000000-1"
			if refunded, err := provider.Refund(t.Context(), testCredentials, paymentprovider.RefundRequest{PaymentID: checkoutID, IdempotencyKey: key, Amount: 200}); err != nil || !refunded {
				t.Fatalf("Refund = %v, %v; want true, nil", refunded, err)
			}
			if _, err := provider.ParseNotification(t.Context(), provider.RefundNotification(checkoutID), nil, testCredentials); !errors.Is(err, paymentprovider.ErrRefundPending) {
				t.Fatalf("ParseNotification of a refund not made yet: error = %v, want ErrRefundPending", err)
			}
			// Asked for again, the refund PayPay accepted is the one reported.
			if refunded, err := provider.Refund(t.Context(), testCredentials, paymentprovider.RefundRequest{PaymentID: checkoutID, IdempotencyKey: key, Amount: 200}); err != nil || !refunded {
				t.Fatalf("Refund again = %v, %v; want true, nil", refunded, err)
			}
			api.SettleRefunds(testCredentials, checkoutID, fail)
			event, err := provider.ParseNotification(t.Context(), provider.RefundNotification(checkoutID), nil, testCredentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			if fail {
				failed, ok := event.(paymentprovider.RefundFailed)
				if !ok || failed.AmountRefunded != 0 || failed.RefundKey != key {
					t.Fatalf("event = %+v, want the refund under %q failed with nothing refunded", event, key)
				}
				return
			}
			refunded, ok := event.(paymentprovider.Refunded)
			if !ok || refunded.PaymentID != checkoutID || refunded.AmountRefunded != 200 || refunded.Currency != "JPY" {
				t.Fatalf("event = %+v, want 200 JPY refunded on %q", event, checkoutID)
			}
		})
	}
}

func TestMerchantRefundIDNamesTheRefundByItsKey(t *testing.T) {
	const staffKey = "publira-purchase-refund-00000000-0000-0000-0000-000000000000-12"
	if got := paypay.MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: staffKey, Amount: 100}); got != "k"+staffKey {
		t.Fatalf("merchantRefundId of a staff refund of an amount = %q, want the key behind k", got)
	}
	if got := paypay.MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: staffKey}); got != "r"+staffKey {
		t.Fatalf("merchantRefundId of a staff refund of the rest = %q, want the key behind r", got)
	}
	long := strings.Repeat("x", 64)
	hashed := paypay.MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: long, Amount: 100})
	if !strings.HasPrefix(hashed, "h") || len(hashed) != 41 {
		t.Fatalf("merchantRefundId of a key that does not fit = %q, want 40 hexadecimal digits behind h", hashed)
	}
	if hashed == paypay.MerchantRefundID(paymentprovider.RefundRequest{IdempotencyKey: long}) {
		t.Fatal("a refund of an amount and one of the rest under the same long key share a merchantRefundId")
	}
}
