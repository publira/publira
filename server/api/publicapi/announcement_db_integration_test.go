package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
)

func TestDBGetAnnouncementReturnsInboxRowByID(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	broadcastID := insertAnnouncement(t, env, tenant.ID, uuid.NullUUID{}, "/series/S001", "Broadcast")
	mineID := insertAnnouncement(t, env, tenant.ID, uuid.NullUUID{UUID: member.ID, Valid: true}, "https://example.com/a", "Addressed to me")

	client := env.authClient()
	token := tokenFor(t, tenant, member)

	broadcast, err := client.GetAnnouncement(context.Background(), newBearerRequest(&publirav1.GetAnnouncementRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: broadcastID.String(),
	}, token))
	if err != nil {
		t.Fatalf("GetAnnouncement broadcast: %v", err)
	}
	if broadcast.Msg.Announcement.Id != broadcastID.String() {
		t.Fatalf("broadcast id = %q, want %q", broadcast.Msg.Announcement.Id, broadcastID)
	}
	if broadcast.Msg.Announcement.LinkUrl != "/series/S001" {
		t.Fatalf("broadcast link_url = %q, want /series/S001", broadcast.Msg.Announcement.LinkUrl)
	}
	if broadcast.Msg.Announcement.Title != "Broadcast" {
		t.Fatalf("broadcast title = %q, want Broadcast", broadcast.Msg.Announcement.Title)
	}

	mine, err := client.GetAnnouncement(context.Background(), newBearerRequest(&publirav1.GetAnnouncementRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: mineID.String(),
	}, token))
	if err != nil {
		t.Fatalf("GetAnnouncement targeted: %v", err)
	}
	if mine.Msg.Announcement.Id != mineID.String() {
		t.Fatalf("targeted id = %q, want %q", mine.Msg.Announcement.Id, mineID)
	}
	if mine.Msg.Announcement.LinkUrl != "https://example.com/a" {
		t.Fatalf("targeted link_url = %q", mine.Msg.Announcement.LinkUrl)
	}
}

func TestDBGetAnnouncementHidesRowsOutsideInbox(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	other := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")

	theirs := insertAnnouncement(t, env, first.ID, uuid.NullUUID{UUID: other.ID, Valid: true}, "/series/THEIRS", "Addressed to someone else")
	foreign := insertAnnouncement(t, env, second.ID, uuid.NullUUID{}, "/series/FOREIGN", "Another tenant")
	missing := uuid.Must(uuid.NewV7())

	client := env.authClient()
	token := tokenFor(t, first, member)

	for _, announcementID := range []uuid.UUID{theirs, foreign, missing} {
		_, err := client.GetAnnouncement(context.Background(), newBearerRequest(&publirav1.GetAnnouncementRequest{
			Tenant:         tenantContext(first),
			AnnouncementId: announcementID.String(),
		}, token))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetAnnouncement %s code = %v, want not_found (err=%v)", announcementID, connect.CodeOf(err), err)
		}
		if err.Error() != "not_found: announcement not found" {
			t.Fatalf("GetAnnouncement %s error = %q, want existence hidden", announcementID, err)
		}
	}
}

func insertAnnouncement(
	t *testing.T,
	env *publicDBEnv,
	tenantID uuid.UUID,
	targetUserID uuid.NullUUID,
	linkURL, title string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO announcements (
			id, tenant_id, target_user_id, announcement_type, title, body, link_url
		) VALUES ($1, $2, $3, 'announcement', $4, 'Body', $5)
	`, id, tenantID, targetUserID, title, sql.NullString{String: linkURL, Valid: linkURL != ""}); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	return id
}
