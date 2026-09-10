// Package mailguard bounds the mail a form can cause.
//
// A handful of forms make a server send mail to an address the request never
// proved anything about: the sign-up form mails whichever address it is given,
// and so do the password reset, the resend of a verification link, and the
// address a member wants to move their account to. None of them can refuse an
// address without saying whether it is registered, which is exactly what those
// forms are written not to disclose, so the only thing left to bound is how
// much mail one of them may cause.
//
// Two allowances stand in front of every such send. One belongs to the mailbox,
// so a stranger cannot turn a form into a flood aimed at somebody's inbox. The
// other belongs to the request's origin, so the same stranger cannot spread the
// same flood over addresses and tenants until the mail server's quota is gone.
//
// Both are charged before anything is written, so a request over either one
// leaves no row behind at all rather than an outbox event a worker has to
// recognize and drop later.
package mailguard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"strings"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// PlatformScope is the scope of the platform console's own forms, which belong
// to no tenant.
const PlatformScope = "platform"

// Guard is the flood control the mail-causing forms charge against.
type Guard struct {
	limiter    *ratelimit.Limiter
	perAddress []ratelimit.Rule
	perSource  []ratelimit.Rule
	logger     *slog.Logger
}

// New returns a guard that charges limiter against the rules given.
func New(limiter *ratelimit.Limiter, perAddress, perSource []ratelimit.Rule, logger *slog.Logger) *Guard {
	if logger == nil {
		logger = slog.Default()
	}
	return &Guard{limiter: limiter, perAddress: perAddress, perSource: perSource, logger: logger}
}

// Allow spends one of the allowances standing in front of the mail address
// would receive, and reports what the handler should answer.
//
// It answers nil while there is allowance left and a resource_exhausted error
// once there is not. That answer is the same one whichever allowance ran out
// and whatever the address turns out to be, so a caller held off here learns
// nothing the form itself would not have told them.
//
// A handler charges before it looks the address up, so the refusal cannot
// depend on whether an account exists — the whole point of the forms this
// guards — and nothing is written on the way to it.
//
// The origin is charged first. Its allowance is the one a stranger runs out of,
// and charging it first is what keeps them from spending the mailbox allowance
// of every address they name on the way there.
func (g *Guard) Allow(ctx context.Context, req connect.AnyRequest, scope, address string) error {
	for _, charge := range []struct {
		subject string
		rules   []ratelimit.Rule
	}{
		{sourceSubject(source(req)), g.perSource},
		{addressSubject(scope, address), g.perAddress},
	} {
		decision, err := g.limiter.Allow(ctx, charge.subject, charge.rules...)
		if err != nil {
			// The rules are validated at startup and the counters fall back to
			// this process when the shared ones cannot be reached, so nothing is
			// left here that sending the mail anyway would be the safe answer to.
			g.logger.ErrorContext(ctx, "failed to charge the mail rate limit", "scope", scope, "error", err)
			return connect.NewError(connect.CodeInternal, errors.New("internal server error"))
		}
		if !decision.Allowed {
			return rpcerrors.NewRateLimitedError(decision.RetryAfter)
		}
	}
	return nil
}

// addressSubject names the mailbox's allowance.
//
// The scope is part of it. A mailbox holds one inbox however many storefronts
// know it, so leaving the scope out would protect that inbox best — and would
// also let traffic aimed at one storefront's sign-up form use up the allowance
// the reader of another needs for their own password reset. The origin's
// allowance is the one that bounds the total across scopes.
//
// The address reaches the key as a digest, so the counters hold nobody's
// address, and it is folded to lower case first: a mailbox written two ways is
// one inbox and gets one allowance.
func addressSubject(scope, address string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(address))))
	return "mail.address:" + scope + ":" + hex.EncodeToString(digest[:])
}

// sourceSubject names the origin's allowance. It leaves the scope out on
// purpose: what it bounds is one origin spreading its traffic across every
// tenant on the platform and the console alongside them.
func sourceSubject(source string) string {
	return "mail.source:" + source
}

// source names where a request came from. The edge records the caller in
// X-Forwarded-For; the peer is what is left for a request that reached a server
// without passing one.
//
// The peer's port is dropped. It is a fresh number on every connection, so an
// allowance keyed on it would be one nobody ever spends twice.
func source(req connect.AnyRequest) string {
	if ip := auditlog.ClientIPFromHeader(req.Header()); ip != "" {
		return ip
	}
	addr := req.Peer().Addr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// Rules pairs an hourly burst with a daily budget. The hour is what a person
// resending themselves a link runs into and what a script empties in a breath;
// the day is what the script pacing itself under the hour still meets.
func Rules(perHour, perDay int) []ratelimit.Rule {
	return []ratelimit.Rule{
		{Limit: perHour, Window: time.Hour},
		{Limit: perDay, Window: 24 * time.Hour},
	}
}
