package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/testutil"
)

func updateRetentionDefaults(
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
	defaults *publirattypesv1.RetentionPeriods,
	expectedRevision int64,
) (*connect.Response[publirasplatformv1.UpdatePlatformRetentionDefaultsResponse], error) {
	return client.UpdatePlatformRetentionDefaults(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.UpdatePlatformRetentionDefaultsRequest{
		Defaults:         defaults,
		ExpectedRevision: expectedRevision,
	}))
}

func getRetentionDefaults(
	t *testing.T,
	client publirasplatformv1connect.PlatformPolicyServiceClient,
	operator testutil.PlatformOperator,
) (retention.Periods, int64) {
	t.Helper()
	resp, err := client.GetPlatformRetentionDefaults(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.GetPlatformRetentionDefaultsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformRetentionDefaults: %v", err)
	}
	return retentionPeriodsFromProto(resp.Msg.Defaults), resp.Msg.Revision
}

func TestDBPlatformRetentionDefaults(t *testing.T) {
	client, pg, operator := newPolicyClient(t)

	// An installation that has saved nothing reads the built-in defaults, which
	// are what its purges keep, at revision zero.
	if got, revision := getRetentionDefaults(t, client, operator); got != retention.Builtin() || revision != 0 {
		t.Fatalf("defaults = %+v at revision %d, want the built-in defaults at revision 0", got, revision)
	}

	// Every value differs from the built-in one, so a read that answered those
	// instead of the row would be caught. A default may be longer or shorter.
	want := retention.Periods{WithdrawnCommentDays: 30, ContentEventDays: 365, DailyRankingSnapshotDays: 14, WeeklyRankingSnapshotDays: 730}
	created, err := updateRetentionDefaults(client, operator, retentionPeriodsToProto(want), 0)
	if err != nil {
		t.Fatalf("UpdatePlatformRetentionDefaults (first): %v", err)
	}
	if created.Msg.Revision != 1 || retentionPeriodsFromProto(created.Msg.Defaults) != want {
		t.Fatalf("first save = %+v at revision %d, want %+v at revision 1", created.Msg.Defaults, created.Msg.Revision, want)
	}
	want.WithdrawnCommentDays = 90
	updated, err := updateRetentionDefaults(client, operator, retentionPeriodsToProto(want), created.Msg.Revision)
	if err != nil {
		t.Fatalf("UpdatePlatformRetentionDefaults (second): %v", err)
	}
	if updated.Msg.Revision != 2 {
		t.Fatalf("second save revision = %d, want 2", updated.Msg.Revision)
	}
	if got, revision := getRetentionDefaults(t, client, operator); got != want || revision != 2 {
		t.Fatalf("defaults after two saves = %+v at revision %d, want %+v at revision 2", got, revision, want)
	}
	if got := countRows(
		t,
		pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_retention_defaults_updated' AND target_type = 'platform_retention' AND outcome = 'success'`,
	); got != 2 {
		t.Fatalf("platform_retention_defaults_updated audit entries = %d, want 2", got)
	}

	// A save based on a read another save has since moved past is refused.
	for name, revision := range map[string]int64{
		"the revision before the last save": created.Msg.Revision,
		"zero once a row exists":            0,
	} {
		if _, err := updateRetentionDefaults(client, operator, retentionPeriodsToProto(retention.Builtin()), revision); connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("save based on %s error = %v, want failed_precondition", name, err)
		}
	}

	for name, defaults := range map[string]*publirattypesv1.RetentionPeriods{
		"missing defaults":      nil,
		"a missing period":      {WithdrawnCommentDays: 30, ContentEventDays: 30, DailyRankingSnapshotDays: 30},
		"a negative period":     {WithdrawnCommentDays: -1, ContentEventDays: 30, DailyRankingSnapshotDays: 30, WeeklyRankingSnapshotDays: 30},
		"a period past the cap": {WithdrawnCommentDays: 30, ContentEventDays: retention.MaxDays + 1, DailyRankingSnapshotDays: 30, WeeklyRankingSnapshotDays: 30},
	} {
		if _, err := updateRetentionDefaults(client, operator, defaults, updated.Msg.Revision); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s error = %v, want invalid_argument", name, err)
		}
	}
	if got, _ := getRetentionDefaults(t, client, operator); got != want {
		t.Fatalf("defaults after refused saves = %+v, want %+v", got, want)
	}
}

func TestDBPlatformRetentionDefaultsRequireAuthentication(t *testing.T) {
	client, _, _ := newPolicyClient(t)

	if _, err := client.GetPlatformRetentionDefaults(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformRetentionDefaultsRequest{})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetPlatformRetentionDefaults without a session error = %v, want unauthenticated", err)
	}
	if _, err := client.UpdatePlatformRetentionDefaults(context.Background(), connect.NewRequest(&publirasplatformv1.UpdatePlatformRetentionDefaultsRequest{
		Defaults: retentionPeriodsToProto(retention.Builtin()),
	})); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdatePlatformRetentionDefaults without a session error = %v, want unauthenticated", err)
	}
}

func TestDBPlatformAuditorReadsButCannotUpdateTheRetentionDefaults(t *testing.T) {
	client, pg, _ := newPolicyClient(t)
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT01", "auditor@example.com", "Platform Auditor")

	if got, _ := getRetentionDefaults(t, client, auditor); got != retention.Builtin() {
		t.Fatalf("auditor read = %+v, want the built-in defaults", got)
	}
	if _, err := updateRetentionDefaults(client, auditor, retentionPeriodsToProto(retention.Builtin()), 0); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("auditor save error = %v, want permission_denied", err)
	}
}
