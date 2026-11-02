package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/scheduledannouncements"
	"github.com/publira/publira/server/internal/testutil"
)

// publicAnnouncementReads reports which of the reads the storefront answers a
// reader from show the announcement: the inbox list, the announcement's own
// page, and the banner.
func publicAnnouncementReads(t *testing.T, env *adminDBEnv, tenantID, readerID, announcementID uuid.UUID) (listed, opened, banner bool) {
	t.Helper()

	queries := dbmodels.New(env.PG.DB)
	reader := uuid.NullUUID{UUID: readerID, Valid: true}
	rows, err := queries.ListAnnouncementsForUserDesc(t.Context(), dbmodels.ListAnnouncementsForUserDescParams{
		TenantID: tenantID,
		UserID:   reader,
		Locale:   "ja",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc: %v", err)
	}
	listed = slices.ContainsFunc(rows, func(row dbmodels.ListAnnouncementsForUserDescRow) bool { return row.ID == announcementID })

	_, err = queries.GetAnnouncementForUser(t.Context(), dbmodels.GetAnnouncementForUserParams{
		ID:       announcementID,
		TenantID: tenantID,
		UserID:   reader,
		Locale:   "ja",
	})
	switch {
	case err == nil:
		opened = true
	case !errors.Is(err, sql.ErrNoRows):
		t.Fatalf("GetAnnouncementForUser: %v", err)
	}

	pinned, err := queries.GetPinnedAnnouncementForTenant(t.Context(), dbmodels.GetPinnedAnnouncementForTenantParams{TenantID: tenantID, Locale: "ja"})
	switch {
	case err == nil:
		banner = pinned.ID == announcementID
	case !errors.Is(err, sql.ErrNoRows):
		t.Fatalf("GetPinnedAnnouncementForTenant: %v", err)
	}
	return listed, opened, banner
}

func auditActions(t *testing.T, env *adminDBEnv, tenantID, announcementID uuid.UUID) []string {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(t.Context(),
		"SELECT action FROM audit_logs WHERE tenant_id = $1 AND target_id = $2 ORDER BY created_at, id",
		tenantID, announcementID.String(),
	)
	if err != nil {
		t.Fatalf("read audit entries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var actions []string
	for rows.Next() {
		var action string
		if err := rows.Scan(&action); err != nil {
			t.Fatalf("scan audit entry: %v", err)
		}
		actions = append(actions, action)
	}
	return actions
}

// An announcement scheduled an hour ahead is the console's draft until its
// time: listed there as scheduled, absent from every read a reader is answered
// from and from their notifications, and editable. Once the job passes its
// time it is delivered, its banner is shown, its readers are notified, and it
// can no longer be edited or deleted.
func TestDBScheduledAnnouncementIsADraftUntilTheJobDeliversIt(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "SCHTENANT01", "schedule.example.com", "Schedule Tenant", "SCHADMIN0001", "admin@schedule.example.com")
	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "SCHREADER001", "reader@schedule.example.com", "Reader")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.announcementClient()

	deliverAt := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	created, err := client.CreateAnnouncement(ctx, &publiraadminv1.CreateAnnouncementRequest{
		Tenant:       tenant.tenantContext(),
		Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Volume 3 on Monday", Body: "Out at nine."}},
		Pinned:       true,
		PinnedUntil:  deliverAt.Add(24 * time.Hour).Format(time.RFC3339),
		DeliverAt:    deliverAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	announcementID := uuid.MustParse(created.Announcement.Id)
	if got := created.Announcement.GetDeliverAt(); got != deliverAt.Format(time.RFC3339) {
		t.Fatalf("deliver_at = %q, want %q", got, deliverAt.Format(time.RFC3339))
	}
	if got := created.Announcement.GetDeliveredAt(); got != "" {
		t.Fatalf("delivered_at = %q, want empty while scheduled", got)
	}

	listed, err := client.ListAnnouncements(ctx, &publiraadminv1.ListAnnouncementsRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(listed.Announcements) != 1 || listed.Announcements[0].GetDeliveredAt() != "" || listed.Announcements[0].GetDeliverAt() == "" {
		t.Fatalf("console lists %v, want the one announcement as scheduled", listed.Announcements)
	}
	if events := env.pendingOutboxEvents(t, outbox.EventTypeAnnouncementNotification); len(events) != 0 {
		t.Fatalf("queued %d notification events while scheduled, want none", len(events))
	}
	if listed, opened, banner := publicAnnouncementReads(t, env, tenant.Tenant.ID, reader.ID, announcementID); listed || opened || banner {
		t.Fatalf("readers see the scheduled announcement: listed=%v opened=%v banner=%v", listed, opened, banner)
	}

	updated, err := client.UpdateAnnouncement(ctx, &publiraadminv1.UpdateAnnouncementRequest{
		Tenant:         tenant.tenantContext(),
		AnnouncementId: announcementID.String(),
		Translations:   []*publiraadminv1.AnnouncementTranslation{{Title: "Volume 3 on Monday at nine", Body: "Out at nine sharp."}},
		Pinned:         true,
		DeliverAt:      deliverAt.Add(30 * time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateAnnouncement: %v", err)
	}
	if got := updated.Announcement.GetTitle(); got != "Volume 3 on Monday at nine" {
		t.Fatalf("updated title = %q, want the new one", got)
	}
	if got := updated.Announcement.GetPinnedUntil(); got != "" {
		t.Fatalf("updated pinned_until = %q, want it replaced with none", got)
	}
	if got := len(updated.Announcement.GetTranslations()); got != 1 {
		t.Fatalf("updated translations = %d, want the one sent in place of the old", got)
	}

	// The time passes.
	if _, err := env.PG.DB.ExecContext(t.Context(), "UPDATE announcements SET deliver_at = now() - interval '1 minute' WHERE id = $1", announcementID); err != nil {
		t.Fatalf("move deliver_at into the past: %v", err)
	}
	scheduledannouncements.New(env.PG.OpenTickerDB(t), nil, slog.New(slog.NewTextHandler(io.Discard, nil))).RunOnce(t.Context())

	env.PG.ProcessPendingOutboxEvents(t, map[string]func(context.Context, dbmodels.OutboxEvent) error{
		outbox.EventTypeAnnouncementNotification: outbox.NewAnnouncementNotificationHandler(outbox.AnnouncementNotificationHandlerConfig{DB: env.PG.OpenOutboxDB(t)}),
	})
	if got := announcementRecipients(t, env, announcementID); !slices.Contains(got, reader.ID) {
		t.Fatalf("notified %v, want the reader among them", got)
	}
	if listed, opened, banner := publicAnnouncementReads(t, env, tenant.Tenant.ID, reader.ID, announcementID); !listed || !opened || !banner {
		t.Fatalf("readers do not see the delivered announcement: listed=%v opened=%v banner=%v", listed, opened, banner)
	}

	_, err = client.UpdateAnnouncement(ctx, &publiraadminv1.UpdateAnnouncementRequest{
		Tenant:         tenant.tenantContext(),
		AnnouncementId: announcementID.String(),
		Translations:   []*publiraadminv1.AnnouncementTranslation{{Title: "Rewritten", Body: "Rewritten."}},
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdateAnnouncement after delivery code = %v (err=%v), want failed_precondition", connect.CodeOf(err), err)
	}
	_, err = client.DeleteAnnouncement(ctx, &publiraadminv1.DeleteAnnouncementRequest{
		Tenant:         tenant.tenantContext(),
		AnnouncementId: announcementID.String(),
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteAnnouncement after delivery code = %v (err=%v), want failed_precondition", connect.CodeOf(err), err)
	}

	if got := auditActions(t, env, tenant.Tenant.ID, announcementID); !slices.Equal(got, []string{"announcement_created", "announcement_updated"}) {
		t.Fatalf("audit actions = %v, want the post and the edit", got)
	}
}

// Saving a scheduled announcement with no time delivers it in that request, as
// posting one for now does.
func TestDBUpdateAnnouncementWithNoTimeDeliversItNow(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "SCHTENANT02", "schedule-now.example.com", "Schedule Now Tenant", "SCHADMIN0002", "admin@schedule-now.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.announcementClient()

	created, err := client.CreateAnnouncement(ctx, &publiraadminv1.CreateAnnouncementRequest{
		Tenant:       tenant.tenantContext(),
		Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Later", Body: "Body."}},
		DeliverAt:    time.Now().Add(time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	updated, err := client.UpdateAnnouncement(ctx, &publiraadminv1.UpdateAnnouncementRequest{
		Tenant:         tenant.tenantContext(),
		AnnouncementId: created.Announcement.Id,
		Translations:   []*publiraadminv1.AnnouncementTranslation{{Title: "Now", Body: "Body."}},
	})
	if err != nil {
		t.Fatalf("UpdateAnnouncement: %v", err)
	}
	if updated.Announcement.GetDeliveredAt() == "" {
		t.Fatal("delivered_at is empty, want the announcement delivered by the save")
	}
	events := env.pendingOutboxEvents(t, outbox.EventTypeAnnouncementNotification)
	if len(events) != 1 || events[0].IdempotencyKey != outbox.AnnouncementIdempotencyKey(uuid.MustParse(created.Announcement.Id)) {
		t.Fatalf("queued %v, want the announcement's one notification event", events)
	}
}

// Deleting a scheduled announcement takes its translations with it, and a
// second deletion finds nothing.
func TestDBDeleteAnnouncementRemovesAScheduledOne(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "SCHTENANT03", "schedule-delete.example.com", "Schedule Delete Tenant", "SCHADMIN0003", "admin@schedule-delete.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.announcementClient()

	created, err := client.CreateAnnouncement(ctx, &publiraadminv1.CreateAnnouncementRequest{
		Tenant:       tenant.tenantContext(),
		Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Typo", Body: "Body."}},
		DeliverAt:    time.Now().Add(time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	announcementID := uuid.MustParse(created.Announcement.Id)
	req := &publiraadminv1.DeleteAnnouncementRequest{Tenant: tenant.tenantContext(), AnnouncementId: announcementID.String()}
	if _, err := client.DeleteAnnouncement(ctx, req); err != nil {
		t.Fatalf("DeleteAnnouncement: %v", err)
	}

	var rows int
	if err := env.PG.DB.QueryRowContext(t.Context(),
		"SELECT (SELECT count(*) FROM announcements WHERE id = $1) + (SELECT count(*) FROM announcement_translations WHERE announcement_id = $1)",
		announcementID,
	).Scan(&rows); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("%d rows of the announcement remain, want none", rows)
	}
	if got := auditActions(t, env, tenant.Tenant.ID, announcementID); !slices.Equal(got, []string{"announcement_created", "announcement_deleted"}) {
		t.Fatalf("audit actions = %v, want the post and the deletion", got)
	}

	if _, err := client.DeleteAnnouncement(ctx, req); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second DeleteAnnouncement code = %v (err=%v), want not_found", connect.CodeOf(err), err)
	}
}

// A time already passed, and a banner asked to stop before the announcement
// goes out, are refused on both RPCs that take a time, and store nothing.
func TestDBAnnouncementRefusesATimeItCannotKeep(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "SCHTENANT04", "schedule-refuse.example.com", "Schedule Refuse Tenant", "SCHADMIN0004", "admin@schedule-refuse.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	client := env.announcementClient()

	deliverAt := time.Now().Add(2 * time.Hour)
	for _, tc := range []struct {
		name        string
		deliverAt   string
		pinnedUntil string
	}{
		{"deliver_at in the past", time.Now().Add(-time.Minute).Format(time.RFC3339), ""},
		{"deliver_at not an instant", "next monday", ""},
		{"pinned_until before deliver_at", deliverAt.Format(time.RFC3339), deliverAt.Add(-time.Hour).Format(time.RFC3339)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.CreateAnnouncement(ctx, &publiraadminv1.CreateAnnouncementRequest{
				Tenant:       tenant.tenantContext(),
				Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Title", Body: "Body"}},
				Pinned:       tc.pinnedUntil != "",
				PinnedUntil:  tc.pinnedUntil,
				DeliverAt:    tc.deliverAt,
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateAnnouncement code = %v (err=%v), want invalid_argument", connect.CodeOf(err), err)
			}
		})
	}

	var count int
	if err := env.PG.DB.QueryRowContext(t.Context(), "SELECT count(*) FROM announcements WHERE tenant_id = $1", tenant.Tenant.ID).Scan(&count); err != nil {
		t.Fatalf("count announcements: %v", err)
	}
	if count != 0 {
		t.Fatalf("stored %d announcements, want none", count)
	}
}
