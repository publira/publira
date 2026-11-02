package appstoretest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/publira/publira/server/internal/appstore"
)

// History fakes the transaction history endpoint of the App Store Server API.
// Each transaction a test puts belongs to the customer it names, and a history
// asked for with any of a customer's transactions answers every transaction
// of that customer purchased within the range, signed by the Signer, one per
// page so that a client that reads only the first page misses the rest.
type History struct {
	server *httptest.Server
	signer *Signer

	mu           sync.Mutex
	transactions map[string][]historyEntry
}

type historyEntry struct {
	customer    string
	transaction Transaction
}

// NewHistory starts a fake whose transactions signer signs, serving until t
// ends.
func NewHistory(t testing.TB, signer *Signer) *History {
	t.Helper()
	h := &History{signer: signer, transactions: map[string][]historyEntry{}}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.serve(t, w, r)
	}))
	t.Cleanup(h.server.Close)
	return h
}

// Client answers a client whose production and sandbox endpoints are both
// this fake. A transaction's environment keeps the two apart.
func (h *History) Client() *appstore.Client {
	return appstore.NewClient(appstore.Config{ProductionEndpoint: h.server.URL + "/" + appstore.EnvironmentProduction, SandboxEndpoint: h.server.URL + "/" + appstore.EnvironmentSandbox})
}

// Put adds transaction to the history of customer.
func (h *History) Put(customer string, transaction Transaction) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.transactions[transaction.Environment] = append(h.transactions[transaction.Environment], historyEntry{customer: customer, transaction: transaction})
}

func (h *History) serve(t testing.TB, w http.ResponseWriter, r *http.Request) {
	environment, rest, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	transactionID, ok := strings.CutPrefix(rest, "inApps/v2/history/")
	if !ok || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	query := r.URL.Query()
	from, _ := strconv.ParseInt(query.Get("startDate"), 10, 64)
	to, _ := strconv.ParseInt(query.Get("endDate"), 10, 64)
	offset, _ := strconv.Atoi(query.Get("revision"))

	h.mu.Lock()
	entries := h.transactions[environment]
	customer := ""
	for _, entry := range entries {
		if entry.transaction.TransactionID == transactionID {
			customer = entry.customer
		}
	}
	var matching []Transaction
	for _, entry := range entries {
		at := entry.transaction.PurchaseDate
		if customer != "" && entry.customer == customer && at >= from && at < to && entry.transaction.Type == appstore.TypeConsumable {
			matching = append(matching, entry.transaction)
		}
	}
	h.mu.Unlock()
	if customer == "" {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	page := map[string]any{"signedTransactions": []string{}, "hasMore": false, "revision": strconv.Itoa(offset)}
	if offset < len(matching) {
		page["signedTransactions"] = []string{h.signer.Sign(t, matching[offset])}
		page["revision"] = strconv.Itoa(offset + 1)
		page["hasMore"] = offset+1 < len(matching)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(page)
}
