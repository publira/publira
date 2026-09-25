package adminapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/commentretention"
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/contentranking"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
)

// savePlatformRetentionDefaults writes the platform defaults the way the
// platform console would. The superuser connection writes them, because the
// tenant console's role may only read them.
func savePlatformRetentionDefaults(t *testing.T, env *adminDBEnv, defaults retention.Periods) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(env.PG.DB).InsertPlatformRetentionConfig(ctx, dbmodels.InsertPlatformRetentionConfigParams(defaults.PlatformConfigParams())); err != nil {
		t.Fatalf("save platform retention defaults: %v", err)
	}
}

func periodsFromProto(periods *publirattypesv1.RetentionPeriods) retention.Periods {
	return retention.Periods{
		WithdrawnCommentDays:      int(periods.GetWithdrawnCommentDays()),
		ContentEventDays:          int(periods.GetContentEventDays()),
		DailyRankingSnapshotDays:  int(periods.GetDailyRankingSnapshotDays()),
		WeeklyRankingSnapshotDays: int(periods.GetWeeklyRankingSnapshotDays()),
	}
}

func getRetention(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.GetTenantRetentionSettingsResponse {
	t.Helper()
	res, err := env.tenantSettingsClient().GetTenantRetentionSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantRetentionSettingsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantRetentionSettings: %v", err)
	}
	return res.Msg
}

func updateRetention(env *adminDBEnv, tenant adminDBTenant, overrides *publiraadminv1.TenantRetentionOverrides, expectedRevision int64) (*publiraadminv1.UpdateTenantRetentionSettingsResponse, error) {
	res, err := env.tenantSettingsClient().UpdateTenantRetentionSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantRetentionSettingsRequest{
		Tenant:           tenant.tenantContext(),
		Overrides:        overrides,
		ExpectedRevision: expectedRevision,
	}))
	if err != nil {
		return nil, err
	}
	return res.Msg, nil
}

func TestDBTenantRetentionSettings(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "RETTENANT001", "retention.example.com", "Retention Tenant", "RETADMIN0001", "admin@retention.example.com")
	other := env.seedTenantWithAdmin(t, "RETTENANT002", "other-retention.example.com", "Other Retention Tenant", "RETADMIN0002", "admin@other-retention.example.com")

	// Nothing saved anywhere resolves to the built-in defaults, which is what
	// an installation had before the periods became settings.
	initial := getRetention(t, env, tenant)
	if initial.Revision != 0 || initial.Overrides.WithdrawnCommentDays != nil || initial.Overrides.ContentEventDays != nil ||
		initial.Overrides.DailyRankingSnapshotDays != nil || initial.Overrides.WeeklyRankingSnapshotDays != nil {
		t.Fatalf("initial settings = %+v, want no overrides at revision 0", initial)
	}
	if got := periodsFromProto(initial.Effective); got != retention.Builtin() {
		t.Fatalf("initial effective = %+v, want the built-in defaults %+v", got, retention.Builtin())
	}

	platformDefaults := retention.Periods{WithdrawnCommentDays: 50, ContentEventDays: 60, DailyRankingSnapshotDays: 70, WeeklyRankingSnapshotDays: 300}
	savePlatformRetentionDefaults(t, env, platformDefaults)
	if got := periodsFromProto(getRetention(t, env, tenant).Effective); got != platformDefaults {
		t.Fatalf("effective after a platform save = %+v, want the platform defaults %+v", got, platformDefaults)
	}

	// An override may be shorter or longer than the platform default, and the
	// periods left unset keep following it.
	saved, err := updateRetention(env, tenant, &publiraadminv1.TenantRetentionOverrides{
		WithdrawnCommentDays: new(int32(7)),
		ContentEventDays:     new(int32(400)),
	}, 0)
	if err != nil {
		t.Fatalf("UpdateTenantRetentionSettings: %v", err)
	}
	want := retention.Periods{WithdrawnCommentDays: 7, ContentEventDays: 400, DailyRankingSnapshotDays: 70, WeeklyRankingSnapshotDays: 300}
	if saved.Revision != 1 || periodsFromProto(saved.Effective) != want || periodsFromProto(saved.PlatformDefaults) != platformDefaults {
		t.Fatalf("saved = %+v, want revision 1 and effective %+v", saved, want)
	}
	if saved.Overrides.DailyRankingSnapshotDays != nil {
		t.Fatalf("saved overrides = %+v, want the daily period left unset", saved.Overrides)
	}
	if got := periodsFromProto(getRetention(t, env, tenant).Effective); got != want {
		t.Fatalf("effective after the save = %+v, want %+v", got, want)
	}
	if got := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'tenant_retention_updated' AND target_id = $2",
		tenant.Tenant.ID, tenant.Tenant.PublicID); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}

	// Another tenant sees none of it.
	if got := periodsFromProto(getRetention(t, env, other).Effective); got != platformDefaults {
		t.Fatalf("other tenant effective = %+v, want the platform defaults %+v", got, platformDefaults)
	}

	// A save based on a revision the row has moved past is refused.
	if _, err := updateRetention(env, tenant, &publiraadminv1.TenantRetentionOverrides{WithdrawnCommentDays: new(int32(9))}, 0); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("stale save error = %v, want failed_precondition", err)
	}
	if _, err := updateRetention(env, other, &publiraadminv1.TenantRetentionOverrides{}, 3); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("save against a missing row error = %v, want failed_precondition", err)
	}

	for name, overrides := range map[string]*publiraadminv1.TenantRetentionOverrides{
		"missing overrides": nil,
		"zero days":         {WithdrawnCommentDays: new(int32(0))},
		"negative days":     {ContentEventDays: new(int32(-1))},
		"too many days":     {WeeklyRankingSnapshotDays: new(int32(retention.MaxDays + 1))},
	} {
		if _, err := updateRetention(env, tenant, overrides, 1); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s error = %v, want invalid_argument", name, err)
		}
	}
	if _, err := updateRetention(env, tenant, &publiraadminv1.TenantRetentionOverrides{}, -1); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("negative revision error = %v, want invalid_argument", err)
	}

	// How long a tenant's data is kept is the tenant admin's decision.
	editor := tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "RETEDITOR001", "editor@retention.example.com", "Editor", auth.RoleTenantEditor))
	if _, err := updateRetention(env, editor, &publiraadminv1.TenantRetentionOverrides{}, 1); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("editor save error = %v, want permission_denied", err)
	}

	// Sending no override clears them all, and the tenant follows the platform
	// defaults again.
	cleared, err := updateRetention(env, tenant, &publiraadminv1.TenantRetentionOverrides{}, 1)
	if err != nil {
		t.Fatalf("clear overrides: %v", err)
	}
	if cleared.Revision != 2 || periodsFromProto(cleared.Effective) != platformDefaults {
		t.Fatalf("cleared = %+v, want revision 2 and the platform defaults", cleared)
	}
}

// The console's withdrawal deadline and each purge batch must resolve the same
// period for a tenant, whether the tenant overrides it or follows the platform
// default. This drives the API through its own role and the purges through the
// batch role, and checks that each row is deleted exactly when the value the
// API reports says it should be.
func TestDBRetentionDeadlineAndPurgeCutoffsAgree(t *testing.T) {
	env := newAdminDBEnv(t)
	overridden := newCommentModerationFixture(t, env, "RTO", "overridden-retention.example.com")
	plain := newCommentModerationFixture(t, env, "RTP", "plain-retention.example.com")

	savePlatformRetentionDefaults(t, env, retention.Periods{WithdrawnCommentDays: 40, ContentEventDays: 30, DailyRankingSnapshotDays: 20, WeeklyRankingSnapshotDays: 100})
	if _, err := updateRetention(env, overridden.admin, &publiraadminv1.TenantRetentionOverrides{
		WithdrawnCommentDays:      new(int32(7)),
		ContentEventDays:          new(int32(5)),
		DailyRankingSnapshotDays:  new(int32(3)),
		WeeklyRankingSnapshotDays: new(int32(14)),
	}, 0); err != nil {
		t.Fatalf("save overrides: %v", err)
	}

	batchDB := env.PG.OpenContentStatsDB(t)
	ctx := context.Background()
	table, err := retention.LoadTable(ctx, dbmodels.New(batchDB))
	if err != nil {
		t.Fatalf("LoadTable as the batch role: %v", err)
	}

	fixtures := []commentModerationFixture{overridden, plain}
	effective := map[uuid.UUID]retention.Periods{}
	for _, fixture := range fixtures {
		api := periodsFromProto(getRetention(t, env, fixture.admin).Effective)
		if batch := table.For(fixture.admin.Tenant.ID); batch != api {
			t.Fatalf("tenant %s: the batch resolves %+v, the API reports %+v", fixture.admin.Tenant.PublicID, batch, api)
		}
		effective[fixture.admin.Tenant.ID] = api
	}
	if effective[overridden.admin.Tenant.ID] == effective[plain.admin.Tenant.ID] {
		t.Fatal("both tenants resolved the same periods, so this test would not tell an override from a default")
	}

	t.Run("withdrawn comments", func(t *testing.T) {
		purger := commentretention.NewPurger(batchDB)
		for _, fixture := range fixtures {
			comment := fixture.seedComment(t, fixture.admin.Tenant.PublicID[:3]+"WITHDRAWN", "published")
			fixture.withdrawComment(t, comment.PublicID)
			listed := fixture.list(t, &publiraadminv1.ListCommentsRequest{Status: "withdrawn"})
			if len(listed.Comments) != 1 {
				t.Fatalf("withdrawn comments = %d, want 1", len(listed.Comments))
			}
			dueAt, err := time.Parse(time.RFC3339, listed.Comments[0].PurgeDueAt)
			if err != nil {
				t.Fatalf("parse purge_due_at %q: %v", listed.Comments[0].PurgeDueAt, err)
			}

			// A run at the deadline the console shows keeps the comment, and
			// a run one second later deletes it.
			for _, run := range []struct {
				now    time.Time
				exists bool
			}{{dueAt, true}, {dueAt.Add(time.Second), false}} {
				if _, err := purger.Run(ctx, commentretention.PurgeOptions{Now: run.now, Retention: table}); err != nil {
					t.Fatalf("purge at %s: %v", run.now, err)
				}
				exists := env.countRows(t, "SELECT count(*) FROM episode_comments WHERE id = $1", comment.ID) == 1
				if exists != run.exists {
					t.Fatalf("tenant %s: after a purge at %s the comment exists = %t, want %t (purge_due_at %s)",
						fixture.admin.Tenant.PublicID, run.now, exists, run.exists, listed.Comments[0].PurgeDueAt)
				}
			}
		}
	})

	now := time.Now().UTC().Truncate(time.Second)

	t.Run("content events", func(t *testing.T) {
		kept := map[uuid.UUID]uuid.UUID{}
		expired := map[uuid.UUID]uuid.UUID{}
		for i, fixture := range fixtures {
			cutoff := now.AddDate(0, 0, -effective[fixture.admin.Tenant.ID].ContentEventDays)
			kept[fixture.admin.Tenant.ID] = insertRetentionEvent(t, env.PG.DB, fixture, int64(i*2+1), cutoff)
			expired[fixture.admin.Tenant.ID] = insertRetentionEvent(t, env.PG.DB, fixture, int64(i*2+2), cutoff.Add(-time.Second))
		}
		if _, err := contentevents.New(batchDB).Run(ctx, contentevents.Options{Now: now, Retention: table}); err != nil {
			t.Fatalf("purge content events: %v", err)
		}
		for _, fixture := range fixtures {
			tenantID := fixture.admin.Tenant.ID
			if env.countRows(t, "SELECT count(*) FROM content_events WHERE id = $1", kept[tenantID]) != 1 {
				t.Fatalf("tenant %s: the event at its cutoff was purged", fixture.admin.Tenant.PublicID)
			}
			if env.countRows(t, "SELECT count(*) FROM content_events WHERE id = $1", expired[tenantID]) != 0 {
				t.Fatalf("tenant %s: the event before its cutoff survived", fixture.admin.Tenant.PublicID)
			}
		}
	})

	t.Run("ranking snapshots", func(t *testing.T) {
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		type snapshotIDs struct{ kept, expired []uuid.UUID }
		ids := map[uuid.UUID]*snapshotIDs{}
		for _, fixture := range fixtures {
			tenantID := fixture.admin.Tenant.ID
			periods := effective[tenantID]
			ids[tenantID] = &snapshotIDs{}
			for _, key := range []struct {
				rankingKey string
				days       int
			}{
				{contentranking.DailyRankingKey, periods.DailyRankingSnapshotDays},
				{contentranking.WeeklyRankingKey, periods.WeeklyRankingSnapshotDays},
			} {
				cutoff := today.AddDate(0, 0, -key.days)
				// The newest period is kept whatever its age, so each key gets
				// one that is not the subject of the test.
				insertRetentionRanking(t, env.PG.DB, tenantID, key.rankingKey, today)
				ids[tenantID].kept = append(ids[tenantID].kept, insertRetentionRanking(t, env.PG.DB, tenantID, key.rankingKey, cutoff))
				ids[tenantID].expired = append(ids[tenantID].expired, insertRetentionRanking(t, env.PG.DB, tenantID, key.rankingKey, cutoff.AddDate(0, 0, -1)))
			}
		}
		if _, err := contentranking.NewPurger(batchDB).Run(ctx, contentranking.PurgeOptions{Now: now, Retention: table}); err != nil {
			t.Fatalf("purge ranking snapshots: %v", err)
		}
		for _, fixture := range fixtures {
			for _, id := range ids[fixture.admin.Tenant.ID].kept {
				if env.countRows(t, "SELECT count(*) FROM content_ranking_snapshots WHERE id = $1", id) != 1 {
					t.Fatalf("tenant %s: the snapshot ending at its cutoff was purged", fixture.admin.Tenant.PublicID)
				}
			}
			for _, id := range ids[fixture.admin.Tenant.ID].expired {
				if env.countRows(t, "SELECT count(*) FROM content_ranking_snapshots WHERE id = $1", id) != 0 {
					t.Fatalf("tenant %s: the snapshot ending before its cutoff survived", fixture.admin.Tenant.PublicID)
				}
			}
		}
	})
}

func insertRetentionEvent(t *testing.T, db *sql.DB, fixture commentModerationFixture, debounceBucket int64, occurredAt time.Time) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, occurred_at
		) VALUES ($1, $2, 'episode_view', $3, $4, $5, $6, $7)
	`, id, fixture.admin.Tenant.ID, fixture.reader, fixture.series.ID, fixture.episode.ID, debounceBucket, occurredAt); err != nil {
		t.Fatalf("insert content event: %v", err)
	}
	return id
}

func insertRetentionRanking(t *testing.T, db *sql.DB, tenantID uuid.UUID, rankingKey string, periodEnd time.Time) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	periodStart := periodEnd
	if rankingKey == contentranking.WeeklyRankingKey {
		periodStart = periodEnd.AddDate(0, 0, -6)
	}
	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_ranking_snapshots (
			id, tenant_id, ranking_key, period_start, period_end, entity_type, surface, items, algorithm_version
		) VALUES ($1, $2, $3, $4::date, $5::date, 'series', 'web', '[]'::jsonb, $6)
	`, id, tenantID, rankingKey, periodStart.Format(time.DateOnly), periodEnd.Format(time.DateOnly), contentranking.AlgorithmVersion); err != nil {
		t.Fatalf("insert %s snapshot ending %s: %v", rankingKey, periodEnd.Format(time.DateOnly), err)
	}
	return id
}
