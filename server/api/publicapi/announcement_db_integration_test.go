package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBGetAnnouncementReturnsTheTenantsRowByID(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	broadcastID := insertAnnouncement(t, env, tenant.ID, "/series/S001", "Broadcast")

	client := env.authClient()
	token := tokenFor(t, tenant, member)

	broadcast, err := client.GetAnnouncement(testutil.WithBearer(context.Background(), token), &publirav1.GetAnnouncementRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: broadcastID.String(),
	})
	if err != nil {
		t.Fatalf("GetAnnouncement broadcast: %v", err)
	}
	if broadcast.Announcement.Id != broadcastID.String() {
		t.Fatalf("broadcast id = %q, want %q", broadcast.Announcement.Id, broadcastID)
	}
	if broadcast.Announcement.LinkUrl != "/series/S001" {
		t.Fatalf("broadcast link_url = %q, want /series/S001", broadcast.Announcement.LinkUrl)
	}
	if broadcast.Announcement.Title != "Broadcast" {
		t.Fatalf("broadcast title = %q, want Broadcast", broadcast.Announcement.Title)
	}
}

func TestDBGetAnnouncementHidesRowsOutsideTheTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	foreign := insertAnnouncement(t, env, second.ID, "/series/FOREIGN", "Another tenant")
	missing := uuid.Must(uuid.NewV7())

	client := env.authClient()
	token := tokenFor(t, first, member)

	for _, announcementID := range []uuid.UUID{foreign, missing} {
		_, err := client.GetAnnouncement(testutil.WithBearer(context.Background(), token), &publirav1.GetAnnouncementRequest{
			Tenant:         tenantContext(first),
			AnnouncementId: announcementID.String(),
		})
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
	linkURL, title string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO announcements (
			id, tenant_id, announcement_type, title, body, link_url
		) VALUES ($1, $2, 'announcement', $3, 'Body', $4)
	`, id, tenantID, title, sql.NullString{String: linkURL, Valid: linkURL != ""}); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	return id
}
