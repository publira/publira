package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A targeted announcement is read only by the readers it was delivered to,
// which is the notification row the worker wrote for each of them: a visitor
// with no session never gets it, and a signed-in reader without that row gets
// it no more than a visitor does.
func TestDBTargetedAnnouncementIsReadOnlyByItsReaders(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTAUD", "audience.example.com", "Audience Tenant")
	recipient := env.PG.SeedEndUser(t, tenant.ID, "AUDREADER001", "recipient@audience.example.com", "Recipient")
	other := env.PG.SeedEndUser(t, tenant.ID, "AUDREADER002", "other@audience.example.com", "Other Reader")

	broadcastID := insertAnnouncement(t, env, tenant.ID, "", "For everyone")
	targetedID := insertAnnouncement(t, env, tenant.ID, "", "For readers yet to buy")
	setAnnouncementAudience(t, env, targetedID, `{"version": 1, "conditions": [{"type": "never_purchased"}]}`)
	deliverAnnouncement(t, env, tenant.ID, recipient.ID, targetedID)

	client := env.authClient()
	listed := func(ctx context.Context) []string {
		t.Helper()
		res, err := client.ListAnnouncements(ctx, &publirav1.ListAnnouncementsRequest{Tenant: tenantContext(tenant)})
		if err != nil {
			t.Fatalf("ListAnnouncements: %v", err)
		}
		ids := make([]string, 0, len(res.Announcements))
		for _, item := range res.Announcements {
			ids = append(ids, item.Id)
		}
		slices.Sort(ids)
		return ids
	}
	everyone := []string{broadcastID.String()}
	both := []string{broadcastID.String(), targetedID.String()}
	slices.Sort(both)

	recipientCtx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, recipient))
	otherCtx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, other))

	if got := listed(context.Background()); !slices.Equal(got, everyone) {
		t.Fatalf("visitor lists %v, want %v", got, everyone)
	}
	if got := listed(otherCtx); !slices.Equal(got, everyone) {
		t.Fatalf("reader without the row lists %v, want %v", got, everyone)
	}
	if got := listed(recipientCtx); !slices.Equal(got, both) {
		t.Fatalf("recipient lists %v, want %v", got, both)
	}

	get := func(ctx context.Context) error {
		_, err := client.GetAnnouncement(ctx, &publirav1.GetAnnouncementRequest{
			Tenant:         tenantContext(tenant),
			AnnouncementId: targetedID.String(),
		})
		return err
	}
	for name, ctx := range map[string]context.Context{"visitor": context.Background(), "reader without the row": otherCtx} {
		if err := get(ctx); connect.CodeOf(err) != connect.CodeNotFound || err.Error() != "not_found: announcement not found" {
			t.Fatalf("GetAnnouncement as %s = %v, want its existence hidden", name, err)
		}
	}
	if err := get(recipientCtx); err != nil {
		t.Fatalf("GetAnnouncement as the recipient: %v", err)
	}

	_, err := client.MarkAnnouncementAsRead(otherCtx, &publirav1.MarkAnnouncementAsReadRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: targetedID.String(),
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("MarkAnnouncementAsRead as a reader without the row = %v, want not_found", err)
	}

	for _, tc := range []struct {
		name string
		ctx  context.Context
		want int32
	}{
		{"reader without the row", otherCtx, 1},
		{"recipient", recipientCtx, 2},
	} {
		res, err := client.MarkAllAnnouncementsAsRead(tc.ctx, &publirav1.MarkAllAnnouncementsAsReadRequest{Tenant: tenantContext(tenant)})
		if err != nil {
			t.Fatalf("MarkAllAnnouncementsAsRead as %s: %v", tc.name, err)
		}
		if res.MarkedCount != tc.want {
			t.Fatalf("MarkAllAnnouncementsAsRead as %s marked %d, want %d", tc.name, res.MarkedCount, tc.want)
		}
	}
}

func setAnnouncementAudience(t *testing.T, env *publicDBEnv, announcementID uuid.UUID, audience string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE announcements SET audience = $2::jsonb WHERE id = $1", announcementID, audience); err != nil {
		t.Fatalf("set announcement audience: %v", err)
	}
}

// deliverAnnouncement writes the notification row the worker writes for each
// reader an announcement reaches.
func deliverAnnouncement(t *testing.T, env *publicDBEnv, tenantID, userID, announcementID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category)
		VALUES (uuidv7(), $1, $2, 'announcement_posted', 'announcement:' || $3::text, '{}', 'announcements')
	`, tenantID, userID, announcementID); err != nil {
		t.Fatalf("deliver announcement: %v", err)
	}
}
