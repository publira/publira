package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

func pinnedAnnouncementRow(
	id, tenantID uuid.UUID,
	createdAt time.Time,
	pinnedUntil sql.NullTime,
) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "target_user_id", "announcement_type", "title", "body",
		"link_url", "metadata", "created_at", "pinned", "pinned_until",
	}).AddRow(
		id, tenantID, uuid.NullUUID{}, "announcement", "Maintenance tonight", "We will be down for an hour",
		"/pages/maintenance", json.RawMessage("{}"), createdAt, true, pinnedUntil,
	)
}

func TestAuthGetPinnedAnnouncementAnswersWithoutASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)
	until := now.Add(24 * time.Hour)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPinnedAnnouncementForTenant)).
		WithArgs(tenantID).
		WillReturnRows(pinnedAnnouncementRow(announcementID, tenantID, now, sql.NullTime{Time: until, Valid: true}))

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPinnedAnnouncement(context.Background(), connect.NewRequest(&publirav1.GetPinnedAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetPinnedAnnouncement: %v", err)
	}

	item := resp.Msg.Announcement
	if item == nil {
		t.Fatal("announcement = nil, want the pinned row")
	}
	if item.Id != announcementID.String() {
		t.Fatalf("id = %q, want %q", item.Id, announcementID.String())
	}
	if !item.Pinned {
		t.Fatal("pinned = false, want true")
	}
	if got, want := item.PinnedUntil, until.Format(time.RFC3339); got != want {
		t.Fatalf("pinned_until = %q, want %q", got, want)
	}
	if item.IsRead {
		t.Fatal("is_read = true, want false: the answer names no reader")
	}

	assertPublicExpectations(t, mock)
}

// Nothing pinned is an answer rather than a failure, so the banner is simply
// not drawn.
func TestAuthGetPinnedAnnouncementIsEmptyWhenNothingIsPinned(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Second)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPinnedAnnouncementForTenant)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPinnedAnnouncement(context.Background(), connect.NewRequest(&publirav1.GetPinnedAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("GetPinnedAnnouncement: %v", err)
	}
	if resp.Msg.Announcement != nil {
		t.Fatalf("announcement = %v, want none", resp.Msg.Announcement)
	}

	assertPublicExpectations(t, mock)
}

// guestAnnouncementRow is what the query answers a caller it was given no user
// for: the `announcement_reads` join matches nothing, so the read state comes
// back as the SQL expression's own false rather than as NULL.
func guestAnnouncementRow(
	id, tenantID uuid.UUID,
	title string,
	createdAt time.Time,
) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "target_user_id", "announcement_type", "title", "body",
		"link_url", "metadata", "created_at", "pinned", "pinned_until", "is_read", "read_at",
	}).AddRow(
		id, tenantID, uuid.NullUUID{}, "announcement", title, "The latest episode is out",
		"/series/S001", json.RawMessage("{}"), createdAt, false, sql.NullTime{},
		false, sql.NullTime{},
	)
}

// A visitor who never signed in reads the tenant-wide rows, and the query is
// told there is no reader to attach read state to.
func TestAuthListAnnouncementsAnswersAVisitorWithNoSession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForUserDesc)).
		WithArgs(uuid.NullUUID{}, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(guestAnnouncementRow(announcementID, tenantID, "New Episode", now))

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListAnnouncements(context.Background(), connect.NewRequest(&publirav1.ListAnnouncementsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Msg.Announcements) != 1 {
		t.Fatalf("announcements = %d, want 1", len(resp.Msg.Announcements))
	}

	item := resp.Msg.Announcements[0]
	if item.IsRead {
		t.Fatal("is_read = true, want false: a visitor with no session has no read state")
	}
	if item.ReadAt != "" {
		t.Fatalf("read_at = %q, want empty", item.ReadAt)
	}

	assertPublicExpectations(t, mock)
}
