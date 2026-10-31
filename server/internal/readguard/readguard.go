// Package readguard bounds how fast one client may read what publira server
// answers anyone: the public API, its catalog search, and a tenant's images.
//
// The edge in front of an install limits the same reads first, and refuses
// them before they cost anything. This is the limit behind it, so that an edge
// which limits nothing — the stock caddy image, a WAF rule never written, a
// router added without its limit — leaves the server looser than it should be
// rather than open. Its allowances are the platform policy's anonymous read
// limits, which are never tighter than the edge's, so a reader behind a
// working edge is refused by the edge first.
//
// A client is the address internal/clientip resolves, and the counters are the
// ones internal/ratelimit keeps, in Redis when the deployment names one, so
// every instance of the server counts a client together.
package readguard

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
)

// Allowance is one budget a client spends its reads from.
type Allowance string

const (
	// PublicAPI is platformpolicy.ReadLimits.PublicAPI.
	PublicAPI Allowance = "public_api"
	// Search is platformpolicy.ReadLimits.Search.
	Search Allowance = "search"
	// Images is platformpolicy.ReadLimits.Images.
	Images Allowance = "images"
)

// Limit is how many reads of allowance limits gives one client in a
// platformpolicy.ReadWindow.
func Limit(limits platformpolicy.ReadLimits, allowance Allowance) int {
	switch allowance {
	case Search:
		return limits.Search
	case Images:
		return limits.Images
	default:
		return limits.PublicAPI
	}
}

// Guard charges a client's reads against its allowances.
type Guard struct {
	limiter *ratelimit.Limiter
	policy  platformpolicy.Source
}

// New returns a guard that keeps its counters in limiter and charges them
// against the anonymous read limits of policy.
func New(limiter *ratelimit.Limiter, policy platformpolicy.Source) *Guard {
	return &Guard{limiter: limiter, policy: policy}
}

// NewFromEnv returns the guard a server process uses, over the counters every
// instance shares when the deployment names a Redis.
func NewFromEnv(policy platformpolicy.Source, logger *slog.Logger) *Guard {
	return New(ratelimit.NewFromEnv(logger), policy)
}

// NewDefault returns a guard over the built-in policy and counters kept in
// this process alone, for a caller that was handed none: no guard at all would
// take the limit off silently.
func NewDefault() *Guard {
	return New(ratelimit.New(ratelimit.NewMemoryStore()), platformpolicy.Fixed(platformpolicy.Defaults()))
}

// Allow charges one read of allowance by the client ctx was resolved for, and
// reports whether the client may make it.
//
// A request from inside the install, which is every call a web app makes as
// itself, is not charged: it is every reader of that app at once, and counting
// it as one client would refuse all of them when the busiest page filled the
// allowance. What such a call reads on a reader's behalf is the app's to
// bound, in front of the call, as web-storefront bounds its search page.
func (g *Guard) Allow(ctx context.Context, allowance Allowance) (ratelimit.Decision, error) {
	if clientip.InternalFromContext(ctx) {
		return ratelimit.Decision{Allowed: true}, nil
	}
	policy, err := g.policy.Policy(ctx)
	if err != nil {
		return ratelimit.Decision{}, fmt.Errorf("resolve the read limits: %w", err)
	}
	rule := ratelimit.Rule{
		Limit:  Limit(policy.AnonymousReads, allowance),
		Window: platformpolicy.ReadWindow,
	}
	// The tenant is left out of the subject, the way the other per-client
	// limits leave it out: what this bounds is one client spreading the same
	// reads over every tenant on the platform.
	return g.limiter.Allow(ctx, "read."+string(allowance)+"|"+clientip.FromContext(ctx), rule)
}
