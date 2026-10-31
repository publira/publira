// Package readguard bounds how fast one client may read what publira server
// answers anyone: the public API, its catalog search, and a tenant's images.
//
// The edge in front of an install limits the same reads first, and refuses
// them before they cost anything. This is the limit behind it, so that an edge
// which limits nothing — the stock caddy image, a WAF rule never written, a
// router added without its limit — leaves the server looser than it should be
// rather than open. Its allowances are therefore wider than the edge's, and a
// reader behind a working edge is refused by the edge first.
//
// A client is the address internal/clientip resolves, and the counters are the
// ones internal/ratelimit keeps, in Redis when the deployment names one, so
// every instance of the server counts a client together.
package readguard

import (
	"context"
	"log/slog"
	"time"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/ratelimit"
)

// Allowance is one budget a client spends its reads from.
type Allowance string

const (
	// PublicAPI is every publira.v1 procedure but the catalog search.
	PublicAPI Allowance = "public_api"
	// Search is the catalog search procedures, CatalogService's
	// SearchPublished…. Each runs the most expensive query a reader can ask
	// for, so it has a budget of its own, which a client that has spent the
	// public API's still has, and the other way round.
	Search Allowance = "search"
	// Images is the image routes of a tenant's site and image hosts.
	Images Allowance = "images"
)

// Rate is an allowance as the edge writes it: a burst a client may send at
// once, refilled at a rate per second.
type Rate struct {
	Burst     int
	PerSecond int
}

// EdgeRates are the allowances `infra/proxy/README.md` (Request rates) gives
// the edge, which the server's allowances are derived from so that they are
// never the tighter of the two.
var EdgeRates = map[Allowance]Rate{
	PublicAPI: {Burst: 120, PerSecond: 20},
	Search:    {Burst: 20, PerSecond: 2},
	Images:    {Burst: 600, PerSecond: 60},
}

// window is the one window the server counts a client's reads in. One rule
// rather than a burst and a budget is one counter, and so one round trip to
// Redis, on every read the server answers: a limit that doubled the cost of
// each image would be paid by every reader to slow down a few.
const window = 10 * time.Second

// headroom is how far past the edge the server's allowance reaches. The edge
// admits at most a burst and what its rate refills in a window, and the server
// counts more than the edge sees: the calls web-storefront makes for a
// signed-in reader carry the reader's address, and arrive on top of what the
// reader asked the edge for directly.
const headroom = 2

// Rule is the window the server counts a client's reads of allowance in.
func Rule(allowance Allowance) ratelimit.Rule {
	rate := EdgeRates[allowance]
	return ratelimit.Rule{
		Limit:  headroom * (rate.Burst + rate.PerSecond*int(window/time.Second)),
		Window: window,
	}
}

// Guard charges a client's reads against its allowances.
type Guard struct {
	limiter *ratelimit.Limiter
}

// New returns a guard that keeps its counters in limiter.
func New(limiter *ratelimit.Limiter) *Guard {
	return &Guard{limiter: limiter}
}

// NewFromEnv returns the guard a server process uses, over the counters every
// instance shares when the deployment names a Redis.
func NewFromEnv(logger *slog.Logger) *Guard {
	return New(ratelimit.NewFromEnv(logger))
}

// NewDefault returns a guard over counters kept in this process alone, for a
// caller that was handed none: no guard at all would take the limit off
// silently.
func NewDefault() *Guard {
	return New(ratelimit.New(ratelimit.NewMemoryStore()))
}

// Allow charges one read of allowance by the client ctx was resolved for, and
// reports whether the client may make it.
//
// A request from inside the install, which is every call a web app makes as
// itself, is not charged: it is every reader of that app at once, and counting
// it as one client would refuse all of them when the busiest page filled the
// allowance. What such a call reads on a reader's behalf is the app's to
// bound, in front of the call; web-storefront's search page is not bounded
// there yet (#5182).
func (g *Guard) Allow(ctx context.Context, allowance Allowance) (ratelimit.Decision, error) {
	if clientip.InternalFromContext(ctx) {
		return ratelimit.Decision{Allowed: true}, nil
	}
	// The tenant is left out of the subject, the way the other per-client
	// limits leave it out: what this bounds is one client spreading the same
	// reads over every tenant on the platform.
	return g.limiter.Allow(ctx, "read."+string(allowance)+"|"+clientip.FromContext(ctx), Rule(allowance))
}
