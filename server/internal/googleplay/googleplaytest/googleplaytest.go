// Package googleplaytest stands in for the Google Play Developer API with
// responses recorded from it, so a test can put a purchase in the store and
// watch what the server asks of it.
package googleplaytest

import (
	"embed"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/googleplay"
)

//go:embed testdata/*.json
var recorded embed.FS

// Recorded responses of purchases.products.get.
const (
	Purchased    = "purchased"
	TestPurchase = "test_purchase"
	Pending      = "pending"
	Consumed     = "consumed"
)

// Responses of purchases.subscriptionsv2.get, shaped as the API reference
// documents them.
const (
	SubscriptionActive       = "subscription_active"
	SubscriptionTestPurchase = "subscription_test_purchase"
	SubscriptionPending      = "subscription_pending"
	SubscriptionCanceled     = "subscription_canceled"
	SubscriptionGracePeriod  = "subscription_in_grace_period"
	SubscriptionOnHold       = "subscription_on_hold"
	SubscriptionExpired      = "subscription_expired"
)

// Server is a Google Play Developer API holding the purchases a test put.
type Server struct {
	*httptest.Server

	mu        sync.Mutex
	purchases map[string]map[string]any
	consumes  map[string]int
	// subscriptions and acknowledgements are keyed by package and token, which
	// is all subscriptionsv2 looks a subscription up by.
	subscriptions   map[string]map[string]any
	acknowledgments map[string]int
	voided          map[string][]map[string]any
	// VoidedRequests records the query of every Voided Purchases request.
	VoidedRequests []url.Values
}

// NewServer starts a server that answers the OAuth token exchange and the
// product purchase endpoints. It is closed when t ends.
func NewServer(t testing.TB) *Server {
	t.Helper()
	s := &Server{
		purchases:       map[string]map[string]any{},
		consumes:        map[string]int{},
		subscriptions:   map[string]map[string]any{},
		acknowledgments: map[string]int{},
		voided:          map[string][]map[string]any{},
	}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.Close)
	return s
}

// Client is a client that talks to this server.
func (s *Server) Client() *googleplay.Client {
	return googleplay.NewClient(googleplay.Config{Endpoint: s.URL, TokenURL: s.URL + "/token"})
}

// Put stores the recorded response named fixture as the purchase token made
// of productID in packageName, carrying accountID as the account the app set.
func (s *Server) Put(t testing.TB, packageName, productID, token, fixture, accountID string) {
	t.Helper()
	purchase := load(t, fixture)
	purchase["obfuscatedExternalAccountId"] = accountID
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purchases[key(packageName, productID, token)] = purchase
}

// PutSubscription stores the response named fixture as the subscription token
// was bought as in packageName: productID, paid for until expiry, carrying
// accountID as the account the app set.
func (s *Server) PutSubscription(t testing.TB, packageName, token, fixture, productID, accountID string, expiry time.Time) {
	t.Helper()
	subscription := load(t, fixture)
	subscription["externalAccountIdentifiers"] = map[string]any{"obfuscatedExternalAccountId": accountID}
	items := subscription["lineItems"].([]any)
	item := items[0].(map[string]any)
	item["productId"] = productID
	item["expiryTime"] = expiry.UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscriptions[packageName+"/"+token] = subscription
}

// LinkSubscription marks the subscription token as the one that replaced
// linkedToken, as Google Play does when the reader changes plans.
func (s *Server) LinkSubscription(packageName, token, linkedToken string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscriptions[packageName+"/"+token]["linkedPurchaseToken"] = linkedToken
}

// Acknowledgments counts the acknowledge requests the subscription token
// received.
func (s *Server) Acknowledgments(packageName, token string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.acknowledgments[packageName+"/"+token]
}

// Void records that Google Play voided the purchase token in packageName at
// voidedAt, shaped as the recorded Voided Purchases response is.
func (s *Server) Void(t testing.TB, packageName, token string, voidedAt time.Time) {
	t.Helper()
	entry := load(t, "voided_purchase")
	entry["purchaseToken"] = token
	entry["voidedTimeMillis"] = strconv.FormatInt(voidedAt.UnixMilli(), 10)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.voided[packageName] = append(s.voided[packageName], entry)
}

// Consumes counts the consume requests the purchase received.
func (s *Server) Consumes(packageName, productID, token string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.consumes[key(packageName, productID, token)]
}

func key(packageName, productID, token string) string {
	return packageName + "/" + productID + "/" + token
}

func load(t testing.TB, name string) map[string]any {
	t.Helper()
	body, err := recorded.ReadFile("testdata/" + name + ".json")
	if err != nil {
		t.Fatalf("read recorded response %s: %v", name, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode recorded response %s: %v", name, err)
	}
	return decoded
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/token" {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "test-access-token", "token_type": "Bearer", "expires_in": 3600})
		return
	}
	if r.Header.Get("Authorization") != "Bearer test-access-token" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	// /androidpublisher/v3/applications/{package}/purchases/voidedpurchases
	if packageName, ok := strings.CutSuffix(strings.TrimPrefix(r.URL.Path, "/androidpublisher/v3/applications/"), "/purchases/voidedpurchases"); ok {
		s.serveVoided(w, r, packageName)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/androidpublisher/v3/applications/"), "/")
	// /androidpublisher/v3/applications/{package}/purchases/subscriptionsv2/tokens/{token}
	if len(parts) == 5 && parts[1] == "purchases" && parts[2] == "subscriptionsv2" && parts[3] == "tokens" {
		s.serveSubscription(w, parts[0], parts[4], "", false)
		return
	}
	// /androidpublisher/v3/applications/{package}/purchases/subscriptions/{product}/tokens/{token}:acknowledge
	if len(parts) == 6 && parts[1] == "purchases" && parts[2] == "subscriptions" && parts[4] == "tokens" && r.Method == http.MethodPost {
		token, acknowledge := strings.CutSuffix(parts[5], ":acknowledge")
		if acknowledge {
			s.serveSubscription(w, parts[0], token, parts[3], true)
			return
		}
	}
	// /androidpublisher/v3/applications/{package}/purchases/products/{product}/tokens/{token}[:consume]
	if len(parts) != 6 || parts[1] != "purchases" || parts[2] != "products" || parts[4] != "tokens" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	token, consume := strings.CutSuffix(parts[5], ":consume")
	k := key(parts[0], parts[3], token)

	s.mu.Lock()
	defer s.mu.Unlock()
	purchase, ok := s.purchases[k]
	if !ok {
		body, _ := recorded.ReadFile("testdata/not_found.json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write(body)
		return
	}
	if consume && r.Method == http.MethodPost {
		s.consumes[k]++
		purchase["consumptionState"] = googleplay.ConsumptionStateConsumed
		purchase["acknowledgementState"] = 1
		return
	}
	_ = json.NewEncoder(w).Encode(purchase)
}

// serveSubscription answers the subscription a token names, or acknowledges
// it as productID, which has to be the product it subscribes to.
func (s *Server) serveSubscription(w http.ResponseWriter, packageName, token, productID string, acknowledge bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := packageName + "/" + token
	subscription, ok := s.subscriptions[k]
	if ok && acknowledge {
		item := subscription["lineItems"].([]any)[0].(map[string]any)
		ok = item["productId"] == productID
	}
	if !ok {
		body, _ := recorded.ReadFile("testdata/not_found.json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write(body)
		return
	}
	if acknowledge {
		s.acknowledgments[k]++
		subscription["acknowledgementState"] = googleplay.AcknowledgementStateAcknowledged
		return
	}
	_ = json.NewEncoder(w).Encode(subscription)
}

// serveVoided answers one voided purchase per page, so a client that reads
// only the first page misses the rest.
func (s *Server) serveVoided(w http.ResponseWriter, r *http.Request, packageName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.VoidedRequests = append(s.VoidedRequests, r.URL.Query())
	since, _ := strconv.ParseInt(r.URL.Query().Get("startTime"), 10, 64)
	until, _ := strconv.ParseInt(r.URL.Query().Get("endTime"), 10, 64)
	var matching []map[string]any
	for _, entry := range s.voided[packageName] {
		at, _ := strconv.ParseInt(entry["voidedTimeMillis"].(string), 10, 64)
		if at >= since && at <= until {
			matching = append(matching, entry)
		}
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("token"))
	response := map[string]any{}
	if offset < len(matching) {
		response["voidedPurchases"] = matching[offset : offset+1]
		if offset+1 < len(matching) {
			response["tokenPagination"] = map[string]string{"nextPageToken": strconv.Itoa(offset + 1)}
		}
	}
	_ = json.NewEncoder(w).Encode(response)
}
