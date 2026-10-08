// Package loginguard bounds how often a password may be tried at sign-in.
//
// The Login RPCs of the public API, the tenant console and the platform console
// verify a password against an address anyone can type, so each of them is a
// place to guess one account's password, or to try one password against many
// addresses, at whatever rate the server answers — and every guess costs the
// server a bcrypt verification.
//
// Two allowances stand in front of every verification. One belongs to the
// address within its scope, so guessing one account's password stops. The other
// belongs to the request's origin, so the same stranger cannot spread the
// guessing over addresses and tenants instead.
//
// Both are charged before the address is looked up, so the refusal cannot
// depend on whether an account exists and an attempt past either allowance costs
// no bcrypt and reads no row.
package loginguard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/requestmeta"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// PlatformScope is the scope of the platform console's sign-in, which belongs
// to no tenant.
const PlatformScope = "platform"

// Guard is the limit the Login RPCs charge against.
type Guard struct {
	limiter *ratelimit.Limiter
	policy  platformpolicy.Source
	logger  *slog.Logger
}

// New returns a guard that charges limiter against the login limits of the
// platform policy.
func New(limiter *ratelimit.Limiter, policy platformpolicy.Source, logger *slog.Logger) *Guard {
	if logger == nil {
		logger = slog.Default()
	}
	return &Guard{limiter: limiter, policy: policy, logger: logger}
}

// NewShared returns a guard over the counters the deployment shares, which are
// Redis's when PUBLIRA_REDIS_URL names one.
func NewShared(policy platformpolicy.Source, logger *slog.Logger) *Guard {
	return New(ratelimit.NewFromEnv(logger), policy, logger)
}

// NewDefault returns the guard a caller that reads no settings of its own gets:
// the built-in policy over in-process counters, rather than no limit at all.
func NewDefault() *Guard {
	return New(ratelimit.New(ratelimit.NewMemoryStore()), platformpolicy.Fixed(platformpolicy.Defaults()), nil)
}

// Attempt is one sign-in the guard let through to the password check.
type Attempt struct {
	guard   *Guard
	account string
	rules   []ratelimit.Rule
	source  ratelimit.Decision
}

// Begin spends one of the allowances standing in front of a password check for
// address within scope — the tenant's id, or [PlatformScope] — and reports what
// the handler should answer.
//
// It answers an Attempt while there is allowance left and a resource_exhausted
// error once there is not. That answer is the same one whichever allowance ran
// out and whatever the address turns out to be, so a handler calls it before it
// looks the address up.
//
// The origin is charged first. Its allowance is the one a stranger trying many
// addresses runs out of, and charging it first is what keeps them from spending
// the allowance of every address they name on the way there.
func (g *Guard) Begin(ctx context.Context, scope, address string) (*Attempt, error) {
	policy, err := g.policy.Policy(ctx)
	if err != nil {
		g.logger.ErrorContext(ctx, "failed to resolve the login rate limit", "scope", scope, "error", err)
		return nil, connect.NewError(connect.CodeInternal, "internal server error")
	}
	attempt := &Attempt{
		guard:   g,
		account: accountSubject(scope, address),
		rules:   minuteDayRules(policy.LoginAttemptsPerAccount),
	}
	for _, charge := range []struct {
		subject string
		rules   []ratelimit.Rule
		spent   *ratelimit.Decision
	}{
		{sourceSubject(requestmeta.ClientSourceFromContext(ctx)), hourDayRules(policy.LoginAttemptsPerSource), &attempt.source},
		{attempt.account, attempt.rules, nil},
	} {
		decision, err := g.limiter.Allow(ctx, charge.subject, charge.rules...)
		if err != nil {
			// The counters fall back to this process when the shared ones cannot
			// be reached, so nothing is left here that checking the password
			// anyway would be the safe answer to.
			g.logger.ErrorContext(ctx, "failed to charge the login rate limit", "scope", scope, "error", err)
			return nil, connect.NewError(connect.CodeInternal, "internal server error")
		}
		if !decision.Allowed {
			return nil, rpcerrors.NewRateLimitedError(ctx, decision.RetryAfter)
		}
		if charge.spent != nil {
			*charge.spent = decision
		}
	}
	return attempt, nil
}

// Verified records that the password was right. The address's count is cleared
// and the origin's charge for this attempt is given back, so what both
// allowances count is the guesses.
//
// The account's count is cleared rather than only refunded: reaching the
// password proves the caller was not guessing, and the typos before it stop
// standing against them. The origin's is only refunded, because one origin may
// be signing in to an account it holds while guessing at every other.
//
// It is called once the password is known to be right, whatever the handler
// answers after that — an unconfirmed address or an account with no role is
// still a password nobody had to guess.
func (a *Attempt) Verified(ctx context.Context) {
	a.guard.limiter.Reset(ctx, a.account, a.rules...)
	a.guard.limiter.Refund(ctx, a.source)
}

// accountSubject names the allowance of one address within scope.
//
// The scope is part of it: one address may hold an account on many tenants, and
// leaving the scope out would let guessing on one storefront lock its owner out
// of another. The storefront and the tenant console share a scope, because they
// sign in the same account, and two allowances for it would be two budgets to
// rotate between.
//
// The address reaches the key lowercased, trimmed and as a digest, so the
// counters hold nobody's address and no spelling of one address gets an
// allowance of its own. Unlike the mail guard, the sub-address tag is kept: an
// address with a tag is a different account here, not another way to reach the
// same inbox.
func accountSubject(scope, address string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(address))))
	return "login.account:" + scope + ":" + hex.EncodeToString(digest[:])
}

// sourceSubject names the origin's allowance. It leaves the scope out on
// purpose: what it bounds is one origin spreading its guesses across every
// tenant on the platform and the consoles alongside them.
func sourceSubject(source string) string {
	return "login.source:" + source
}

// minuteDayRules pairs a burst window per minute with a daily budget. The
// minute is what a person who mistyped runs into and gets past by waiting; the
// day is what a script pacing itself under the minute still meets.
func minuteDayRules(limit platformpolicy.MinuteDay) []ratelimit.Rule {
	return []ratelimit.Rule{
		{Limit: limit.PerMinute, Window: time.Minute},
		{Limit: limit.PerDay, Window: 24 * time.Hour},
	}
}

// hourDayRules pairs an hourly burst with a daily budget. An origin may be a
// network many people share, so its shortest window is long enough to hold
// their typos together.
func hourDayRules(limit platformpolicy.HourDay) []ratelimit.Rule {
	return []ratelimit.Rule{
		{Limit: limit.PerHour, Window: time.Hour},
		{Limit: limit.PerDay, Window: 24 * time.Hour},
	}
}
