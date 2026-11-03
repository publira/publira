package adminapi

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The console lists how many readers each announcement was delivered to and
// how many opened it, counting rows its own connection cannot read: a targeted
// one counts the readers its audience selected, one for everyone counts every
// user of the tenant, and a scheduled one has reached nobody yet.
func TestDBListAnnouncementsCountsTheReadersDeliveredToAndThoseWhoOpenedIt(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "CNTTENANT01", "counts.example.com", "Counts Tenant", "CNTADMIN0001", "admin@counts.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "CNTSERIES001", Title: "Followed Series", Published: true})
	var followers []testutil.TenantUser
	for _, seed := range []struct{ publicID, email, name string }{
		{"CNTREADER001", "first@counts.example.com", "First Follower"},
		{"CNTREADER002", "second@counts.example.com", "Second Follower"},
		{"CNTREADER003", "third@counts.example.com", "Third Follower"},
	} {
		reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, seed.publicID, seed.email, seed.name)
		if _, err := env.PG.DB.ExecContext(t.Context(), "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.Tenant.ID, reader.ID, series.ID); err != nil {
			t.Fatalf("follow: %v", err)
		}
		followers = append(followers, reader)
	}
	env.PG.SeedEndUser(t, tenant.Tenant.ID, "CNTREADER004", "stranger@counts.example.com", "Follows Nothing")

	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.announcementClient()
	post := func(title string, audience *publiraadminv1.AnnouncementAudience, deliverAt string) uuid.UUID {
		t.Helper()
		created, err := client.CreateAnnouncement(ctx, &publiraadminv1.CreateAnnouncementRequest{
			Tenant:       tenant.tenantContext(),
			Translations: []*publiraadminv1.AnnouncementTranslation{{Title: title, Body: "Body."}},
			Audience:     audience,
			DeliverAt:    deliverAt,
		})
		if err != nil {
			t.Fatalf("CreateAnnouncement %q: %v", title, err)
		}
		if created.Announcement.GetDeliveredCount() != 0 || created.Announcement.GetOpenedCount() != 0 {
			t.Fatalf("CreateAnnouncement %q answers delivered=%d opened=%d, want 0 before the worker delivers it",
				title, created.Announcement.GetDeliveredCount(), created.Announcement.GetOpenedCount())
		}
		return uuid.MustParse(created.Announcement.Id)
	}
	targeted := post("For followers", &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
		{Condition: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_{
			FollowsSeries: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries{SeriesPublicId: series.PublicID},
		}},
	}}, "")
	everyone := post("For everyone", nil, "")
	scheduled := post("For later", nil, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))

	handler := outbox.NewAnnouncementNotificationHandler(outbox.AnnouncementNotificationHandlerConfig{DB: env.PG.OpenOutboxDB(t)})
	env.PG.ProcessPendingOutboxEvents(t, map[string]func(context.Context, dbmodels.OutboxEvent) error{
		outbox.EventTypeAnnouncementNotification:         handler,
		outbox.EventTypeTargetedAnnouncementNotification: handler,
	})
	if _, err := dbmodels.New(env.PG.DB).MarkAnnouncementAsRead(t.Context(), dbmodels.MarkAnnouncementAsReadParams{
		ID:       targeted,
		TenantID: tenant.Tenant.ID,
		UserID:   followers[0].ID,
	}); err != nil {
		t.Fatalf("MarkAnnouncementAsRead: %v", err)
	}
	var users int64
	if err := env.PG.DB.QueryRowContext(t.Context(), "SELECT count(*) FROM users WHERE tenant_id = $1", tenant.Tenant.ID).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}

	listed, err := client.ListAnnouncements(ctx, &publiraadminv1.ListAnnouncementsRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	want := map[uuid.UUID][2]int64{
		targeted:  {3, 1},
		everyone:  {users, 0},
		scheduled: {0, 0},
	}
	if len(listed.Announcements) != len(want) {
		t.Fatalf("listed %d announcements, want %d", len(listed.Announcements), len(want))
	}
	for _, announcement := range listed.Announcements {
		got := [2]int64{announcement.GetDeliveredCount(), announcement.GetOpenedCount()}
		if want := want[uuid.MustParse(announcement.Id)]; got != want {
			t.Errorf("%q delivered, opened = %v, want %v", announcement.GetTitle(), got, want)
		}
	}
}
