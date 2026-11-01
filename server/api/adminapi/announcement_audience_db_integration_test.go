package adminapi

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) announcementClient() publiraadminv1connect.AdminAnnouncementServiceClient {
	return publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// An announcement posted with two conditions stores them, and the worker writes
// a row for exactly the readers who meet both when it delivers, and queues the
// mail that mirrors them. A reader who comes to meet them afterwards is not
// sent it: the audience is evaluated once, at delivery.
func TestDBTargetedAnnouncementReachesTheReadersItsAudienceSelectsAtDelivery(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "AUDTENANT01", "audience.example.com", "Audience Tenant", "AUDADMIN0001", "admin@audience.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "AUDSERIES001", Title: "Followed Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "AUDEPISODE01", Title: "Episode", Price: 100, Status: testutil.EpisodeStatusPublished})
	recipient := env.PG.SeedEndUser(t, tenant.Tenant.ID, "AUDREADER001", "recipient@audience.example.com", "Follower Yet To Buy")
	buyer := env.PG.SeedEndUser(t, tenant.Tenant.ID, "AUDREADER002", "buyer@audience.example.com", "Follower Who Bought")
	latecomer := env.PG.SeedEndUser(t, tenant.Tenant.ID, "AUDREADER003", "latecomer@audience.example.com", "Follows Later")
	for _, reader := range []testutil.TenantUser{recipient, buyer} {
		if _, err := env.PG.DB.ExecContext(t.Context(), "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.Tenant.ID, reader.ID, series.ID); err != nil {
			t.Fatalf("follow: %v", err)
		}
	}
	env.PG.SeedPurchase(t, tenant.Tenant.ID, buyer.ID, episode.ID, 100)

	res, err := env.announcementClient().CreateAnnouncement(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateAnnouncementRequest{
		Tenant:       tenant.tenantContext(),
		Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Volume 2 is out", Body: "Read it now."}},
		Audience: &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
			{Condition: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_{
				FollowsSeries: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries{SeriesPublicId: series.PublicID},
			}},
			{Condition: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased_{
				NeverPurchased: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased{},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	announcementID := uuid.MustParse(res.Announcement.Id)
	if got := res.Announcement.GetAudience().GetConditions(); len(got) != 2 || got[0].GetFollowsSeries().GetSeriesPublicId() != series.PublicID || got[1].GetNeverPurchased() == nil {
		t.Fatalf("answered audience = %v, want the two conditions sent", res.Announcement.GetAudience())
	}

	var stored json.RawMessage
	if err := env.PG.DB.QueryRowContext(t.Context(), "SELECT audience FROM announcements WHERE id = $1", announcementID).Scan(&stored); err != nil {
		t.Fatalf("read stored audience: %v", err)
	}
	var decoded, want any
	_ = json.Unmarshal(stored, &decoded)
	_ = json.Unmarshal([]byte(`{"version": 1, "conditions": [{"type": "follows_series", "series_id": "`+series.ID.String()+`"}, {"type": "never_purchased"}]}`), &want)
	if storedJSON, wantJSON := mustJSON(t, decoded), mustJSON(t, want); storedJSON != wantJSON {
		t.Fatalf("stored audience = %s, want %s", storedJSON, wantJSON)
	}

	var reason string
	if err := env.PG.DB.QueryRowContext(t.Context(),
		"SELECT reason FROM audit_logs WHERE tenant_id = $1 AND action = 'announcement_created' AND target_id = $2",
		tenant.Tenant.ID, announcementID.String(),
	).Scan(&reason); err != nil {
		t.Fatalf("read audit entry: %v", err)
	}
	if reason != "delivery=preferred;audience=targeted" {
		t.Fatalf("audit reason = %q, want delivery=preferred;audience=targeted", reason)
	}

	if events := env.pendingOutboxEvents(t, outbox.EventTypeAnnouncementNotification); len(events) != 0 {
		t.Fatalf("queued %d %s events, want none: the previous release's worker would deliver one to everyone", len(events), outbox.EventTypeAnnouncementNotification)
	}
	handlers := map[string]func(context.Context, dbmodels.OutboxEvent) error{
		outbox.EventTypeTargetedAnnouncementNotification: outbox.NewAnnouncementNotificationHandler(outbox.AnnouncementNotificationHandlerConfig{DB: env.PG.OpenOutboxDB(t)}),
	}
	if events := env.pendingOutboxEvents(t, outbox.EventTypeTargetedAnnouncementNotification); len(events) != 1 {
		t.Fatalf("queued %d %s events, want 1", len(events), outbox.EventTypeTargetedAnnouncementNotification)
	}
	env.PG.ProcessPendingOutboxEvents(t, handlers)

	if got := announcementRecipients(t, env, announcementID); !slices.Equal(got, []uuid.UUID{recipient.ID}) {
		t.Fatalf("notified %v, want only %s", got, recipient.ID)
	}
	if mail := env.pendingOutboxEvents(t, outbox.EventTypeNotificationEmail); len(mail) != 1 || !strings.Contains(string(mail[0].Payload), outbox.AnnouncementSubjectKey(announcementID)) {
		t.Fatalf("queued mail = %v, want the one notification_email for the announcement", mail)
	}

	if _, err := env.PG.DB.ExecContext(t.Context(), "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.Tenant.ID, latecomer.ID, series.ID); err != nil {
		t.Fatalf("follow later: %v", err)
	}
	env.PG.ProcessPendingOutboxEvents(t, handlers)
	if got := announcementRecipients(t, env, announcementID); !slices.Equal(got, []uuid.UUID{recipient.ID}) {
		t.Fatalf("notified %v after a reader came to match, want only %s", got, recipient.ID)
	}

	listed, err := env.announcementClient().ListAnnouncements(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListAnnouncementsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(listed.Announcements) != 1 || listed.Announcements[0].GetAudience().GetConditions()[0].GetFollowsSeries().GetSeriesPublicId() != series.PublicID {
		t.Fatalf("listed = %v, want the announcement with its audience", listed.Announcements)
	}
}

// Every audience CreateAnnouncement must refuse is invalid_argument, and none
// of them stores an announcement.
func TestDBCreateAnnouncementRefusesAnAudienceItCannotDeliver(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "AUDTENANT02", "refuse.example.com", "Refusing Tenant", "AUDADMIN0002", "admin@refuse.example.com")
	foreign := env.seedTenantWithAdmin(t, "AUDTENANT03", "foreign.example.com", "Foreign Tenant", "AUDADMIN0003", "admin@foreign.example.com")
	foreignSeries := env.PG.SeedSeries(t, foreign.Tenant.ID, testutil.SeriesSeed{PublicID: "AUDFOREIGN01", Title: "Another Tenant's Series"})

	neverPurchased := &publiraadminv1.AnnouncementAudienceCondition{Condition: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased_{
		NeverPurchased: &publiraadminv1.AnnouncementAudienceCondition_NeverPurchased{},
	}}
	targeted := &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{neverPurchased}}

	for _, tc := range []struct {
		name   string
		modify func(*publiraadminv1.CreateAnnouncementRequest)
	}{
		{"pinned", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = targeted
			req.Pinned = true
		}},
		{"delivered to everyone", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = targeted
			req.Delivery = publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_EVERYONE
		}},
		{"another tenant's series", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
				{Condition: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries_{
					FollowsSeries: &publiraadminv1.AnnouncementAudienceCondition_FollowsSeries{SeriesPublicId: foreignSeries.PublicID},
				}},
			}}
		}},
		{"a type twice", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{neverPurchased, neverPurchased}}
		}},
		{"no conditions", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = &publiraadminv1.AnnouncementAudience{}
		}},
		{"days out of range", func(req *publiraadminv1.CreateAnnouncementRequest) {
			req.Audience = &publiraadminv1.AnnouncementAudience{Conditions: []*publiraadminv1.AnnouncementAudienceCondition{
				{Condition: &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays_{
					SignedUpWithinDays: &publiraadminv1.AnnouncementAudienceCondition_SignedUpWithinDays{Days: 3651},
				}},
			}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := &publiraadminv1.CreateAnnouncementRequest{
				Tenant:       tenant.tenantContext(),
				Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Title", Body: "Body"}},
			}
			tc.modify(req)
			_, err := env.announcementClient().CreateAnnouncement(testutil.WithBearer(context.Background(), tenant.token()), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateAnnouncement code = %v (err=%v), want invalid_argument", connect.CodeOf(err), err)
			}
		})
	}

	var count int
	if err := env.PG.DB.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM announcements").Scan(&count); err != nil {
		t.Fatalf("count announcements: %v", err)
	}
	if count != 0 {
		t.Fatalf("stored %d announcements, want none", count)
	}
}

// announcementRecipients reads who has the announcement's notification row, in
// id order.
func announcementRecipients(t *testing.T, env *adminDBEnv, announcementID uuid.UUID) []uuid.UUID {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(t.Context(),
		"SELECT user_id FROM notifications WHERE notification_type = $1 AND subject_key = $2 ORDER BY user_id",
		outbox.NotificationTypeAnnouncementPosted, outbox.AnnouncementSubjectKey(announcementID))
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	return ids
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return string(encoded)
}
