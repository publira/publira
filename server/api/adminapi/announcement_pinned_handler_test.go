package adminapi

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

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
			sqlmock.AnyArg(), tenantID, uuid.NullUUID{}, "announcement", "Maintenance", "Body",
			sqlmock.AnyArg(), json.RawMessage("{}"), true, sql.NullTime{Time: until, Valid: true},
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "target_user_id", "announcement_type", "title", "body",
			"link_url", "metadata", "created_at", "pinned", "pinned_until",
		}).AddRow(
			announcementID, tenantID, uuid.NullUUID{}, "announcement", "Maintenance", "Body",
			nil, json.RawMessage("{}"), now, true, sql.NullTime{Time: until, Valid: true},
		))
	expectAnnouncementNotificationEvent(mock, tenantID, announcementID)
	mock.ExpectCommit()

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateAnnouncementRequest{
		Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:        "Maintenance",
		Body:         "Body",
		AudienceType: publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS,
		Pinned:       true,
		PinnedUntil:  until.Format(time.RFC3339),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateAnnouncement(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	if !resp.Msg.Announcements[0].Pinned {
		t.Fatal("pinned = false, want true")
	}
	if got, want := resp.Msg.Announcements[0].PinnedUntil, until.Format(time.RFC3339); got != want {
		t.Fatalf("pinned_until = %q, want %q", got, want)
	}

	assertExpectations(t, mock)
}

func TestCreateAnnouncementRefusesAPinItCannotShow(t *testing.T) {
	tests := []struct {
		name         string
		audienceType publiraadminv1.AnnouncementAudienceType
		pinnedUntil  string
	}{
		{
			name:         "addressed to named readers",
			audienceType: publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS,
		},
		{
			name:         "window already closed",
			audienceType: publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS,
			pinnedUntil:  time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		},
		{
			name:         "window is not an instant",
			audienceType: publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS,
			pinnedUntil:  "tomorrow",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			req := connect.NewRequest(&publiraadminv1.CreateAnnouncementRequest{
				Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Title:               "Maintenance",
				Body:                "Body",
				AudienceType:        test.audienceType,
				TargetUserPublicIds: []string{"USER001"},
				Pinned:              true,
				PinnedUntil:         test.pinnedUntil,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			_, err := client.CreateAnnouncement(context.Background(), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UnpinAnnouncement)).
		WithArgs(announcementID, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(announcementID))
	expectAdminAuditLogInsert(mock)

	req := connect.NewRequest(&publiraadminv1.UnpinAnnouncementRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		AnnouncementId: announcementID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	if _, err := client.UnpinAnnouncement(context.Background(), req); err != nil {
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UnpinAnnouncement)).
		WithArgs(announcementID, tenantID).
		WillReturnError(sql.ErrNoRows)

	req := connect.NewRequest(&publiraadminv1.UnpinAnnouncementRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		AnnouncementId: announcementID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UnpinAnnouncement(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UnpinAnnouncement error = %v, want not_found", err)
	}

	assertExpectations(t, mock)
}
