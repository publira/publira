// Package loginguard bounds how often a password may be tried at sign-in.
//
// The Login RPCs of the public API, the tenant console and the platform console
// verify a password against an address anyone can type, so each of them is a
// place to guess one account's password, or to try one password against many
// addresses, at whatever rate the server answers — and every guess costs the
// server a bcrypt verification.
//
// Allowances stand in front of every verification. One belongs to the
// request's origin, so the same stranger cannot spread their guessing over
// addresses and tenants. The others belong to the address within its scope, and
// which of them an attempt spends depends on where it comes from:
//
//   - A device that signed in to the address before presents the token that
//     sign-in answered, and spends an allowance of that device's own.
//   - Any other attempt spends one held by the address and its origin
//     together, and one held by the address alone, which every such attempt
//     shares.
//
// The split is what keeps the limit from being a way to lock an account out. An
// allowance a stranger can spend on the owner's behalf is one they can spend
// until the owner is refused, so a stranger at one origin spends the address's
// allowance at that origin and no other, and however many origins they spread
// over, the allowance the address alone holds refuses only devices that never
// signed in to it.
//
// Every allowance is charged before the address is looked up, so the refusal
// cannot depend on whether an account exists and an attempt past one costs no
// bcrypt and reads no row. The device token is checked by its signature alone
// for the same reason.
//
// A password asked for again on top of a session is bounded here too, by
// [Guard.ChargeStepUp]: a session is a place to guess the password of the
// account it belongs to, so the account holds an allowance of its own for it.
// It lives beside the sign-in limit so that one guard, shared by every API a
// process serves, holds both.
package loginguard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// PlatformScope is the scope of the platform console's sign-in, which belongs
// to no tenant.
const PlatformScope = "platform"

// unseenOrigins is how many origins' worth of the per-address allowance the
// attempts from devices an address has never signed in from share before that
// allowance refuses them.
//
// It is a multiple of the policy's per-address allowance rather than a policy of
// its own because it is the same decision seen from the other side: how many
// guesses an address can take from strangers spreading over origins, which has
// to be enough origins that one stranger cannot cheaply reach it, and few enough
// that a password nobody can guess in a day stays out of a botnet's reach. An
// owner it does refuse still signs in from any device they signed in from
// before, and an operator can lift it with `publiractl operator unlock-sign-in`
// or `publiractl tenant member unlock-sign-in`.
const unseenOrigins = 10

// generationTTL is how long a lift lasts. It has to outlast the longest window
// any allowance of an address is charged against, the day: a generation that
// expired while a counter charged under the one before it was still running
// would bring that counter back.
const generationTTL = 48 * time.Hour

// Guard is the limit the Login RPCs charge against.
type Guard struct {
	limiter *ratelimit.Limiter
	policy  platformpolicy.Source
	devices *auth.TokenManager
	logger  *slog.Logger
	now     func() time.Time
}

// New returns a guard that charges limiter against the login limits of the
// platform policy, and that tells known devices by the tokens devices signs.
// A nil devices issues no device token and treats every attempt as one from a
// device never seen.
func New(limiter *ratelimit.Limiter, policy platformpolicy.Source, devices *auth.TokenManager, logger *slog.Logger) *Guard {
	if logger == nil {
		logger = slog.Default()
	}
	return &Guard{limiter: limiter, policy: policy, devices: devices, logger: logger, now: time.Now}
}

// NewShared returns a guard over the counters the deployment shares, which are
// Redis's when PUBLIRA_REDIS_URL names one.
func NewShared(policy platformpolicy.Source, devices *auth.TokenManager, logger *slog.Logger) *Guard {
	return New(ratelimit.NewFromEnv(logger), policy, devices, logger)
}

// NewDefault returns the guard a caller that reads no settings of its own gets:
// the built-in policy over in-process counters, rather than no limit at all.
func NewDefault(devices *auth.TokenManager) *Guard {
	return New(ratelimit.New(ratelimit.NewMemoryStore()), platformpolicy.Fixed(platformpolicy.Defaults()), devices, nil)
}

// Attempt is one sign-in the guard let through to the password check.
type Attempt struct {
	guard   *Guard
	address string
	// own names the allowance of this attempt's own: the device's, or the
	// address's at the attempt's origin.
	own   string
	rules []ratelimit.Rule
	// source and shared are what the attempt spent of the origin's allowance
	// and of the one every unseen device shares, for Verified to give back.
	source ratelimit.Decision
	shared ratelimit.Decision
}

// Begin spends the allowances standing in front of a password check for address
// within scope — the tenant's id, or [PlatformScope] — and reports what the
// handler should answer. deviceToken is the token the previous sign-in from the
// caller's device answered, or empty; one that does not verify for this address
// is the same as none, so a stale or forged token costs the caller nothing but
// the allowance of a device never seen.
//
// It answers an Attempt while there is allowance left and a resource_exhausted
// error once there is not. That answer is the same one whichever allowance ran
// out and whatever the address turns out to be, so a handler calls it before it
// looks the address up.
//
// The origin is charged first. Its allowance is the one a stranger trying many
// addresses runs out of, and charging it first is what keeps them from spending
// the allowance of every address they name on the way there. For the same
// reason the address's allowance at the origin is charged before the one the
// address shares: one origin can spend no more of the shared one than its own
// allowance lets it.
func (g *Guard) Begin(ctx context.Context, scope, address, deviceToken string) (*Attempt, error) {
	policy, err := g.policy.Policy(ctx)
	if err != nil {
		g.logger.ErrorContext(ctx, "failed to resolve the login rate limit", "scope", scope, "error", err)
		return nil, connect.NewError(connect.CodeInternal, "internal server error")
	}
	name := addressName(scope, address)
	generation, err := g.limiter.Generation(ctx, generationName(name))
	if err != nil {
		g.logger.ErrorContext(ctx, "failed to read the login rate limit", "scope", scope, "error", err)
		return nil, connect.NewError(connect.CodeInternal, "internal server error")
	}
	current := name + ":" + strconv.FormatInt(generation, 10)
	source := clientip.FromContext(ctx)
	attempt := &Attempt{
		guard:   g,
		address: name,
		own:     "login.account_source:" + current + ":" + source,
		rules:   minuteDayRules(policy.LoginAttemptsPerAccount),
	}
	type charge struct {
		subject string
		rules   []ratelimit.Rule
		spent   *ratelimit.Decision
	}
	charges := []charge{
		{sourceSubject(source), hourDayRules(policy.LoginAttemptsPerSource), &attempt.source},
	}
	if device := g.device(name, deviceToken); device != "" {
		attempt.own = "login.device:" + current + ":" + device
		charges = append(charges, charge{attempt.own, attempt.rules, nil})
	} else {
		charges = append(charges,
			charge{attempt.own, attempt.rules, nil},
			charge{"login.account:" + current, unseenRules(policy.LoginAttemptsPerAccount), &attempt.shared},
		)
	}
	for _, charge := range charges {
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

// device answers the device token names when it is one signed for the address
// name names, and empty otherwise.
func (g *Guard) device(name, token string) string {
	if g.devices == nil || strings.TrimSpace(token) == "" {
		return ""
	}
	device, err := g.devices.VerifyLoginDeviceToken(token, name)
	if err != nil {
		return ""
	}
	return device
}

// Verified records that the password was right, and answers the token the
// handler hands the caller's device for its next sign-in to this address, or
// nil when none could be signed.
//
// The attempt's own count is cleared, and what it spent of the origin's
// allowance and of the one unseen devices share is given back, so what every
// allowance counts is the guesses. Only the attempt's own is cleared: reaching
// the password proves this caller was not guessing, and their typos before it
// stop standing against them, but it proves nothing about the attempts other
// origins made at the same address, or other addresses from the same origin.
//
// It is called once the password is known to be right, whatever the handler
// answers after that — an unconfirmed address or an account with no role is
// still a password nobody had to guess. The handler puts the device on every
// answer that carries the password's success, a challenge for a second factor
// included: the token vouches for the password alone.
func (a *Attempt) Verified(ctx context.Context) *publirattypesv1.LoginDevice {
	a.guard.limiter.Reset(ctx, a.own, a.rules...)
	a.guard.limiter.Refund(ctx, a.source)
	a.guard.limiter.Refund(ctx, a.shared)
	if a.guard.devices == nil {
		return nil
	}
	token, expiresAt, err := a.guard.devices.IssueLoginDeviceToken(a.address, a.guard.now())
	if err != nil {
		// The sign-in goes on without one: the device is then one never seen,
		// which is what it was before this attempt too.
		a.guard.logger.ErrorContext(ctx, "failed to sign the login device token", "error", err)
		return nil
	}
	return &publirattypesv1.LoginDevice{Token: token, ExpiresAt: auth.FormatExpiresAt(expiresAt)}
}

// ChargeStepUp spends one of the allowances standing in front of a password
// checked on top of a session — or a code of the account's second factor —
// for accountID within scope, the tenant's id or [PlatformScope], and answers
// resource_exhausted once there are none left.
//
// It is charged against the account rather than an address or an origin: the
// session already says whose secret is being checked, and the caller holding it
// is the one the limit is for. Every RPC that checks one spends this same
// allowance, on the storefront and in both consoles, because a budget per RPC
// or per surface would hand a guesser one of each to rotate between. The
// storefront and the tenant console sign in the same account, so they share a
// scope as they do at sign-in.
//
// A handler calls it after the checks that refuse on what the caller typed
// rather than on the secret, so a request those refuse costs no allowance, and
// before the verification, so one past the limit costs no bcrypt and reaches no
// row. resource_exhausted is what tells the refusal apart from the
// invalid_argument a wrong password gets, so a client can ask the person to
// come back later instead of telling someone who typed it correctly that it is
// wrong.
func (g *Guard) ChargeStepUp(ctx context.Context, scope, accountID string) error {
	rules, err := g.stepUpRules(ctx, scope)
	if err != nil {
		return err
	}
	decision, err := g.limiter.Allow(ctx, stepUpSubject(scope, accountID), rules...)
	if err != nil {
		g.logger.ErrorContext(ctx, "failed to charge the password verification rate limit", "scope", scope, "error", err)
		return connect.NewError(connect.CodeInternal, "internal server error")
	}
	if !decision.Allowed {
		return rpcerrors.NewRateLimitedError(ctx, decision.RetryAfter)
	}
	return nil
}

// ClearStepUp gives the account back everything [Guard.ChargeStepUp] has cost
// it, once a check it let through verified. The limit bounds guessing, and the
// caller who knew the secret was not guessing; holding the count past it would
// lock an account out of its own settings over typos.
func (g *Guard) ClearStepUp(ctx context.Context, scope, accountID string) {
	rules, err := g.stepUpRules(ctx, scope)
	if err != nil {
		return
	}
	g.limiter.Reset(ctx, stepUpSubject(scope, accountID), rules...)
}

func (g *Guard) stepUpRules(ctx context.Context, scope string) ([]ratelimit.Rule, error) {
	policy, err := g.policy.Policy(ctx)
	if err != nil {
		g.logger.ErrorContext(ctx, "failed to resolve the password verification rate limit", "scope", scope, "error", err)
		return nil, connect.NewError(connect.CodeInternal, "internal server error")
	}
	return minuteDayRules(policy.PasswordVerification), nil
}

// stepUpSubject names the step-up allowance of one account within scope.
func stepUpSubject(scope, accountID string) string {
	return "password.verify:" + scope + ":" + accountID
}

// Lift starts every allowance of address within scope afresh, for the device
// it has signed in from before and the ones it never has alike, at every origin.
// It is what the `unlock-sign-in` commands of publiractl do for an owner the
// address's shared allowance refuses while they hold no device token.
//
// It moves the address's generation rather than deleting counters, because the
// counters an attempt is charged against are named by origin and device, which
// no operator can list, and because every server instance keeps a copy of each
// in its own memory that a deletion from Redis would not reach. So it only has
// an effect through counters every instance shares: a limiter over Redis.
func Lift(ctx context.Context, limiter *ratelimit.Limiter, scope, address string) error {
	_, err := limiter.Advance(ctx, generationName(addressName(scope, address)), generationTTL)
	return err
}

// generationName names the generation every allowance of the address name
// names is charged under.
func generationName(name string) string {
	return "login.account:" + name
}

// addressName names one address within scope. Every allowance of the address
// is named after it, and so is every device token signed for it.
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
func addressName(scope, address string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(address))))
	return scope + ":" + hex.EncodeToString(digest[:])
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

// unseenRules is the allowance every attempt at one address from a device it
// has never signed in from shares: [unseenOrigins] origins' worth of the
// address's allowance at one.
func unseenRules(limit platformpolicy.MinuteDay) []ratelimit.Rule {
	return minuteDayRules(platformpolicy.MinuteDay{
		PerMinute: limit.PerMinute * unseenOrigins,
		PerDay:    limit.PerDay * unseenOrigins,
	})
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
