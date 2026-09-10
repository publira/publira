package publishepisodes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func TestPublishSuccessNotifiesEachAdminOnce(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	editor := pg.SeedTenantUser(t, env.tenant.ID, "EDITORFAIL01", "editor@fail.example.com", "Editor", "tenant_editor")
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)
	r.RunOnce(ctx)
	r.notifyTenantAdmins(ctx, env.readyRow(), notificationTypeEpisodePublished)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}

	rows := listTenantNotifications(t, pg)
	gotAdmins := map[uuid.UUID]dbmodels.Notification{}
	for _, row := range rows {
		if _, exists := gotAdmins[row.UserID]; exists {
			t.Fatalf("duplicate notification for user %s", row.UserID)
		}
		gotAdmins[row.UserID] = row
	}
	if _, ok := gotAdmins[env.admin.ID]; !ok {
		t.Fatal("missing notification for tenant admin")
	}
	if _, ok := gotAdmins[editor.ID]; !ok {
		t.Fatal("missing notification for tenant editor")
	}
	if _, ok := gotAdmins[env.follower.ID]; !ok {
		t.Fatal("missing notification for the series follower")
	}

	for _, row := range rows {
		if row.TenantID != env.tenant.ID {
			t.Fatalf("tenant_id = %s, want %s", row.TenantID, env.tenant.ID)
		}
		if row.NotificationType != notificationTypeEpisodePublished {
			t.Fatalf("type = %q, want %s", row.NotificationType, notificationTypeEpisodePublished)
		}
		if row.SubjectKey != "episode:"+env.episode.PublicID {
			t.Fatalf("subject_key = %q, want episode:%s", row.SubjectKey, env.episode.PublicID)
		}
		var payload episodePublishedPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatalf("payload: %v", err)
		}
		if payload != (episodePublishedPayload{
			EpisodeID:    env.episode.PublicID,
			EpisodeTitle: "Failed Episode",
			SeriesID:     env.series.PublicID,
			SeriesTitle:  "Failed Series",
		}) {
			t.Fatalf("payload = %+v", payload)
		}
	}

	assertNotificationCounts(t, pg, notificationCounts{tenant: 3})
}

func TestPublishSuccessNotifiesEachFollowerOnce(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	episodeFollower := env.seedReader(t, "MEMBERFAIL02", "member2@fail.example.com", "Member Two")
	env.followEpisode(t, episodeFollower.ID, env.episode.ID)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, episodeFollower.ID, env.admin.ID)

	r.RunOnce(ctx)
	if err := r.notifyFollowersOfPublish(ctx, dbmodels.New(pg.DB), env.readyRow()); err != nil {
		t.Fatalf("notifyFollowersOfPublish: %v", err)
	}
	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, episodeFollower.ID, env.admin.ID)
}

func TestPublishSuccessNotifiesTheUnionOfFollowTargets(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	creatorFollower := env.seedReader(t, "MEMBERFAIL03", "member3@fail.example.com", "Member Three")
	env.followCreator(t, creatorFollower.ID, env.creator.ID)
	episodeFollower := env.seedReader(t, "MEMBERFAIL04", "member4@fail.example.com", "Member Four")
	env.followEpisode(t, episodeFollower.ID, env.episode.ID)
	env.seedReader(t, "MEMBERFAIL05", "member5@fail.example.com", "Member Five")
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, creatorFollower.ID, episodeFollower.ID, env.admin.ID)
}

func TestPublishSuccessNotifiesAReaderWhoFollowsSeveralTargetsOnce(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	env.followCreator(t, env.follower.ID, env.creator.ID)
	env.followEpisode(t, env.follower.ID, env.episode.ID)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, env.admin.ID)
}

func TestPublishSuccessWalksEveryPageOfFollowers(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	second := env.seedReader(t, "MEMBERFAIL06", "member6@fail.example.com", "Member Six")
	env.followSeries(t, second.ID)
	third := env.seedReader(t, "MEMBERFAIL07", "member7@fail.example.com", "Member Seven")
	env.followSeries(t, third.ID)
	r := env.runner()
	r.followerPageSize = 1

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, second.ID, third.ID, env.admin.ID)
}

func TestPublishSuccessSkipsReadersWhoFollowNothing(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	deleteFollows(t, pg)
	env.seedReader(t, "MEMBERFAIL08", "member8@fail.example.com", "Member Eight")
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
	assertPublishedUsers(t, pg, env.admin.ID)
	assertNotificationCounts(t, pg, notificationCounts{tenant: 1})
}

func TestPublishSuccessSkipsFollowersOfACreatorNotCreditedOnTheEpisode(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	deleteFollows(t, pg)
	formerCreator := pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{PublicID: "CREATORFAIL2", Name: "Former Creator"})
	pg.SeedSeriesCreator(t, env.tenant.ID, env.series.ID, formerCreator.ID, "")
	env.followCreator(t, env.follower.ID, formerCreator.ID)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertPublishedUsers(t, pg, env.admin.ID)
}

func TestPublishRetriesFollowerNotificationsAfterInsertFailure(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	otherFollower := env.seedReader(t, "MEMBERFAIL02", "member2@fail.example.com", "Member Two")
	env.followSeries(t, otherFollower.ID)
	r := env.runner()
	r.maxRetries = 1
	attempts := 0
	r.notify = func(ctx context.Context, q *dbmodels.Queries, row dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
		attempts++
		if attempts == 1 {
			return errors.New("insert boom")
		}
		return r.notifyFollowersOfPublish(ctx, q, row)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	if attempts != 2 {
		t.Fatalf("notify attempts = %d, want 2", attempts)
	}
	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
	assertFollowerPublishedNotifications(t, pg, env, env.follower.ID, otherFollower.ID, env.admin.ID)
}

func TestPublishSuccessSkipsOtherTenantAdmins(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	otherTenant := pg.SeedTenant(t, "TENANTFAIL02", "other.example.com", "Other Tenant")
	otherAdmin := pg.SeedTenantAdmin(t, otherTenant.ID, "ADMINOTHER01", "admin@other.example.com", "Other Admin")
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertPublishedUsers(t, pg, env.admin.ID, env.follower.ID)
	for _, row := range listTenantNotifications(t, pg) {
		if row.UserID == otherAdmin.ID {
			t.Fatal("notified other tenant admin")
		}
	}
	assertNotificationCounts(t, pg, notificationCounts{tenant: 2})
}

func TestPublishSuccessSkipsFollowersOfAnotherTenant(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	otherTenant := pg.SeedTenant(t, "TENANTFAIL02", "other.example.com", "Other Tenant")
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESFAIL02",
		Title:     "Other Series",
		Published: true,
	})
	otherMember := pg.SeedEndUser(t, otherTenant.ID, "MEMBEROTHER1", "member@other.example.com", "Other Member")
	insertFollow(t, pg, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", otherTenant.ID, otherMember.ID, otherSeries.ID)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	assertPublishedUsers(t, pg, env.admin.ID, env.follower.ID)
	for _, row := range listTenantNotifications(t, pg) {
		if row.UserID == otherMember.ID {
			t.Fatal("notified a follower of another tenant")
		}
	}
	assertNotificationCounts(t, pg, notificationCounts{tenant: 2})
}

func TestPublishSuccessDoesNotNotifyOperators(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	r := env.runner()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusPublished {
		t.Fatalf("listing status = %q, want %s", got, testutil.EpisodeStatusPublished)
	}
	assertNotificationCounts(t, pg, notificationCounts{tenant: 2})
}

func TestPublishNegativeMaxRetriesRunsOneAttempt(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	r := New(pg.DB, dbmodels.New(pg.DB), nil, slog.New(slog.NewTextHandler(io.Discard, nil)), -1)
	attempts := 0
	r.publish = func(context.Context, dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
		attempts++
		return errors.New("publish boom")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	if attempts != 1 {
		t.Fatalf("publish attempts = %d, want 1", attempts)
	}
	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusScheduled {
		t.Fatalf("listing status = %q, want still %s", got, testutil.EpisodeStatusScheduled)
	}
}

func TestPublishFinalFailureNotifiesEachOperatorOnce(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	r := env.runner()
	r.publish = func(context.Context, dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
		return errors.New("publish boom")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)
	r.RunOnce(ctx)

	if got := listingStatus(t, pg, env.episode.ID); got != testutil.EpisodeStatusScheduled {
		t.Fatalf("listing status = %q, want still %s", got, testutil.EpisodeStatusScheduled)
	}

	rows := listPlatformNotifications(t, pg)
	if len(rows) != 2 {
		t.Fatalf("platform_notifications = %d, want 2", len(rows))
	}

	gotOperators := map[uuid.UUID]dbmodels.PlatformNotification{}
	for _, row := range rows {
		if _, exists := gotOperators[row.PlatformUserID]; exists {
			t.Fatalf("duplicate notification for operator %s", row.PlatformUserID)
		}
		gotOperators[row.PlatformUserID] = row
	}
	if _, ok := gotOperators[env.operator.ID]; !ok {
		t.Fatal("missing notification for first operator")
	}
	if _, ok := gotOperators[env.otherOperator.ID]; !ok {
		t.Fatal("missing notification for second operator")
	}

	for _, row := range rows {
		if row.NotificationType != notificationTypeEpisodePublishFailed {
			t.Fatalf("type = %q, want %s", row.NotificationType, notificationTypeEpisodePublishFailed)
		}
		if row.SubjectKey != "episode:"+env.episode.PublicID {
			t.Fatalf("subject_key = %q, want episode:%s", row.SubjectKey, env.episode.PublicID)
		}
		var payload episodePublishFailedPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatalf("payload: %v", err)
		}
		if payload != (episodePublishFailedPayload{
			EpisodeID:    env.episode.PublicID,
			EpisodeTitle: "Failed Episode",
			SeriesID:     env.series.PublicID,
			SeriesTitle:  "Failed Series",
			TenantID:     env.tenant.PublicID,
			TenantName:   "Failed Tenant",
		}) {
			t.Fatalf("payload = %+v", payload)
		}
	}

	assertNotificationCounts(t, pg, notificationCounts{platform: 2, tenant: 1})

	tenantRows := listTenantNotifications(t, pg)
	if len(tenantRows) != 1 {
		t.Fatalf("notifications = %d, want 1 admin row", len(tenantRows))
	}
	if tenantRows[0].UserID != env.admin.ID {
		t.Fatalf("user_id = %s, want admin %s", tenantRows[0].UserID, env.admin.ID)
	}
	if tenantRows[0].NotificationType != notificationTypeEpisodePublishFailed {
		t.Fatalf("type = %q, want %s", tenantRows[0].NotificationType, notificationTypeEpisodePublishFailed)
	}
}

func TestPublishFinalFailureNotifiesEachAdminOnce(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	editor := pg.SeedTenantUser(t, env.tenant.ID, "EDITORFAIL01", "editor@fail.example.com", "Editor", "tenant_editor")
	r := env.runner()
	r.publish = func(context.Context, dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
		return errors.New("publish boom")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	r.RunOnce(ctx)
	r.RunOnce(ctx)

	rows := listTenantNotifications(t, pg)
	if len(rows) != 2 {
		t.Fatalf("notifications = %d, want 2", len(rows))
	}

	gotAdmins := map[uuid.UUID]dbmodels.Notification{}
	for _, row := range rows {
		if _, exists := gotAdmins[row.UserID]; exists {
			t.Fatalf("duplicate notification for admin %s", row.UserID)
		}
		gotAdmins[row.UserID] = row
		if row.NotificationType != notificationTypeEpisodePublishFailed {
			t.Fatalf("type = %q, want %s", row.NotificationType, notificationTypeEpisodePublishFailed)
		}
		if row.SubjectKey != "episode:"+env.episode.PublicID {
			t.Fatalf("subject_key = %q, want episode:%s", row.SubjectKey, env.episode.PublicID)
		}
		var payload episodePublishedPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatalf("payload: %v", err)
		}
		if payload != (episodePublishedPayload{
			EpisodeID:    env.episode.PublicID,
			EpisodeTitle: "Failed Episode",
			SeriesID:     env.series.PublicID,
			SeriesTitle:  "Failed Series",
		}) {
			t.Fatalf("payload = %+v", payload)
		}
	}
	if _, ok := gotAdmins[env.admin.ID]; !ok {
		t.Fatal("missing notification for tenant admin")
	}
	if _, ok := gotAdmins[editor.ID]; !ok {
		t.Fatal("missing notification for tenant editor")
	}

	assertNotificationCounts(t, pg, notificationCounts{platform: 2, tenant: 2})
}

func TestPublishFinalFailureSkipsUsersWithoutOperatorRole(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	seedPlatformUserWithoutRole(t, pg, "PLATNOROLE01", "norole@example.com", "No Role")
	r := env.runner()
	r.publish = func(context.Context, dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow) error {
		return errors.New("publish boom")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.RunOnce(ctx)

	rows := listPlatformNotifications(t, pg)
	if len(rows) != 2 {
		t.Fatalf("platform_notifications = %d, want 2 operator rows", len(rows))
	}
}

type publishTestEnv struct {
	pg            *testutil.PostgresEnv
	tenant        testutil.Tenant
	series        testutil.Series
	episode       testutil.Episode
	creator       testutil.Creator
	admin         testutil.TenantUser
	follower      testutil.TenantUser
	operator      testutil.PlatformOperator
	otherOperator testutil.PlatformOperator
}

func newPublishTestEnv(t *testing.T) (*testutil.PostgresEnv, publishTestEnv) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTFAIL01", "fail.example.com", "Failed Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESFAIL01",
		Title:     "Failed Series",
		Published: true,
	})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "EPISODEFAIL1",
		Title:       "Failed Episode",
		Status:      testutil.EpisodeStatusScheduled,
		ScheduledAt: time.Now().Add(-time.Minute),
	})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORFAIL1", Name: "Credited Creator"})
	pg.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")

	env := publishTestEnv{
		pg:            pg,
		tenant:        tenant,
		series:        series,
		episode:       episode,
		creator:       creator,
		admin:         pg.SeedTenantAdmin(t, tenant.ID, "ADMINFAIL001", "admin@fail.example.com", "Tenant Admin"),
		follower:      pg.SeedEndUser(t, tenant.ID, "MEMBERFAIL01", "member@fail.example.com", "Member"),
		operator:      pg.SeedPlatformOperator(t, "PLATFAIL0001", "op1@example.com", "Operator One"),
		otherOperator: pg.SeedPlatformOperator(t, "PLATFAIL0002", "op2@example.com", "Operator Two"),
	}
	// The tenant's one reader follows the series, so the default environment
	// publishes to exactly one recipient. A test about who is reached seeds
	// the follows it is interested in instead.
	env.followSeries(t, env.follower.ID)

	return pg, env
}

func (env publishTestEnv) followSeries(t *testing.T, userID uuid.UUID) {
	t.Helper()
	insertFollow(t, env.pg, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", env.tenant.ID, userID, env.series.ID)
}

func (env publishTestEnv) followCreator(t *testing.T, userID, creatorID uuid.UUID) {
	t.Helper()
	insertFollow(t, env.pg, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", env.tenant.ID, userID, creatorID)
}

func (env publishTestEnv) followEpisode(t *testing.T, userID, episodeID uuid.UUID) {
	t.Helper()
	insertFollow(t, env.pg, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", env.tenant.ID, userID, episodeID)
}

func (env publishTestEnv) seedReader(t *testing.T, publicID, email, name string) testutil.TenantUser {
	t.Helper()
	return env.pg.SeedEndUser(t, env.tenant.ID, publicID, email, name)
}

func (env publishTestEnv) readyRow() dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow {
	return dbmodels.ListEpisodesReadyToPublishWithTenantInfoRow{
		EpisodeID:       env.episode.ID,
		EpisodePublicID: env.episode.PublicID,
		EpisodeTitle:    env.episode.Title,
		SeriesPublicID:  env.series.PublicID,
		SeriesTitle:     env.series.Title,
		TenantID:        env.tenant.ID,
		TenantPublicID:  env.tenant.PublicID,
		TenantName:      env.tenant.Name,
		TenantDomain:    env.tenant.Domain,
	}
}

func (env publishTestEnv) runner() *Runner {
	return New(
		env.pg.DB,
		dbmodels.New(env.pg.DB),
		nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		0,
	)
}

type notificationCounts struct {
	platform      int
	tenant        int
	announcements int
}

func assertNotificationCounts(t *testing.T, pg *testutil.PostgresEnv, want notificationCounts) {
	t.Helper()
	if got := countTable(t, pg, "platform_notifications"); got != want.platform {
		t.Fatalf("platform_notifications = %d, want %d", got, want.platform)
	}
	if got := countTable(t, pg, "notifications"); got != want.tenant {
		t.Fatalf("notifications = %d, want %d", got, want.tenant)
	}
	if got := countTable(t, pg, "announcements"); got != want.announcements {
		t.Fatalf("announcements = %d, want %d", got, want.announcements)
	}
}

func assertPublishedUsers(t *testing.T, pg *testutil.PostgresEnv, userIDs ...uuid.UUID) {
	t.Helper()
	rows := listTenantNotifications(t, pg)
	if len(rows) != len(userIDs) {
		t.Fatalf("notifications = %d, want %d", len(rows), len(userIDs))
	}
	got := map[uuid.UUID]struct{}{}
	for _, row := range rows {
		got[row.UserID] = struct{}{}
	}
	for _, userID := range userIDs {
		if _, ok := got[userID]; !ok {
			t.Fatalf("missing notification for %s", userID)
		}
	}
}

func listingStatus(t *testing.T, pg *testutil.PostgresEnv, episodeID uuid.UUID) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var status string
	if err := pg.DB.QueryRowContext(ctx, `SELECT status FROM episode_listings WHERE episode_id = $1`, episodeID).Scan(&status); err != nil {
		t.Fatalf("listing status: %v", err)
	}
	return status
}

func assertFollowerPublishedNotifications(t *testing.T, pg *testutil.PostgresEnv, env publishTestEnv, recipientIDs ...uuid.UUID) {
	t.Helper()
	rows := listTenantNotifications(t, pg)
	if len(rows) != len(recipientIDs) {
		t.Fatalf("notifications = %d, want %d", len(rows), len(recipientIDs))
	}

	gotRecipients := map[uuid.UUID]dbmodels.Notification{}
	for _, row := range rows {
		if _, exists := gotRecipients[row.UserID]; exists {
			t.Fatalf("duplicate notification for %s", row.UserID)
		}
		gotRecipients[row.UserID] = row
	}
	for _, recipientID := range recipientIDs {
		if _, ok := gotRecipients[recipientID]; !ok {
			t.Fatalf("missing notification for %s", recipientID)
		}
	}

	for _, row := range rows {
		if row.TenantID != env.tenant.ID {
			t.Fatalf("tenant_id = %s, want %s", row.TenantID, env.tenant.ID)
		}
		if row.NotificationType != notificationTypeEpisodePublished {
			t.Fatalf("type = %q, want %s", row.NotificationType, notificationTypeEpisodePublished)
		}
		if row.SubjectKey != "episode:"+env.episode.PublicID {
			t.Fatalf("subject_key = %q, want episode:%s", row.SubjectKey, env.episode.PublicID)
		}
		var payload episodePublishedPayload
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatalf("payload: %v", err)
		}
		if payload != (episodePublishedPayload{
			EpisodeID:    env.episode.PublicID,
			EpisodeTitle: "Failed Episode",
			SeriesID:     env.series.PublicID,
			SeriesTitle:  "Failed Series",
		}) {
			t.Fatalf("payload = %+v", payload)
		}
	}

	assertNotificationCounts(t, pg, notificationCounts{tenant: len(recipientIDs)})
}

// insertFollow writes a follow row through the superuser connection, which is
// not subject to the member isolation policy these tables carry.
func insertFollow(t *testing.T, pg *testutil.PostgresEnv, statement string, tenantID, userID, targetID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, statement, tenantID, userID, targetID); err != nil {
		t.Fatalf("insert follow for %s: %v", userID, err)
	}
}

func deleteFollows(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, table := range []string{"series_follows", "creator_follows", "episode_follows"} {
		if _, err := pg.DB.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			t.Fatalf("delete %s: %v", table, err)
		}
	}
}

func listTenantNotifications(t *testing.T, pg *testutil.PostgresEnv) []dbmodels.Notification {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT id, tenant_id, user_id, notification_type, subject_key, payload, created_at
		FROM notifications
		ORDER BY user_id
	`)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var items []dbmodels.Notification
	for rows.Next() {
		var item dbmodels.Notification
		if err := rows.Scan(
			&item.ID,
			&item.TenantID,
			&item.UserID,
			&item.NotificationType,
			&item.SubjectKey,
			&item.Payload,
			&item.CreatedAt,
		); err != nil {
			t.Fatalf("scan notifications: %v", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	return items
}

func listPlatformNotifications(t *testing.T, pg *testutil.PostgresEnv) []dbmodels.PlatformNotification {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT id, platform_user_id, notification_type, subject_key, payload, created_at
		FROM platform_notifications
		ORDER BY platform_user_id
	`)
	if err != nil {
		t.Fatalf("list platform_notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var items []dbmodels.PlatformNotification
	for rows.Next() {
		var item dbmodels.PlatformNotification
		if err := rows.Scan(
			&item.ID,
			&item.PlatformUserID,
			&item.NotificationType,
			&item.SubjectKey,
			&item.Payload,
			&item.CreatedAt,
		); err != nil {
			t.Fatalf("scan platform_notifications: %v", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate platform_notifications: %v", err)
	}
	return items
}

func countTable(t *testing.T, pg *testutil.PostgresEnv, table string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return count
}

func seedPlatformUserWithoutRole(t *testing.T, pg *testutil.PostgresEnv, publicID, email, name string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(pg.DB).CreatePlatformUser(ctx, dbmodels.CreatePlatformUserParams{
		ID:           uuid.Must(uuid.NewV7()),
		PublicID:     publicID,
		Email:        email,
		PasswordHash: "unused-hash",
		Name:         name,
	}); err != nil {
		t.Fatalf("CreatePlatformUser: %v", err)
	}
}
