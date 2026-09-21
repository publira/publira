package platformapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func newPolicyClient(t *testing.T) (publirasplatformv1connect.PlatformPolicyServiceClient, *testutil.PostgresEnv, testutil.PlatformOperator) {
	t.Helper()
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	return publirasplatformv1connect.NewPlatformPolicyServiceClient(ts.Client(), ts.URL), pg, operator
}

// tightenedPolicy differs from the defaults in every group of values, so a
// read that answered the defaults instead of the row would be caught.
func tightenedPolicy() platformpolicy.Policy {
	policy := platformpolicy.Defaults()
	policy.MFARequiredForTenantAdmin = true
	policy.PasswordVerification = platformpolicy.MinuteDay{PerMinute: 3, PerDay: 30}
	policy.MailRequestsPerAddress = platformpolicy.HourDay{PerHour: 2, PerDay: 8}
	policy.MailRequestsPerSource = platformpolicy.HourDay{PerHour: 20, PerDay: 100}
	policy.Community.CommentPost = platformpolicy.MinuteDay{PerMinute: 4, PerDay: 40}
	policy.Community.CommentReport = platformpolicy.MinuteDay{PerMinute: 5, PerDay: 25}
	policy.Community.DuplicateCommentWindow = 30 * time.Minute
	policy.Community.EpisodeRating = platformpolicy.MinuteDay{PerMinute: 6, PerDay: 60}
	policy.Community.ContactMessagePerAccount = platformpolicy.HourDay{PerHour: 1, PerDay: 5}
	policy.Community.ContactMessagePerClient = platformpolicy.HourDay{PerHour: 4, PerDay: 12}
	policy.Community.ViewerPreferencesUpdate = platformpolicy.MinuteDay{PerMinute: 7, PerDay: 70}
	return policy
}

func updatePolicy(
	t *testing.T,
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
	policy platformpolicy.Policy,
	expectedRevision int64,
) (*connect.Response[publirasplatformv1.UpdatePlatformPolicyResponse], error) {
	t.Helper()
	return client.UpdatePlatformPolicy(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformPolicyRequest{
		Policy:           platformPolicyToProto(policy),
		ExpectedRevision: expectedRevision,
	}))
}

func getPolicy(
	t *testing.T,
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
) (platformpolicy.Policy, int64) {
	t.Helper()
	resp, err := client.GetPlatformPolicy(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformPolicyRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformPolicy: %v", err)
	}
	return platformPolicyFromProto(resp.Msg.Policy), resp.Msg.Revision
}

// An installation that has saved nothing reads the built-in defaults, which are
// what it enforces, at revision zero.
func TestDBGetPlatformPolicyAnswersTheDefaultsWhenNothingIsSaved(t *testing.T) {
	client, _, operator := newPolicyClient(t)

	policy, revision := getPolicy(t, client, operator)
	if policy != platformpolicy.Defaults() {
		t.Fatalf("policy = %+v, want the built-in defaults", policy)
	}
	if revision != 0 {
		t.Fatalf("revision = %d, want 0", revision)
	}
}

func TestDBUpdatePlatformPolicyPersistsAndAudits(t *testing.T) {
	client, pg, operator := newPolicyClient(t)
	want := tightenedPolicy()

	created, err := updatePolicy(t, client, operator, want, 0)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (first): %v", err)
	}
	if created.Msg.Revision != 1 {
		t.Fatalf("revision of the created row = %d, want 1", created.Msg.Revision)
	}
	if got, revision := getPolicy(t, client, operator); got != want || revision != 1 {
		t.Fatalf("policy after the first save = %+v at revision %d, want %+v at revision 1", got, revision, want)
	}

	want.MFARequiredForTenantAdmin = false
	updated, err := updatePolicy(t, client, operator, want, created.Msg.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (second): %v", err)
	}
	if updated.Msg.Revision != 2 || platformPolicyFromProto(updated.Msg.Policy) != want {
		t.Fatalf("second save = %+v at revision %d, want %+v at revision 2", updated.Msg.Policy, updated.Msg.Revision, want)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 1 {
		t.Fatalf("platform_policy_config rows = %d, want 1", got)
	}
	if got := countRows(
		t,
		pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated' AND target_type = 'platform_policy' AND outcome = 'success'`,
	); got != 2 {
		t.Fatalf("platform_policy_updated audit entries = %d, want 2", got)
	}
}

// A save based on a read another save has since moved past is refused, so it
// cannot roll that other save back.
func TestDBUpdatePlatformPolicyRejectsAStaleRevision(t *testing.T) {
	client, pg, operator := newPolicyClient(t)

	first, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), 0)
	if err != nil {
		t.Fatalf("UpdatePlatformPolicy (first): %v", err)
	}
	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), first.Msg.Revision); err != nil {
		t.Fatalf("UpdatePlatformPolicy (second): %v", err)
	}

	for name, revision := range map[string]int64{
		"the revision before the last save": first.Msg.Revision,
		"zero once a row exists":            0,
		"a revision never issued":           99,
	} {
		stale := platformpolicy.Defaults()
		stale.MFARequiredForTenantAdmin = true
		if _, err := updatePolicy(t, client, operator, stale, revision); connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("save stating %s code = %v, want failed_precondition (err=%v)", name, connect.CodeOf(err), err)
		}
	}

	if got, revision := getPolicy(t, client, operator); got != tightenedPolicy() || revision != 2 {
		t.Fatalf("policy after the refused saves = %+v at revision %d, want the second save at revision 2", got, revision)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated'`); got != 2 {
		t.Fatalf("platform_policy_updated audit entries = %d, want only the two saves that went through", got)
	}
}

// With no row saved, only a save stating revision zero creates one: any other
// number was read from a row that no longer exists.
func TestDBUpdatePlatformPolicyRefusesARevisionWithoutARow(t *testing.T) {
	client, pg, operator := newPolicyClient(t)

	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 1); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("save stating revision 1 with no row code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want 0", got)
	}
}

func TestDBUpdatePlatformPolicyRejectsInvalidValues(t *testing.T) {
	client, pg, operator := newPolicyClient(t)

	for name, adjust := range map[string]func(*publirasplatformv1.PlatformPolicy){
		"no policy":    nil,
		"a zero limit": func(p *publirasplatformv1.PlatformPolicy) { p.CommunityLimitDefaults.CommentPost.PerMinute = 0 },
		"a day below its hour": func(p *publirasplatformv1.PlatformPolicy) {
			p.MailRequestsPerSource.PerDay = p.MailRequestsPerSource.PerHour - 1
		},
		"a missing limit":           func(p *publirasplatformv1.PlatformPolicy) { p.PasswordVerification = nil },
		"a missing community group": func(p *publirasplatformv1.PlatformPolicy) { p.CommunityLimitDefaults = nil },
		"a duplicate window over a week": func(p *publirasplatformv1.PlatformPolicy) {
			p.CommunityLimitDefaults.DuplicateCommentWindowMinutes = 7*24*60 + 1
		},
	} {
		t.Run(name, func(t *testing.T) {
			var policy *publirasplatformv1.PlatformPolicy
			if adjust != nil {
				policy = platformPolicyToProto(platformpolicy.Defaults())
				adjust(policy)
			}
			_, err := client.UpdatePlatformPolicy(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformPolicyRequest{Policy: policy}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformPolicy code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}

	if _, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), -1); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdatePlatformPolicy with a negative revision code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want the rejected saves to write nothing", got)
	}
}

func TestDBPlatformPolicyRequiresAuthentication(t *testing.T) {
	ts, _ := newDBIntegrationEnv(t)
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(ts.Client(), ts.URL)

	if _, err := client.GetPlatformPolicy(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformPolicyRequest{})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetPlatformPolicy code = %v, want unauthenticated", connect.CodeOf(err))
	}
	if _, err := client.UpdatePlatformPolicy(context.Background(), connect.NewRequest(&publirasplatformv1.UpdatePlatformPolicyRequest{
		Policy: platformPolicyToProto(platformpolicy.Defaults()),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdatePlatformPolicy code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

// An auditor reads the policy and changes none of it.
func TestDBPlatformAuditorReadsButCannotUpdateThePolicy(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT01", "auditor@example.com", "Platform Auditor")
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(ts.Client(), ts.URL)

	if _, revision := getPolicy(t, client, auditor); revision != 0 {
		t.Fatalf("revision = %d, want 0", revision)
	}
	if _, err := updatePolicy(t, client, auditor, tightenedPolicy(), 0); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdatePlatformPolicy as an auditor code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want 0", got)
	}
}

// Two sessions saving from the same read race for the row: one applies, the
// other is told the row moved on. Run both for the first save, where no row
// exists to lock, and for a later one, where the lock decides.
func TestDBUpdatePlatformPolicyConcurrentSavesOneWins(t *testing.T) {
	for name, seeded := range map[string]bool{"first save": false, "later save": true} {
		t.Run(name, func(t *testing.T) {
			client, pg, operator := newPolicyClient(t)
			var shared int64
			if seeded {
				resp, err := updatePolicy(t, client, operator, platformpolicy.Defaults(), 0)
				if err != nil {
					t.Fatalf("UpdatePlatformPolicy (seed): %v", err)
				}
				shared = resp.Msg.Revision
			}

			candidates := []platformpolicy.Policy{tightenedPolicy(), platformpolicy.Defaults()}
			candidates[1].MFARequiredForTenantAdmin = true
			// A deadline keeps a lock that is never released from hanging
			// the suite instead of failing this case.
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			errs := make(chan error, len(candidates))
			var wg sync.WaitGroup
			for _, candidate := range candidates {
				wg.Go(func() {
					_, err := client.UpdatePlatformPolicy(ctx, newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformPolicyRequest{
						Policy:           platformPolicyToProto(candidate),
						ExpectedRevision: shared,
					}))
					errs <- err
				})
			}
			wg.Wait()
			close(errs)

			succeeded := 0
			for err := range errs {
				switch {
				case err == nil:
					succeeded++
				case connect.CodeOf(err) != connect.CodeFailedPrecondition:
					t.Fatalf("losing UpdatePlatformPolicy code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
				}
			}
			if succeeded != 1 {
				t.Fatalf("%d saves succeeded, want exactly one", succeeded)
			}
			if _, revision := getPolicy(t, client, operator); revision != shared+1 {
				t.Fatalf("revision = %d, want %d", revision, shared+1)
			}
			if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 1 {
				t.Fatalf("platform_policy_config rows = %d, want 1", got)
			}
		})
	}
}

// droppingRecorder loses every entry, as an asynchronous recorder with a full
// queue would.
type droppingRecorder struct{}

func (droppingRecorder) RecordPlatform(context.Context, auditlog.PlatformEntry) {}
func (droppingRecorder) RecordTenant(context.Context, auditlog.TenantEntry)     {}

// The audit entry commits with the policy it records, so a recorder that drops
// entries cannot leave a policy change unrecorded.
func TestDBUpdatePlatformPolicyAuditsInTheSameTransaction(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), nil, nil, testutil.TokenManager(), droppingRecorder{}, openMailGuard(), nil)
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformPolicyServiceClient(ts.Client(), ts.URL)

	if _, err := updatePolicy(t, client, operator, tightenedPolicy(), 0); err != nil {
		t.Fatalf("UpdatePlatformPolicy: %v", err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated'`); got != 1 {
		t.Fatalf("platform_policy_updated audit entries = %d, want 1", got)
	}
}
