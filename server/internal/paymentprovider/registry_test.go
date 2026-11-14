package paymentprovider

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

type declaredProvider struct {
	declaration Declaration
}

func (p declaredProvider) Declaration() Declaration { return p.declaration }

func (declaredProvider) StartCheckout(context.Context, Credentials, CheckoutRequest) (string, error) {
	return "", nil
}

func (declaredProvider) ParseNotification(context.Context, []byte, http.Header, Credentials) (Event, error) {
	return Ignored{}, nil
}

func (declaredProvider) Refund(context.Context, Credentials, RefundRequest) (bool, error) {
	return false, nil
}

func (declaredProvider) RefundMade(context.Context, Credentials, string, string) (bool, error) {
	return false, nil
}

func (declaredProvider) ListTransactions(context.Context, Credentials, time.Time, time.Time, []string) ([]Transaction, error) {
	return nil, nil
}

// followingProvider is a declaredProvider that follows its own refunds.
type followingProvider struct {
	declaredProvider
}

func (followingProvider) RefundNotification(string) []byte { return nil }

func TestRegistryLooksUpProvidersByID(t *testing.T) {
	registry := NewRegistry(
		declaredProvider{Declaration{ID: "zeta", Currencies: []string{"JPY"}}},
		declaredProvider{Declaration{ID: "alpha", Currencies: []string{"JPY"}}},
	)
	if _, ok := registry.Lookup("alpha"); !ok {
		t.Fatal("Lookup(alpha) found nothing")
	}
	if _, ok := registry.Lookup("beta"); ok {
		t.Fatal("Lookup(beta) found a provider that is not registered")
	}
	var ids []string
	for _, provider := range registry.Providers() {
		ids = append(ids, provider.Declaration().ID)
	}
	if len(ids) != 2 || ids[0] != "alpha" || ids[1] != "zeta" {
		t.Fatalf("Providers() ids = %v, want [alpha zeta]", ids)
	}
}

func TestRegistryRefusesAnIDThatCannotNameARouteSegment(t *testing.T) {
	for _, id := range []string{"", "Stripe", "pay/jp", "-stripe", "a-very-long-provider-id-past-32-chars"} {
		t.Run(id, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatalf("NewRegistry accepted id %q", id)
				}
			}()
			NewRegistry(declaredProvider{Declaration{ID: id, Currencies: []string{"JPY"}}})
		})
	}
}

func TestRegistryRefusesAnIDRegisteredTwice(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("NewRegistry accepted a duplicate id")
		}
	}()
	NewRegistry(declaredProvider{Declaration{ID: "stripe", Currencies: []string{"JPY"}}}, declaredProvider{Declaration{ID: "stripe", Currencies: []string{"JPY"}}})
}

func TestRegistryRefusesAFieldDeclaredSecretAndPublic(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("NewRegistry accepted a field that is both secret and public")
		}
	}()
	NewRegistry(declaredProvider{Declaration{ID: "stripe", Fields: []Field{{Name: "key", Secret: true, Public: true}}, Currencies: []string{"JPY"}}})
}

func TestRegistryRefusesAFieldDeclaredTwice(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("NewRegistry accepted a field declared twice")
		}
	}()
	NewRegistry(declaredProvider{Declaration{ID: "stripe", Fields: []Field{{Name: "key", Public: true}, {Name: "key", Secret: true}}, Currencies: []string{"JPY"}}})
}

func TestRegistryRefusesACurrencyThatIsNotAnISOCode(t *testing.T) {
	for name, currencies := range map[string][]string{
		"none":        nil,
		"lower case":  {"jpy"},
		"two letters": {"JP"},
		"a symbol":    {"¥"},
		"twice":       {"JPY", "USD", "JPY"},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatalf("NewRegistry accepted currencies %q", currencies)
				}
			}()
			NewRegistry(declaredProvider{Declaration{ID: "stripe", Currencies: currencies}})
		})
	}
}

func TestRegistryRefusesStoredCheckoutsWithoutALifetime(t *testing.T) {
	for name, declaration := range map[string]Declaration{
		"stored checkouts without a lifetime": {ID: "paypay", Currencies: []string{"JPY"}, StoredCheckouts: true},
		"a lifetime without stored checkouts": {ID: "paypay", Currencies: []string{"JPY"}, CheckoutLifetime: time.Hour},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatalf("NewRegistry accepted %+v", declaration)
				}
			}()
			NewRegistry(declaredProvider{declaration})
		})
	}
	NewRegistry(declaredProvider{Declaration{ID: "paypay", Currencies: []string{"JPY"}, StoredCheckouts: true, CheckoutLifetime: time.Hour}})
}

func TestRegistryRefusesARefundFollowerThatDeclaresASignatureHeader(t *testing.T) {
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("NewRegistry accepted a refund follower with a signature header")
			}
		}()
		NewRegistry(followingProvider{declaredProvider{Declaration{ID: "paypay", Currencies: []string{"JPY"}, SignatureHeader: "X-Signature"}}})
	}()
	NewRegistry(followingProvider{declaredProvider{Declaration{ID: "paypay", Currencies: []string{"JPY"}}}})
}

func TestStoredCheckoutIDNamesOneCheckoutPerKey(t *testing.T) {
	id := StoredCheckoutID("episode-checkout:a")
	if len(id) != 32 || strings.Trim(id, "0123456789abcdef") != "" {
		t.Fatalf("StoredCheckoutID = %q, want 32 lower-case hexadecimal digits", id)
	}
	if again := StoredCheckoutID("episode-checkout:a"); again != id {
		t.Fatalf("StoredCheckoutID of the same key = %q, then %q", id, again)
	}
	if other := StoredCheckoutID("episode-checkout:b"); other == id {
		t.Fatalf("StoredCheckoutID of two keys = %q", id)
	}
}

func TestDeclarationChargesOnlyItsCurrencies(t *testing.T) {
	declaration := Declaration{Currencies: []string{"JPY", "USD"}}
	for currency, want := range map[string]bool{"JPY": true, "USD": true, "EUR": false, "usd": false, "": false} {
		if got := declaration.Charges(currency); got != want {
			t.Errorf("Charges(%q) = %v, want %v", currency, got, want)
		}
	}
}

func TestDeclarationMissingNamesEmptyRequiredFields(t *testing.T) {
	declaration := Declaration{Fields: []Field{
		{Name: "secret", Secret: true, Required: true},
		{Name: "publishable", Public: true, Required: true},
		{Name: "optional"},
	}}
	missing := declaration.Missing(Credentials{"secret": "value", "optional": ""})
	if len(missing) != 1 || missing[0] != "publishable" {
		t.Fatalf("Missing = %v, want [publishable]", missing)
	}
}
