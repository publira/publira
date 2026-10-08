package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestCreateAnnouncementPinnedStoresTheWindow(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	until := now.Add(48 * time.Hour).Truncate(time.Second)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateAnnouncement)).
		WithArgs(
			sqlmock.AnyArg(), tenantID, "announcement", "Maintenance", "Body",
			sqlmock.AnyArg(), json.RawMessage("{}"), true, sql.NullTime{Time: until, Valid: true},
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "announcement_type", "title", "body",
			"link_url", "metadata", "created_at", "pinned", "pinned_until",
		}).AddRow(
			announcementID, tenantID, "announcement", "Maintenance", "Body",
			nil, json.RawMessage("{}"), now, true, sql.NullTime{Time: until, Valid: true},
		))
	expectAnnouncementNotificationEvent(mock, tenantID, announcementID)
	mock.ExpectCommit()

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateAnnouncementRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:       "Maintenance",
		Body:        "Body",
		Pinned:      true,
		PinnedUntil: until.Format(time.RFC3339),
	}

	resp, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	if !resp.Announcement.GetPinned() {
		t.Fatal("pinned = false, want true")
	}
	if got, want := resp.Announcement.GetPinnedUntil(), until.Format(time.RFC3339); got != want {
		t.Fatalf("pinned_until = %q, want %q", got, want)
	}

	assertExpectations(t, mock)
}

func TestCreateAnnouncementRefusesAPinItCannotShow(t *testing.T) {
	tests := []struct {
		name        string
		pinnedUntil string
	}{
		{
			name:        "window already closed",
			pinnedUntil: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		},
		{
			name:        "window is not an instant",
			pinnedUntil: "tomorrow",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			req := &publiraadminv1.CreateAnnouncementRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Title:       "Maintenance",
				Body:        "Body",
				Pinned:      true,
				PinnedUntil: test.pinnedUntil,
			}

			_, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateAnnouncement error = %v, want invalid_argument", err)
			}

			assertExpectations(t, mock)
		})
	}
}

func TestUnpinAnnouncementClearsTheFlag(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UnpinAnnouncement)).
		WithArgs(announcementID, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(announcementID))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	req := &publiraadminv1.UnpinAnnouncementRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		AnnouncementId: announcementID.String(),
	}

	if _, err := client.UnpinAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("UnpinAnnouncement: %v", err)
	}

	assertExpectations(t, mock)
}

// An announcement owned by another tenant reaches no row here, which is the
// same answer as one that never existed.
func TestUnpinAnnouncementReportsAMissingRow(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UnpinAnnouncement)).
		WithArgs(announcementID, tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	req := &publiraadminv1.UnpinAnnouncementRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		AnnouncementId: announcementID.String(),
	}

	_, err := client.UnpinAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UnpinAnnouncement error = %v, want not_found", err)
	}

	assertExpectations(t, mock)
}
