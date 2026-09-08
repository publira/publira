package publicapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ratelimit"
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
)

// The deployment settings, and the defaults a deployment that sets none of them
// gets. The defaults are what a person writing in their own words can reach and
// a script cannot live within: nobody composes ten comments in a minute, and a
// reader who has posted a hundred in a day is no longer reading.
const (
	postCommentPerMinuteEnv   = "PUBLIRA_COMMENT_POST_LIMIT_PER_MINUTE"
	postCommentPerDayEnv      = "PUBLIRA_COMMENT_POST_LIMIT_PER_DAY"
	reportCommentPerMinuteEnv = "PUBLIRA_COMMENT_REPORT_LIMIT_PER_MINUTE"
	reportCommentPerDayEnv    = "PUBLIRA_COMMENT_REPORT_LIMIT_PER_DAY"
	duplicateCommentWindowEnv = "PUBLIRA_COMMENT_DUPLICATE_WINDOW_MINUTES"

	defaultPostCommentPerMinute   = 10
	defaultPostCommentPerDay      = 100
	defaultReportCommentPerMinute = 10
	defaultReportCommentPerDay    = 50

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

// newReaderGuardsFromEnv reads the deployment's settings. A value that is not a
// whole number of at least one stops the server: a limit of zero refuses every
// reader and a negative one is not a limit at all, and either is better caught
// at startup than by the first reader who tries to post.
func newReaderGuardsFromEnv(logger *slog.Logger) (readerGuards, error) {
	postPerMinute, err := envLimit(postCommentPerMinuteEnv, defaultPostCommentPerMinute)
	if err != nil {
		return readerGuards{}, err
	}
	postPerDay, err := envLimit(postCommentPerDayEnv, defaultPostCommentPerDay)
	if err != nil {
		return readerGuards{}, err
	}
	reportPerMinute, err := envLimit(reportCommentPerMinuteEnv, defaultReportCommentPerMinute)
	if err != nil {
		return readerGuards{}, err
	}
	reportPerDay, err := envLimit(reportCommentPerDayEnv, defaultReportCommentPerDay)
	if err != nil {
		return readerGuards{}, err
	}
	duplicateMinutes, err := envLimit(duplicateCommentWindowEnv, int(defaultDuplicateCommentWindow/time.Minute))
	if err != nil {
		return readerGuards{}, err
	}
	return readerGuards{
		limiter:                ratelimit.NewFromEnv(logger),
		rules:                  readerRules(postPerMinute, postPerDay, reportPerMinute, reportPerDay),
		duplicateCommentWindow: time.Duration(duplicateMinutes) * time.Minute,
	}, nil
}

// readerRules pairs a burst window with a daily budget for each action. The
// minute keeps a script from emptying the day's budget in one breath, and the
// day is what a script pacing itself under the minute still runs into.
func readerRules(postPerMinute, postPerDay, reportPerMinute, reportPerDay int) map[readerAction][]ratelimit.Rule {
	return map[readerAction][]ratelimit.Rule{
		actionPostComment: {
			{Limit: postPerMinute, Window: time.Minute},
			{Limit: postPerDay, Window: 24 * time.Hour},
		},
		actionReportComment: {
			{Limit: reportPerMinute, Window: time.Minute},
			{Limit: reportPerDay, Window: 24 * time.Hour},
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
		g.rules = readerRules(
			defaultPostCommentPerMinute,
			defaultPostCommentPerDay,
			defaultReportCommentPerMinute,
			defaultReportCommentPerDay,
		)
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
	return rateLimitedError(decision.RetryAfter)
}

// rateLimitedError is the one answer every exhausted allowance gives. It says
// how long the wait is and nothing about which of the rules ran out, so the
// reply cannot be used to map the limits themselves.
func rateLimitedError(retryAfter time.Duration) error {
	err := connect.NewError(connect.CodeResourceExhausted, errors.New("too many requests, try again later"))
	if seconds := int(math.Ceil(retryAfter.Seconds())); seconds > 0 {
		err.Meta().Set("Retry-After", strconv.Itoa(seconds))
	}
	return err
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
