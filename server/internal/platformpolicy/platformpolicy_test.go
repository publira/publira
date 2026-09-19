package platformpolicy

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestDefaultsAreAValidPolicy(t *testing.T) {
	if err := Defaults().Validate(); err != nil {
		t.Fatalf("Defaults().Validate() = %v, want nil", err)
	}
}

// The built-in defaults are what a deployment got from the environment before
// the policy moved into the database, so an installation that has saved
// nothing keeps behaving as it did.
func TestDefaultsKeepThePreviousDeploymentDefaults(t *testing.T) {
	want := Policy{
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
	}
	if got := Defaults(); got != want {
		t.Fatalf("Defaults() = %+v, want %+v", got, want)
	}
}

func TestValidateRefusesALimitNobodyCanLiveWithin(t *testing.T) {
	for name, adjust := range map[string]func(*Policy){
		"zero per minute":             func(p *Policy) { p.Community.CommentPost.PerMinute = 0 },
		"negative per hour":           func(p *Policy) { p.MailRequestsPerAddress.PerHour = -1 },
		"day below minute":            func(p *Policy) { p.PasswordVerification = MinuteDay{PerMinute: 10, PerDay: 9} },
		"day below hour":              func(p *Policy) { p.Community.ContactMessagePerClient = HourDay{PerHour: 5, PerDay: 4} },
		"zero viewer preferences day": func(p *Policy) { p.Community.ViewerPreferencesUpdate.PerDay = 0 },
		"no duplicate window":         func(p *Policy) { p.Community.DuplicateCommentWindow = 0 },
		"duplicate window over a week": func(p *Policy) {
			p.Community.DuplicateCommentWindow = MaxDuplicateCommentWindow + time.Minute
		},
		"duplicate window off the minute": func(p *Policy) {
			p.Community.DuplicateCommentWindow = 90 * time.Second
		},
	} {
		t.Run(name, func(t *testing.T) {
			policy := Defaults()
			adjust(&policy)
			if err := policy.Validate(); err == nil {
				t.Fatal("Validate() = nil, want an error")
			}
		})
	}
}

func TestValidateAcceptsTheBounds(t *testing.T) {
	policy := Defaults()
	policy.PasswordVerification = MinuteDay{PerMinute: 1, PerDay: 1}
	policy.Community.DuplicateCommentWindow = MaxDuplicateCommentWindow
	if err := policy.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
}

func TestConfigParamsRoundTripThroughTheRow(t *testing.T) {
	policy := Defaults()
	policy.MFARequiredForTenantAdmin = true
	policy.Community.DuplicateCommentWindow = 45 * time.Minute
	policy.Community.ContactMessagePerClient = HourDay{PerHour: 7, PerDay: 70}

	row := rowFromParams(policy.ConfigParams())
	if got := FromConfig(row); got != policy {
		t.Fatalf("FromConfig(ConfigParams()) = %+v, want %+v", got, policy)
	}
}

// fakeQuerier answers the policy row from its fields and counts the reads.
type fakeQuerier struct {
	config dbmodels.PlatformPolicyConfig
	err    error
	reads  int
}

func (q *fakeQuerier) GetPlatformPolicyConfig(context.Context) (dbmodels.PlatformPolicyConfig, error) {
	q.reads++
	return q.config, q.err
}

// rowFromParams is the row an insert with params stores.
func rowFromParams(params dbmodels.UpdatePlatformPolicyConfigParams) dbmodels.PlatformPolicyConfig {
	return dbmodels.PlatformPolicyConfig{
		MfaRequiredForTenantAdmin:            params.MfaRequiredForTenantAdmin,
		PasswordVerifyLimitPerMinute:         params.PasswordVerifyLimitPerMinute,
		PasswordVerifyLimitPerDay:            params.PasswordVerifyLimitPerDay,
		MailRequestLimitPerAddressPerHour:    params.MailRequestLimitPerAddressPerHour,
		MailRequestLimitPerAddressPerDay:     params.MailRequestLimitPerAddressPerDay,
		MailRequestLimitPerSourcePerHour:     params.MailRequestLimitPerSourcePerHour,
		MailRequestLimitPerSourcePerDay:      params.MailRequestLimitPerSourcePerDay,
		CommentPostLimitPerMinute:            params.CommentPostLimitPerMinute,
		CommentPostLimitPerDay:               params.CommentPostLimitPerDay,
		CommentReportLimitPerMinute:          params.CommentReportLimitPerMinute,
		CommentReportLimitPerDay:             params.CommentReportLimitPerDay,
		CommentDuplicateWindowMinutes:        params.CommentDuplicateWindowMinutes,
		EpisodeRatingLimitPerMinute:          params.EpisodeRatingLimitPerMinute,
		EpisodeRatingLimitPerDay:             params.EpisodeRatingLimitPerDay,
		ContactMessageLimitPerAccountPerHour: params.ContactMessageLimitPerAccountPerHour,
		ContactMessageLimitPerAccountPerDay:  params.ContactMessageLimitPerAccountPerDay,
		ContactMessageLimitPerClientPerHour:  params.ContactMessageLimitPerClientPerHour,
		ContactMessageLimitPerClientPerDay:   params.ContactMessageLimitPerClientPerDay,
		ViewerPreferencesLimitPerMinute:      params.ViewerPreferencesLimitPerMinute,
		ViewerPreferencesLimitPerDay:         params.ViewerPreferencesLimitPerDay,
	}
}

func savedRow(policy Policy, revision int64) dbmodels.PlatformPolicyConfig {
	config := rowFromParams(policy.ConfigParams())
	config.Revision = revision
	return config
}

func TestReadAnswersTheDefaultsWhenNothingIsSaved(t *testing.T) {
	policy, revision, err := Read(t.Context(), &fakeQuerier{err: sql.ErrNoRows})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if policy != Defaults() || revision != 0 {
		t.Fatalf("Read = %+v at revision %d, want the defaults at revision 0", policy, revision)
	}
}

func TestReadAnswersTheSavedPolicy(t *testing.T) {
	saved := Defaults()
	saved.MFARequiredForTenantAdmin = true
	saved.Community.CommentPost = MinuteDay{PerMinute: 2, PerDay: 20}

	policy, revision, err := Read(t.Context(), &fakeQuerier{config: savedRow(saved, 4)})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if policy != saved || revision != 4 {
		t.Fatalf("Read = %+v at revision %d, want the saved policy at revision 4", policy, revision)
	}
}

func TestReadReportsAFailedRead(t *testing.T) {
	if _, _, err := Read(t.Context(), &fakeQuerier{err: errors.New("connection refused")}); err == nil {
		t.Fatal("Read = nil error, want the failure")
	}
}

func newTestResolver(q Querier, ttl time.Duration) (*Resolver, *time.Time) {
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	resolver := NewResolver(q, ttl, nil)
	resolver.now = func() time.Time { return now }
	return resolver, &now
}

func TestResolverServesAReadForItsTTL(t *testing.T) {
	saved := Defaults()
	saved.MFARequiredForTenantAdmin = true
	q := &fakeQuerier{config: savedRow(saved, 1)}
	resolver, now := newTestResolver(q, CacheTTL)

	for range 3 {
		policy, err := resolver.Policy(t.Context())
		if err != nil {
			t.Fatalf("Policy: %v", err)
		}
		if !policy.MFARequiredForTenantAdmin {
			t.Fatal("Policy did not answer the saved row")
		}
	}
	if q.reads != 1 {
		t.Fatalf("reads = %d, want one inside the TTL", q.reads)
	}

	// A save reaches this instance once the TTL has passed.
	saved.MFARequiredForTenantAdmin = false
	q.config = savedRow(saved, 2)
	*now = now.Add(CacheTTL)
	policy, err := resolver.Policy(t.Context())
	if err != nil {
		t.Fatalf("Policy after the TTL: %v", err)
	}
	if policy.MFARequiredForTenantAdmin || q.reads != 2 {
		t.Fatalf("after the TTL policy = %+v with %d reads, want the new row read once more", policy, q.reads)
	}
}

// Falling back to the defaults while the database is unreachable would loosen
// whatever the operator tightened.
func TestResolverKeepsTheLastReadWhenARereadFails(t *testing.T) {
	saved := Defaults()
	saved.Community.CommentPost = MinuteDay{PerMinute: 1, PerDay: 1}
	q := &fakeQuerier{config: savedRow(saved, 1)}
	resolver, now := newTestResolver(q, CacheTTL)

	if _, err := resolver.Policy(t.Context()); err != nil {
		t.Fatalf("Policy: %v", err)
	}
	q.err = errors.New("connection refused")
	*now = now.Add(CacheTTL)

	policy, err := resolver.Policy(t.Context())
	if err != nil {
		t.Fatalf("Policy after a failed reread: %v", err)
	}
	if policy != saved {
		t.Fatalf("Policy after a failed reread = %+v, want the last policy read", policy)
	}
}

// While the database is down, the resolver retries once per TTL rather than on
// every request.
func TestResolverBacksOffAfterAFailedReread(t *testing.T) {
	q := &fakeQuerier{config: savedRow(Defaults(), 1)}
	resolver, now := newTestResolver(q, CacheTTL)

	if _, err := resolver.Policy(t.Context()); err != nil {
		t.Fatalf("Policy: %v", err)
	}
	q.err = errors.New("connection refused")
	*now = now.Add(CacheTTL)
	for range 3 {
		if _, err := resolver.Policy(t.Context()); err != nil {
			t.Fatalf("Policy during the outage: %v", err)
		}
	}
	if q.reads != 2 {
		t.Fatalf("reads = %d, want one failed reread for the whole TTL", q.reads)
	}

	*now = now.Add(CacheTTL)
	if _, err := resolver.Policy(t.Context()); err != nil {
		t.Fatalf("Policy after another TTL: %v", err)
	}
	if q.reads != 3 {
		t.Fatalf("reads = %d, want another reread once the TTL passed", q.reads)
	}
}

func TestResolverReportsAFailureWithNothingRead(t *testing.T) {
	resolver, _ := newTestResolver(&fakeQuerier{err: errors.New("connection refused")}, CacheTTL)
	if _, err := resolver.Policy(t.Context()); err == nil {
		t.Fatal("Policy = nil error, want the failure")
	}
}
