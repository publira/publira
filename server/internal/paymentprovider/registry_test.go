package paymentprovider

import (
	"context"
	"net/http"
	"testing"
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
