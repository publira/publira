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

// Server is a Google Play Developer API holding the purchases a test put.
type Server struct {
	*httptest.Server

	mu        sync.Mutex
	purchases map[string]map[string]any
	consumes  map[string]int
	voided    map[string][]map[string]any
	// VoidedRequests records the query of every Voided Purchases request.
	VoidedRequests []url.Values
}

// NewServer starts a server that answers the OAuth token exchange and the
// product purchase endpoints. It is closed when t ends.
func NewServer(t testing.TB) *Server {
	t.Helper()
	s := &Server{purchases: map[string]map[string]any{}, consumes: map[string]int{}, voided: map[string][]map[string]any{}}
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
	// /androidpublisher/v3/applications/{package}/purchases/products/{product}/tokens/{token}[:consume]
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/androidpublisher/v3/applications/"), "/")
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
