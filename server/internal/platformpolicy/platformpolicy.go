// Package platformpolicy resolves the platform's security and abuse-control
// policy from the platform_policy_config row, or Defaults when none is saved,
// and saves that row. The platform API's PlatformPolicyService and publiractl
// policy are adapters over its save.
//
// A refusal of what the caller asked for is a [*fielderr.Invalid] naming the
// field at fault or [ErrConflict]; any other error is the database's.
package platformpolicy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
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
	// MFARequiredForPlatformOperator holds every operator of the platform
	// console with no authenticator at enrollment before it gets a session.
	MFARequiredForPlatformOperator bool
	PasswordVerification           MinuteDay
	MailRequestsPerAddress         HourDay
	MailRequestsPerSource          HourDay
	Community                      CommunityLimits
	// StorePurchaseConfirmation bounds the store transactions one reader may
	// hand the server, each of which it verifies with the store.
	StorePurchaseConfirmation MinuteDay
	// WaitFreeTicketUse bounds the wait-for-free tickets one reader may ask to
	// spend. A spent one is bounded by the series' recharge interval already;
	// this is what bounds the refused ones.
	WaitFreeTicketUse MinuteDay
	// LoginAttemptsPerAccount bounds the passwords tried at sign-in for one
	// address within its tenant, or within the platform console. A sign-in
	// whose password is right clears it.
	LoginAttemptsPerAccount MinuteDay
	// LoginAttemptsPerSource bounds the sign-ins one client source may fail,
	// across every address, tenant and console.
	LoginAttemptsPerSource HourDay
	// DisposableEmailDomainsURL is where the list of disposable email domains
	// is read from. Empty means there is no list: none ships with the server.
	DisposableEmailDomainsURL string
}

// FieldDuplicateCommentWindow is the one field of the PlatformPolicy message
// that is not half of a limit.
const FieldDuplicateCommentWindow = "community_limit_defaults.duplicate_comment_window_minutes"

// FieldDisposableEmailDomainsURL is the field of the PlatformPolicy message
// that names where the disposable email domain list is read from.
const FieldDisposableEmailDomainsURL = "disposable_email_domains_url"

// FieldMFARequiredForPlatformOperator is the field of the PlatformPolicy
// message that requires the second factor of every platform operator.
const FieldMFARequiredForPlatformOperator = "mfa_required_for_platform_operator"

// MaxDisposableEmailDomainsURLLength bounds the URL of the disposable email
// domain list, as the column's check constraint does.
const MaxDisposableEmailDomainsURLLength = 2048

// MaxDuplicateCommentWindow bounds the duplicate-comment window. Past a week
// the refusal stops reading as "you just said that".
const MaxDuplicateCommentWindow = 7 * 24 * time.Hour

// Defaults is the policy of a platform that has saved none: the values a
// deployment got from the environment before the policy became a setting.
func Defaults() Policy {
	return Policy{
		MFARequiredForTenantAdmin:      false,
		MFARequiredForPlatformOperator: false,
		PasswordVerification:           MinuteDay{PerMinute: 5, PerDay: 50},
		MailRequestsPerAddress:         HourDay{PerHour: 5, PerDay: 20},
		MailRequestsPerSource:          HourDay{PerHour: 30, PerDay: 150},
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
		WaitFreeTicketUse:         MinuteDay{PerMinute: 10, PerDay: 100},
		LoginAttemptsPerAccount:   MinuteDay{PerMinute: 5, PerDay: 50},
		LoginAttemptsPerSource:    HourDay{PerHour: 60, PerDay: 300},
	}
}

// Validate reports the first value no reader or form could live within, as a
// [*fielderr.Invalid] naming its field in the PlatformPolicy message. A limit
// of zero refuses everyone, and a day allowing less than the shorter window
// inside it is a burst rule that can never bind.
func (p Policy) Validate() error {
	for _, limit := range []struct {
		name   string
		window string
		short  int
		day    int
	}{
		{"password_verification", "per_minute", p.PasswordVerification.PerMinute, p.PasswordVerification.PerDay},
		{"mail_requests_per_address", "per_hour", p.MailRequestsPerAddress.PerHour, p.MailRequestsPerAddress.PerDay},
		{"mail_requests_per_source", "per_hour", p.MailRequestsPerSource.PerHour, p.MailRequestsPerSource.PerDay},
		{"community_limit_defaults.comment_post", "per_minute", p.Community.CommentPost.PerMinute, p.Community.CommentPost.PerDay},
		{"community_limit_defaults.comment_report", "per_minute", p.Community.CommentReport.PerMinute, p.Community.CommentReport.PerDay},
		{"community_limit_defaults.episode_rating", "per_minute", p.Community.EpisodeRating.PerMinute, p.Community.EpisodeRating.PerDay},
		{"community_limit_defaults.contact_message_per_account", "per_hour", p.Community.ContactMessagePerAccount.PerHour, p.Community.ContactMessagePerAccount.PerDay},
		{"community_limit_defaults.contact_message_per_client", "per_hour", p.Community.ContactMessagePerClient.PerHour, p.Community.ContactMessagePerClient.PerDay},
		{"community_limit_defaults.viewer_preferences", "per_minute", p.Community.ViewerPreferencesUpdate.PerMinute, p.Community.ViewerPreferencesUpdate.PerDay},
		{"store_purchase_confirmation", "per_minute", p.StorePurchaseConfirmation.PerMinute, p.StorePurchaseConfirmation.PerDay},
		{"wait_free_ticket_use", "per_minute", p.WaitFreeTicketUse.PerMinute, p.WaitFreeTicketUse.PerDay},
		{"login_attempts_per_account", "per_minute", p.LoginAttemptsPerAccount.PerMinute, p.LoginAttemptsPerAccount.PerDay},
		{"login_attempts_per_source", "per_hour", p.LoginAttemptsPerSource.PerHour, p.LoginAttemptsPerSource.PerDay},
	} {
		short, day := limit.name+"."+limit.window, limit.name+".per_day"
		if limit.short < 1 {
			return &fielderr.Invalid{Field: short, Err: fmt.Errorf("%s must be at least 1, got %d", short, limit.short)}
		}
		if limit.day < limit.short {
			return &fielderr.Invalid{Field: day, Err: fmt.Errorf("%s must be at least %s (%d), got %d", day, short, limit.short, limit.day)}
		}
	}
	window := p.Community.DuplicateCommentWindow
	if window < time.Minute || window > MaxDuplicateCommentWindow || window%time.Minute != 0 {
		return &fielderr.Invalid{
			Field: FieldDuplicateCommentWindow,
			Err:   fmt.Errorf("%s must be a whole number of minutes from 1 to %d, got %s", FieldDuplicateCommentWindow, int(MaxDuplicateCommentWindow/time.Minute), window),
		}
	}
	if err := validateListURL(p.DisposableEmailDomainsURL); err != nil {
		return &fielderr.Invalid{Field: FieldDisposableEmailDomainsURL, Err: err}
	}
	return nil
}

// validateListURL accepts no URL, or an absolute http or https one: the
// server reads the list with a plain GET and follows nothing else.
func validateListURL(raw string) error {
	if raw == "" {
		return nil
	}
	if len(raw) > MaxDisposableEmailDomainsURLLength {
		return fmt.Errorf("%s must be at most %d bytes", FieldDisposableEmailDomainsURL, MaxDisposableEmailDomainsURLLength)
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || strings.TrimSpace(raw) != raw {
		return fmt.Errorf("%s must be an absolute http or https URL", FieldDisposableEmailDomainsURL)
	}
	return nil
}

// FromConfig reads a saved row.
func FromConfig(config dbmodels.PlatformPolicyConfig) Policy {
	return Policy{
		MFARequiredForTenantAdmin:      config.MfaRequiredForTenantAdmin,
		MFARequiredForPlatformOperator: config.MfaRequiredForPlatformOperator,
		PasswordVerification:           MinuteDay{PerMinute: int(config.PasswordVerifyLimitPerMinute), PerDay: int(config.PasswordVerifyLimitPerDay)},
		MailRequestsPerAddress:         HourDay{PerHour: int(config.MailRequestLimitPerAddressPerHour), PerDay: int(config.MailRequestLimitPerAddressPerDay)},
		MailRequestsPerSource:          HourDay{PerHour: int(config.MailRequestLimitPerSourcePerHour), PerDay: int(config.MailRequestLimitPerSourcePerDay)},
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
		WaitFreeTicketUse:         MinuteDay{PerMinute: int(config.WaitFreeTicketUseLimitPerMinute), PerDay: int(config.WaitFreeTicketUseLimitPerDay)},
		LoginAttemptsPerAccount:   MinuteDay{PerMinute: int(config.LoginAccountLimitPerMinute), PerDay: int(config.LoginAccountLimitPerDay)},
		LoginAttemptsPerSource:    HourDay{PerHour: int(config.LoginSourceLimitPerHour), PerDay: int(config.LoginSourceLimitPerDay)},
		DisposableEmailDomainsURL: config.DisposableEmailDomainsUrl,
	}
}

// ConfigParams is the row that stores p. The insert takes the same fields, so
// its params convert from these.
func (p Policy) ConfigParams() dbmodels.UpdatePlatformPolicyConfigParams {
	policy := p
	community := policy.Community
	return dbmodels.UpdatePlatformPolicyConfigParams{
		MfaRequiredForTenantAdmin:            policy.MFARequiredForTenantAdmin,
		MfaRequiredForPlatformOperator:       policy.MFARequiredForPlatformOperator,
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
		WaitFreeTicketUseLimitPerMinute:      int32(policy.WaitFreeTicketUse.PerMinute),
		WaitFreeTicketUseLimitPerDay:         int32(policy.WaitFreeTicketUse.PerDay),
		LoginAccountLimitPerMinute:           int32(policy.LoginAttemptsPerAccount.PerMinute),
		LoginAccountLimitPerDay:              int32(policy.LoginAttemptsPerAccount.PerDay),
		LoginSourceLimitPerHour:              int32(policy.LoginAttemptsPerSource.PerHour),
		LoginSourceLimitPerDay:               int32(policy.LoginAttemptsPerSource.PerDay),
		DisposableEmailDomainsUrl:            policy.DisposableEmailDomainsURL,
	}
}

// Querier is the minimal DB interface required to read the policy row.
type Querier interface {
	GetPlatformPolicyConfig(ctx context.Context) (dbmodels.PlatformPolicyConfig, error)
}

// Get reads the saved row, reporting false when nothing is saved.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformPolicyConfig, bool, error) {
	config, err := q.GetPlatformPolicyConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformPolicyConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformPolicyConfig{}, false, fmt.Errorf("read platform policy: %w", err)
	}
	return config, true, nil
}

// Read returns the effective policy and the revision of the row it came from.
// A platform that has saved nothing gets Defaults at revision zero.
func Read(ctx context.Context, q Querier) (Policy, int64, error) {
	config, found, err := Get(ctx, q)
	if err != nil {
		return Policy{}, 0, err
	}
	if !found {
		return Defaults(), 0, nil
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
