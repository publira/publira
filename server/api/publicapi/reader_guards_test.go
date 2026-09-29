package publicapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
)

func TestReaderRulesFollowThePlatformPolicy(t *testing.T) {
	policy := platformpolicy.Defaults()
	policy.PasswordVerification = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 8}
	policy.Community.CommentPost = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 7}
	policy.Community.CommentReport = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 5}
	policy.Community.EpisodeRating = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 9}
	policy.Community.ViewerPreferencesUpdate = platformpolicy.MinuteDay{PerMinute: 11, PerDay: 12}
	policy.Community.ContactMessagePerAccount = platformpolicy.HourDay{PerHour: 1, PerDay: 2}
	policy.Community.ContactMessagePerClient = platformpolicy.HourDay{PerHour: 13, PerDay: 14}
	policy.StorePurchaseConfirmation = platformpolicy.MinuteDay{PerMinute: 15, PerDay: 16}

	want := map[readerAction][]ratelimit.Rule{
		actionPostComment:                    {{Limit: 3, Window: time.Minute}, {Limit: 7, Window: 24 * time.Hour}},
		actionReportComment:                  {{Limit: 2, Window: time.Minute}, {Limit: 5, Window: 24 * time.Hour}},
		actionRateEpisode:                    {{Limit: 4, Window: time.Minute}, {Limit: 9, Window: 24 * time.Hour}},
		actionVerifyPassword:                 {{Limit: 6, Window: time.Minute}, {Limit: 8, Window: 24 * time.Hour}},
		actionUpdateViewerPreferences:        {{Limit: 11, Window: time.Minute}, {Limit: 12, Window: 24 * time.Hour}},
		actionSubmitContactMessage:           {{Limit: 1, Window: time.Hour}, {Limit: 2, Window: 24 * time.Hour}},
		actionSubmitContactMessageFromClient: {{Limit: 13, Window: time.Hour}, {Limit: 14, Window: 24 * time.Hour}},
		actionConfirmStorePurchase:           {{Limit: 15, Window: time.Minute}, {Limit: 16, Window: 24 * time.Hour}},
	}
	got := readerRules(policy)
	if len(got) != len(want) {
		t.Fatalf("rules name %d actions, want %d", len(got), len(want))
	}
	for action, rules := range want {
		if fmt.Sprint(got[action]) != fmt.Sprint(rules) {
			t.Fatalf("%s = %v, want %v", action, got[action], rules)
		}
	}
}

func TestReaderGuardsWithDefaultsFillsInAMissingPolicy(t *testing.T) {
	// The zero value has to mean the default guard rather than no guard: a
	// limiter that is not there would take the flood control off the RPCs
	// without anything saying so.
	guards := readerGuards{}.withDefaults()

	if guards.limiter == nil {
		t.Fatal("limiter = nil, want the in-process default")
	}
	policy, err := guards.policy.Policy(t.Context())
	if err != nil {
		t.Fatalf("policy: %v", err)
	}
	if policy != platformpolicy.Defaults() {
		t.Fatalf("policy = %+v, want the built-in defaults", policy)
	}
}

type unreachablePolicy struct{}

func (unreachablePolicy) Policy(context.Context) (platformpolicy.Policy, error) {
	return platformpolicy.Policy{}, errors.New("database unreachable")
}

// A policy that cannot be resolved refuses the write rather than letting it
// through unlimited.
func TestChargeReaderActionRefusesWhenThePolicyCannotBeResolved(t *testing.T) {
	server := &apiServer{
		logger: slog.Default(),
		guards: readerGuards{policy: unreachablePolicy{}}.withDefaults(),
	}

	err := server.chargeReaderAction(t.Context(), actionPostComment, uuid.New(), uuid.New())
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("chargeReaderAction = %v, want internal", err)
	}
}

func TestReaderActionSubjectKeepsReadersAndTenantsApart(t *testing.T) {
	tenantA := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	tenantB := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	reader := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	otherReader := uuid.MustParse("44444444-4444-4444-8444-444444444444")

	base := readerActionSubject(actionPostComment, tenantA, reader)
	for name, subject := range map[string]string{
		"another reader": readerActionSubject(actionPostComment, tenantA, otherReader),
		"another tenant": readerActionSubject(actionPostComment, tenantB, reader),
		"another action": readerActionSubject(actionReportComment, tenantA, reader),
	} {
		if subject == base {
			t.Fatalf("%s shares the subject %q, want a budget of its own", name, subject)
		}
	}
}
