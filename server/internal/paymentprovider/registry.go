package paymentprovider

import (
	"fmt"
	"regexp"
	"slices"
)

// idPattern keeps a provider id usable as one path segment of the webhook
// route.
var idPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// Registry is the set of providers a tenant may choose from, keyed by id.
type Registry struct {
	providers map[string]Provider
	ids       []string
}

// NewRegistry registers providers, and panics on an id that is malformed or
// registered twice: either is a programming error in the provider list.
func NewRegistry(providers ...Provider) *Registry {
	r := &Registry{providers: make(map[string]Provider, len(providers))}
	for _, provider := range providers {
		id := provider.Declaration().ID
		if !idPattern.MatchString(id) {
			panic(fmt.Sprintf("paymentprovider: provider id %q is not a valid id", id))
		}
		if _, ok := r.providers[id]; ok {
			panic(fmt.Sprintf("paymentprovider: provider %q is registered twice", id))
		}
		r.providers[id] = provider
		r.ids = append(r.ids, id)
	}
	slices.Sort(r.ids)
	return r
}

// Lookup answers the provider registered under id.
func (r *Registry) Lookup(id string) (Provider, bool) {
	provider, ok := r.providers[id]
	return provider, ok
}

// Providers answers every registered provider in id order.
func (r *Registry) Providers() []Provider {
	providers := make([]Provider, 0, len(r.ids))
	for _, id := range r.ids {
		providers = append(providers, r.providers[id])
	}
	return providers
}
