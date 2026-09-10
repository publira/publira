package publicapi

import (
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/redisurl"
)

// clearReaderGuardEnv empties every setting the policy reads, so a case that is
// about a value states that value itself. A contributor with one of these
// exported in their shell would otherwise be running a different test.
func clearReaderGuardEnv(t *testing.T) {
	t.Helper()

	t.Setenv(redisurl.Env, "disabled")
	for _, name := range []string{
		postCommentPerMinuteEnv,
		postCommentPerDayEnv,
		reportCommentPerMinuteEnv,
		reportCommentPerDayEnv,
		duplicateCommentWindowEnv,
	} {
		t.Setenv(name, "")
	}
}

// guardsFromEnv builds the policy the way the server does, with the shared
// counters turned off: what a deployment configured is what these cases are
// about, and reaching for the deployment's Redis to find out would make them
// depend on a service that is not running in a unit test.
func guardsFromEnv(t *testing.T) readerGuards {
	t.Helper()

	guards, err := newReaderGuardsFromEnv(slog.Default())
	if err != nil {
		t.Fatalf("newReaderGuardsFromEnv: %v", err)
	}
	return guards
}

func TestNewReaderGuardsFromEnvDefaults(t *testing.T) {
	clearReaderGuardEnv(t)
	guards := guardsFromEnv(t)

	want := map[readerAction][]ratelimit.Rule{
		actionPostComment: {
			{Limit: defaultPostCommentPerMinute, Window: time.Minute},
			{Limit: defaultPostCommentPerDay, Window: 24 * time.Hour},
		},
		actionReportComment: {
			{Limit: defaultReportCommentPerMinute, Window: time.Minute},
			{Limit: defaultReportCommentPerDay, Window: 24 * time.Hour},
		},
	}
	for action, rules := range want {
		got := guards.rules[action]
		if len(got) != len(rules) {
			t.Fatalf("%s = %v, want %v", action, got, rules)
		}
		for index, rule := range rules {
			if got[index] != rule {
				t.Fatalf("%s rule %d = %+v, want %+v", action, index, got[index], rule)
			}
		}
	}
	if guards.duplicateCommentWindow != defaultDuplicateCommentWindow {
		t.Fatalf("duplicate window = %s, want %s", guards.duplicateCommentWindow, defaultDuplicateCommentWindow)
	}
}

func TestNewReaderGuardsFromEnvTakesTheConfiguredLimits(t *testing.T) {
	clearReaderGuardEnv(t)
	t.Setenv(postCommentPerMinuteEnv, "3")
	t.Setenv(postCommentPerDayEnv, " 7 ")
	t.Setenv(reportCommentPerMinuteEnv, "2")
	t.Setenv(reportCommentPerDayEnv, "5")
	t.Setenv(duplicateCommentWindowEnv, "30")

	guards := guardsFromEnv(t)

	if got := guards.rules[actionPostComment]; got[0].Limit != 3 || got[1].Limit != 7 {
		t.Fatalf("posting rules = %+v, want 3 per minute and 7 per day", got)
	}
	if got := guards.rules[actionReportComment]; got[0].Limit != 2 || got[1].Limit != 5 {
		t.Fatalf("reporting rules = %+v, want 2 per minute and 5 per day", got)
	}
	if guards.duplicateCommentWindow != 30*time.Minute {
		t.Fatalf("duplicate window = %s, want 30m", guards.duplicateCommentWindow)
	}
}

func TestNewReaderGuardsFromEnvRejectsALimitNobodyCanMeet(t *testing.T) {
	// A limit of zero refuses every reader and a negative one is not a limit at
	// all. Both are better caught at startup than by the first reader.
	for _, raw := range []string{"0", "-1", "ten", "1.5"} {
		t.Run(raw, func(t *testing.T) {
			clearReaderGuardEnv(t)
			t.Setenv(postCommentPerMinuteEnv, raw)
			if _, err := newReaderGuardsFromEnv(slog.Default()); err == nil {
				t.Fatalf("newReaderGuardsFromEnv with %q error = nil, want an error", raw)
			}
		})
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
	if len(guards.rules[actionPostComment]) == 0 || len(guards.rules[actionReportComment]) == 0 {
		t.Fatalf("rules = %v, want the default policy", guards.rules)
	}
	if guards.duplicateCommentWindow != defaultDuplicateCommentWindow {
		t.Fatalf("duplicate window = %s, want %s", guards.duplicateCommentWindow, defaultDuplicateCommentWindow)
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
