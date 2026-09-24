// Package platformpolicy resolves the platform's security and abuse-control
// policy from the platform_policy_config row, or Defaults when none is saved.
package platformpolicy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// MinuteDay is a burst allowance per minute paired with a budget per day.
type MinuteDay struct {
	PerMinute int
	PerDay    int
}

// HourDay is an allowance per hour paired with a budget per day.
type HourDay struct {
	PerHour int
	PerDay  int
}

// CommunityLimits are the reader-facing limits a tenant starts from. Each one
// is also the loosest value a tenant may set for itself.
type CommunityLimits struct {
	CommentPost   MinuteDay
	CommentReport MinuteDay
	// DuplicateCommentWindow is how long the same body by the same reader on
	// the same episode is refused. It is a whole number of minutes.
	DuplicateCommentWindow   time.Duration
	EpisodeRating            MinuteDay
	ContactMessagePerAccount HourDay
	ContactMessagePerClient  HourDay
	ViewerPreferencesUpdate  MinuteDay
}

// Policy is the platform's security and abuse-control policy.
type Policy struct {
	MFARequiredForTenantAdmin bool
	PasswordVerification      MinuteDay
	MailRequestsPerAddress    HourDay
	MailRequestsPerSource     HourDay
	Community                 CommunityLimits
	// StorePurchaseConfirmation bounds the store transactions one reader may
	// hand the server, each of which it verifies with the store.
	StorePurchaseConfirmation MinuteDay
}

// MaxDuplicateCommentWindow bounds the duplicate-comment window. Past a week
// the refusal stops reading as "you just said that".
const MaxDuplicateCommentWindow = 7 * 24 * time.Hour

// Defaults is the policy of a platform that has saved none: the values a
// deployment got from the environment before the policy became a setting.
func Defaults() Policy {
	return Policy{
		MFARequiredForTenantAdmin: false,
		PasswordVerification:      MinuteDay{PerMinute: 5, PerDay: 50},
		MailRequestsPerAddress:    HourDay{PerHour: 5, PerDay: 20},
		MailRequestsPerSource:     HourDay{PerHour: 30, PerDay: 150},
		Community: CommunityLimits{
			CommentPost:              MinuteDay{PerMinute: 10, PerDay: 100},
			CommentReport:            MinuteDay{PerMinute: 10, PerDay: 50},
			DuplicateCommentWindow:   10 * time.Minute,
			EpisodeRating:            MinuteDay{PerMinute: 30, PerDay: 300},
			ContactMessagePerAccount: HourDay{PerHour: 3, PerDay: 10},
			ContactMessagePerClient:  HourDay{PerHour: 10, PerDay: 30},
			ViewerPreferencesUpdate:  MinuteDay{PerMinute: 30, PerDay: 300},
		},
		StorePurchaseConfirmation: MinuteDay{PerMinute: 10, PerDay: 100},
	}
}

// Validate reports the first value no reader or form could live within. A
// limit of zero refuses everyone, and a day allowing less than the shorter
// window inside it is a burst rule that can never bind.
func (p Policy) Validate() error {
	for _, limit := range []struct {
		name  string
		short int
		day   int
	}{
		{"password_verification", p.PasswordVerification.PerMinute, p.PasswordVerification.PerDay},
		{"mail_requests_per_address", p.MailRequestsPerAddress.PerHour, p.MailRequestsPerAddress.PerDay},
		{"mail_requests_per_source", p.MailRequestsPerSource.PerHour, p.MailRequestsPerSource.PerDay},
		{"community_limit_defaults.comment_post", p.Community.CommentPost.PerMinute, p.Community.CommentPost.PerDay},
		{"community_limit_defaults.comment_report", p.Community.CommentReport.PerMinute, p.Community.CommentReport.PerDay},
		{"community_limit_defaults.episode_rating", p.Community.EpisodeRating.PerMinute, p.Community.EpisodeRating.PerDay},
		{"community_limit_defaults.contact_message_per_account", p.Community.ContactMessagePerAccount.PerHour, p.Community.ContactMessagePerAccount.PerDay},
		{"community_limit_defaults.contact_message_per_client", p.Community.ContactMessagePerClient.PerHour, p.Community.ContactMessagePerClient.PerDay},
		{"community_limit_defaults.viewer_preferences", p.Community.ViewerPreferencesUpdate.PerMinute, p.Community.ViewerPreferencesUpdate.PerDay},
		{"store_purchase_confirmation", p.StorePurchaseConfirmation.PerMinute, p.StorePurchaseConfirmation.PerDay},
	} {
		if limit.short < 1 {
			return fmt.Errorf("%s must allow at least 1 in its shorter window, got %d", limit.name, limit.short)
		}
		if limit.day < limit.short {
			return fmt.Errorf("%s must allow at least as many per day (%d) as in its shorter window (%d)", limit.name, limit.day, limit.short)
		}
	}
	window := p.Community.DuplicateCommentWindow
	if window < time.Minute || window > MaxDuplicateCommentWindow || window%time.Minute != 0 {
		return fmt.Errorf("community_limit_defaults.duplicate_comment_window_minutes must be a whole number of minutes from 1 to %d, got %s", int(MaxDuplicateCommentWindow/time.Minute), window)
	}
	return nil
}

// FromConfig reads a saved row.
func FromConfig(config dbmodels.PlatformPolicyConfig) Policy {
	return Policy{
		MFARequiredForTenantAdmin: config.MfaRequiredForTenantAdmin,
		PasswordVerification:      MinuteDay{PerMinute: int(config.PasswordVerifyLimitPerMinute), PerDay: int(config.PasswordVerifyLimitPerDay)},
		MailRequestsPerAddress:    HourDay{PerHour: int(config.MailRequestLimitPerAddressPerHour), PerDay: int(config.MailRequestLimitPerAddressPerDay)},
		MailRequestsPerSource:     HourDay{PerHour: int(config.MailRequestLimitPerSourcePerHour), PerDay: int(config.MailRequestLimitPerSourcePerDay)},
		Community: CommunityLimits{
			CommentPost:              MinuteDay{PerMinute: int(config.CommentPostLimitPerMinute), PerDay: int(config.CommentPostLimitPerDay)},
			CommentReport:            MinuteDay{PerMinute: int(config.CommentReportLimitPerMinute), PerDay: int(config.CommentReportLimitPerDay)},
			DuplicateCommentWindow:   time.Duration(config.CommentDuplicateWindowMinutes) * time.Minute,
			EpisodeRating:            MinuteDay{PerMinute: int(config.EpisodeRatingLimitPerMinute), PerDay: int(config.EpisodeRatingLimitPerDay)},
			ContactMessagePerAccount: HourDay{PerHour: int(config.ContactMessageLimitPerAccountPerHour), PerDay: int(config.ContactMessageLimitPerAccountPerDay)},
			ContactMessagePerClient:  HourDay{PerHour: int(config.ContactMessageLimitPerClientPerHour), PerDay: int(config.ContactMessageLimitPerClientPerDay)},
			ViewerPreferencesUpdate:  MinuteDay{PerMinute: int(config.ViewerPreferencesLimitPerMinute), PerDay: int(config.ViewerPreferencesLimitPerDay)},
		},
		StorePurchaseConfirmation: MinuteDay{PerMinute: int(config.StorePurchaseConfirmLimitPerMinute), PerDay: int(config.StorePurchaseConfirmLimitPerDay)},
	}
}

// ConfigParams is the row that stores p. The insert takes the same fields, so
// its params convert from these.
func (p Policy) ConfigParams() dbmodels.UpdatePlatformPolicyConfigParams {
	policy := p
	community := policy.Community
	return dbmodels.UpdatePlatformPolicyConfigParams{
		MfaRequiredForTenantAdmin:            policy.MFARequiredForTenantAdmin,
		PasswordVerifyLimitPerMinute:         int32(policy.PasswordVerification.PerMinute),
		PasswordVerifyLimitPerDay:            int32(policy.PasswordVerification.PerDay),
		MailRequestLimitPerAddressPerHour:    int32(policy.MailRequestsPerAddress.PerHour),
		MailRequestLimitPerAddressPerDay:     int32(policy.MailRequestsPerAddress.PerDay),
		MailRequestLimitPerSourcePerHour:     int32(policy.MailRequestsPerSource.PerHour),
		MailRequestLimitPerSourcePerDay:      int32(policy.MailRequestsPerSource.PerDay),
		CommentPostLimitPerMinute:            int32(community.CommentPost.PerMinute),
		CommentPostLimitPerDay:               int32(community.CommentPost.PerDay),
		CommentReportLimitPerMinute:          int32(community.CommentReport.PerMinute),
		CommentReportLimitPerDay:             int32(community.CommentReport.PerDay),
		CommentDuplicateWindowMinutes:        int32(community.DuplicateCommentWindow / time.Minute),
		EpisodeRatingLimitPerMinute:          int32(community.EpisodeRating.PerMinute),
		EpisodeRatingLimitPerDay:             int32(community.EpisodeRating.PerDay),
		ContactMessageLimitPerAccountPerHour: int32(community.ContactMessagePerAccount.PerHour),
		ContactMessageLimitPerAccountPerDay:  int32(community.ContactMessagePerAccount.PerDay),
		ContactMessageLimitPerClientPerHour:  int32(community.ContactMessagePerClient.PerHour),
		ContactMessageLimitPerClientPerDay:   int32(community.ContactMessagePerClient.PerDay),
		ViewerPreferencesLimitPerMinute:      int32(community.ViewerPreferencesUpdate.PerMinute),
		ViewerPreferencesLimitPerDay:         int32(community.ViewerPreferencesUpdate.PerDay),
		StorePurchaseConfirmLimitPerMinute:   int32(policy.StorePurchaseConfirmation.PerMinute),
		StorePurchaseConfirmLimitPerDay:      int32(policy.StorePurchaseConfirmation.PerDay),
	}
}

// Querier is the minimal DB interface required to read the policy row.
type Querier interface {
	GetPlatformPolicyConfig(ctx context.Context) (dbmodels.PlatformPolicyConfig, error)
}

// Read returns the effective policy and the revision of the row it came from.
// A platform that has saved nothing gets Defaults at revision zero.
func Read(ctx context.Context, q Querier) (Policy, int64, error) {
	config, err := q.GetPlatformPolicyConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Defaults(), 0, nil
	}
	if err != nil {
		return Policy{}, 0, fmt.Errorf("read platform policy: %w", err)
	}
	return FromConfig(config), config.Revision, nil
}

// Source answers the effective policy for a request.
type Source interface {
	Policy(ctx context.Context) (Policy, error)
}

// Fixed is a Source that always answers the same policy. It is what a caller
// that reads no settings row gets, and what tests state their policy with.
type Fixed Policy

// Policy implements Source.
func (f Fixed) Policy(context.Context) (Policy, error) {
	return Policy(f), nil
}

// CacheTTL is how long a Resolver serves a read before reading the row again,
// and so how long a saved change takes to reach every instance.
const CacheTTL = 10 * time.Second

// Resolver reads the policy row and keeps what it read for a TTL, so the RPCs
// that charge a limit on every call do not each cost a query.
type Resolver struct {
	queries Querier
	ttl     time.Duration
	now     func() time.Time
	logger  *slog.Logger

	mu        sync.Mutex
	cached    Policy
	hasCached bool
	// nextReadAt is when the row is read again. A failed reread pushes it a
	// TTL out too, so an outage costs one query per TTL rather than one per
	// request.
	nextReadAt time.Time
}

// NewResolver returns a Resolver over queries that rereads the row once ttl has
// passed. A ttl of zero reads it on every call.
func NewResolver(queries Querier, ttl time.Duration, logger *slog.Logger) *Resolver {
	if logger == nil {
		logger = slog.Default()
	}
	return &Resolver{queries: queries, ttl: ttl, now: time.Now, logger: logger}
}

// Policy implements Source. A failed reread answers the last policy read,
// because falling back to Defaults would loosen what the operator tightened.
func (r *Resolver) Policy(ctx context.Context) (Policy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := r.now()
	if r.hasCached && now.Before(r.nextReadAt) {
		return r.cached, nil
	}
	policy, _, err := Read(ctx, r.queries)
	if err != nil {
		if r.hasCached {
			r.nextReadAt = now.Add(r.ttl)
			r.logger.WarnContext(ctx, "serving the last platform policy read", "error", err)
			return r.cached, nil
		}
		return Policy{}, err
	}
	r.cached, r.hasCached, r.nextReadAt = policy, true, now.Add(r.ttl)
	return policy, nil
}
