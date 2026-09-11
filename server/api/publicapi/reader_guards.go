package publicapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The reader-writable RPCs share one flood control.
//
// Comments are the first thing a signed-in stranger can put in front of every
// other reader of a tenant, and every reader-writable RPC added after them is
// the same kind of surface. So the guard belongs to the surface rather than to
// the comment handler: a new RPC names an action here, gives it rules, and
// charges it, and the mechanism underneath is the one in internal/ratelimit.

// readerAction names one reader-writable RPC. It is part of the key the
// counters are kept under, so renaming one resets its budgets.
type readerAction string

const (
	actionPostComment   readerAction = "comment.post"
	actionReportComment readerAction = "comment.report"
	// Every press of the rating control charges, because every press that adds
	// a point files an event of its own.
	actionRateEpisode readerAction = "episode.rate"
	// The step-up password check ChangePassword, DeleteMe and RequestEmailChange
	// make on top of the session. One action for all three: an allowance held
	// per RPC would hand a guesser three budgets to rotate between.
	//
	// This one is charged before the password is verified rather than before the
	// first write, so an attempt past the limit costs no bcrypt and reaches no
	// row, and it is cleared once a password verifies — the count is there to
	// bound guessing, and the caller who knows the password is not guessing.
	// resource_exhausted is what distinguishes the refusal from the
	// invalid_argument a wrong password gets, so a client can tell the reader to
	// come back later instead of repeating "your password is wrong" at someone
	// who typed it correctly.
	actionVerifyPassword readerAction = "password.verify"
)

// The deployment settings, and the defaults a deployment that sets none of them
// gets. The defaults are what a person writing in their own words can reach and
// a script cannot live within: nobody composes ten comments in a minute, and a
// reader who has posted a hundred in a day is no longer reading.
const (
	postCommentPerMinuteEnv    = "PUBLIRA_COMMENT_POST_LIMIT_PER_MINUTE"
	postCommentPerDayEnv       = "PUBLIRA_COMMENT_POST_LIMIT_PER_DAY"
	reportCommentPerMinuteEnv  = "PUBLIRA_COMMENT_REPORT_LIMIT_PER_MINUTE"
	reportCommentPerDayEnv     = "PUBLIRA_COMMENT_REPORT_LIMIT_PER_DAY"
	duplicateCommentWindowEnv  = "PUBLIRA_COMMENT_DUPLICATE_WINDOW_MINUTES"
	rateEpisodePerMinuteEnv    = "PUBLIRA_EPISODE_RATING_LIMIT_PER_MINUTE"
	rateEpisodePerDayEnv       = "PUBLIRA_EPISODE_RATING_LIMIT_PER_DAY"
	verifyPasswordPerMinuteEnv = "PUBLIRA_PASSWORD_VERIFY_LIMIT_PER_MINUTE"
	verifyPasswordPerDayEnv    = "PUBLIRA_PASSWORD_VERIFY_LIMIT_PER_DAY"

	defaultPostCommentPerMinute   = 10
	defaultPostCommentPerDay      = 100
	defaultReportCommentPerMinute = 10
	defaultReportCommentPerDay    = 50

	// A rating costs a tap rather than sentences, so its budget is wider than a
	// comment's: a reader working through a series rates an episode each time
	// they finish one, and a tenant that lets them press their way up spends
	// several of these on one episode. A day of them is still far more presses
	// than anyone reading makes.
	defaultRateEpisodePerMinute = 30
	defaultRateEpisodePerDay    = 300

	// The password budget is the one a reader is meant to reach only by
	// mistyping, so it is far narrower than the others: a handful of tries in a
	// minute covers the typos, and a reader who cannot get it right after the
	// day's worth has forgotten it and wants the reset form rather than another
	// guess. Every try costs the API a bcrypt verification, which is the other
	// reason the number is small.
	defaultVerifyPasswordPerMinute = 5
	defaultVerifyPasswordPerDay    = 50

	// defaultDuplicateCommentWindow is long enough to cover a reader hammering
	// the button and short enough that coming back to an episode hours later
	// with the same short reaction is not refused.
	defaultDuplicateCommentWindow = 10 * time.Minute
)

// readerGuards is the flood control the reader-writable RPCs charge against.
type readerGuards struct {
	limiter *ratelimit.Limiter
	// rules is the policy per action. An action that names no rules is not rate
	// limited at all, so adding an RPC to the flood control is an entry here and
	// a charge in the handler.
	rules map[readerAction][]ratelimit.Rule
	// duplicateCommentWindow is how long the same body by the same reader on the
	// same episode is refused.
	duplicateCommentWindow time.Duration
}

// readerLimits is one budget per action, as a deployment configured it. It is a
// struct rather than a widening list of ints so that adding an action cannot
// silently swap two of them at a call site.
type readerLimits struct {
	postCommentPerMinute    int
	postCommentPerDay       int
	reportCommentPerMinute  int
	reportCommentPerDay     int
	rateEpisodePerMinute    int
	rateEpisodePerDay       int
	verifyPasswordPerMinute int
	verifyPasswordPerDay    int
}

// defaultReaderLimits is the policy a deployment that sets none of the settings
// gets.
func defaultReaderLimits() readerLimits {
	return readerLimits{
		postCommentPerMinute:    defaultPostCommentPerMinute,
		postCommentPerDay:       defaultPostCommentPerDay,
		reportCommentPerMinute:  defaultReportCommentPerMinute,
		reportCommentPerDay:     defaultReportCommentPerDay,
		rateEpisodePerMinute:    defaultRateEpisodePerMinute,
		rateEpisodePerDay:       defaultRateEpisodePerDay,
		verifyPasswordPerMinute: defaultVerifyPasswordPerMinute,
		verifyPasswordPerDay:    defaultVerifyPasswordPerDay,
	}
}

// newReaderGuardsFromEnv reads the deployment's settings. A value that is not a
// whole number of at least one stops the server: a limit of zero refuses every
// reader and a negative one is not a limit at all, and either is better caught
// at startup than by the first reader who tries to post.
func newReaderGuardsFromEnv(logger *slog.Logger) (readerGuards, error) {
	var limits readerLimits
	for _, setting := range []struct {
		name     string
		fallback int
		into     *int
	}{
		{postCommentPerMinuteEnv, defaultPostCommentPerMinute, &limits.postCommentPerMinute},
		{postCommentPerDayEnv, defaultPostCommentPerDay, &limits.postCommentPerDay},
		{reportCommentPerMinuteEnv, defaultReportCommentPerMinute, &limits.reportCommentPerMinute},
		{reportCommentPerDayEnv, defaultReportCommentPerDay, &limits.reportCommentPerDay},
		{rateEpisodePerMinuteEnv, defaultRateEpisodePerMinute, &limits.rateEpisodePerMinute},
		{rateEpisodePerDayEnv, defaultRateEpisodePerDay, &limits.rateEpisodePerDay},
		{verifyPasswordPerMinuteEnv, defaultVerifyPasswordPerMinute, &limits.verifyPasswordPerMinute},
		{verifyPasswordPerDayEnv, defaultVerifyPasswordPerDay, &limits.verifyPasswordPerDay},
	} {
		value, err := envLimit(setting.name, setting.fallback)
		if err != nil {
			return readerGuards{}, err
		}
		*setting.into = value
	}
	duplicateMinutes, err := envLimit(duplicateCommentWindowEnv, int(defaultDuplicateCommentWindow/time.Minute))
	if err != nil {
		return readerGuards{}, err
	}
	return readerGuards{
		limiter:                ratelimit.NewFromEnv(logger),
		rules:                  readerRules(limits),
		duplicateCommentWindow: time.Duration(duplicateMinutes) * time.Minute,
	}, nil
}

// readerRules pairs a burst window with a daily budget for each action. The
// minute keeps a script from emptying the day's budget in one breath, and the
// day is what a script pacing itself under the minute still runs into.
func readerRules(limits readerLimits) map[readerAction][]ratelimit.Rule {
	return map[readerAction][]ratelimit.Rule{
		actionPostComment: {
			{Limit: limits.postCommentPerMinute, Window: time.Minute},
			{Limit: limits.postCommentPerDay, Window: 24 * time.Hour},
		},
		actionReportComment: {
			{Limit: limits.reportCommentPerMinute, Window: time.Minute},
			{Limit: limits.reportCommentPerDay, Window: 24 * time.Hour},
		},
		actionRateEpisode: {
			{Limit: limits.rateEpisodePerMinute, Window: time.Minute},
			{Limit: limits.rateEpisodePerDay, Window: 24 * time.Hour},
		},
		actionVerifyPassword: {
			{Limit: limits.verifyPasswordPerMinute, Window: time.Minute},
			{Limit: limits.verifyPasswordPerDay, Window: 24 * time.Hour},
		},
	}
}

// withDefaults fills in what a caller left unset. Handing the reader-writable
// RPCs a limiter that is not there would take the guard off them silently, so
// the zero value is the default policy over in-process counters rather than no
// policy at all.
func (g readerGuards) withDefaults() readerGuards {
	if g.limiter == nil {
		g.limiter = ratelimit.New(ratelimit.NewMemoryStore())
	}
	if g.rules == nil {
		g.rules = readerRules(defaultReaderLimits())
	}
	if g.duplicateCommentWindow <= 0 {
		g.duplicateCommentWindow = defaultDuplicateCommentWindow
	}
	return g
}

func envLimit(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer, got %q", name, raw)
	}
	if value < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", name, value)
	}
	return value, nil
}

// readerActionSubject names whose budget is being spent. The tenant is part of
// it as well as the reader: a user row belongs to one tenant, but a limit that
// left the tenant out would be one storefront's flood spending another's
// budget the day user identity is ever shared between them.
func readerActionSubject(action readerAction, tenantID, userID uuid.UUID) string {
	return string(action) + ":" + tenantID.String() + ":" + userID.String()
}

// chargeReaderAction spends one of the reader's allowances for action, and
// answers resource_exhausted once they are out of them.
func (s *apiServer) chargeReaderAction(ctx context.Context, action readerAction, tenantID, userID uuid.UUID) error {
	rules := s.guards.rules[action]
	if len(rules) == 0 {
		return nil
	}
	decision, err := s.guards.limiter.Allow(ctx, readerActionSubject(action, tenantID, userID), rules...)
	if err != nil {
		return s.internalError(ctx, "failed to apply the reader rate limit", err, "tenant_id", tenantID.String(), "action", string(action))
	}
	if decision.Allowed {
		return nil
	}
	return rpcerrors.NewRateLimitedError(decision.RetryAfter)
}

// clearReaderAction gives the reader back everything action has cost them.
//
// It is the counterpart the step-up password check needs and no other action
// uses: a budget that bounds guessing has to be cleared by the attempt that was
// not a guess. Holding the count past a password that verified would lock an
// account out of its own settings over typos, and it would bound nothing —
// what the limit is there for is the caller who does not know the password, and
// that caller never gets this far.
func (s *apiServer) clearReaderAction(ctx context.Context, action readerAction, tenantID, userID uuid.UUID) {
	rules := s.guards.rules[action]
	if len(rules) == 0 {
		return
	}
	s.guards.limiter.Reset(ctx, readerActionSubject(action, tenantID, userID), rules...)
}

// duplicateCommentKey names one reader repeating themselves on one episode.
//
// The body reaches the key as a digest: the limiter holds nothing a reader
// wrote, and the key stays the same size whether the comment is a word or a
// thousand of them.
func duplicateCommentKey(tenantID, userID, episodeID uuid.UUID, body string) string {
	digest := sha256.Sum256([]byte(body))
	return "comment.duplicate:" + tenantID.String() + ":" + userID.String() + ":" + episodeID.String() + ":" + hex.EncodeToString(digest[:])
}

// claimCommentBody takes the reader's place for one body on one episode, and
// refuses a body they have already posted there inside the window.
//
// A refusal is already_exists rather than the rate limit's resource_exhausted:
// the reader has not run out of anything, and what they meant to say is on the
// page already.
func (s *apiServer) claimCommentBody(ctx context.Context, key string) error {
	if s.guards.duplicateCommentWindow <= 0 {
		return nil
	}
	fresh, err := s.guards.limiter.Claim(ctx, key, s.guards.duplicateCommentWindow)
	if err != nil {
		return s.internalError(ctx, "failed to claim the comment body", err)
	}
	if !fresh {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("the same comment was posted a moment ago"))
	}
	return nil
}
