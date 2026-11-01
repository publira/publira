package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func announcementColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"announcement_type",
		"title",
		"body",
		"link_url",
		"metadata",
		"created_at",
		"pinned",
		"pinned_until",
		"delivery",
		"audience",
	})
}

func addAnnouncementRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	title, body, linkURL string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		"announcement",
		title,
		body,
		sql.NullString{String: linkURL, Valid: linkURL != ""},
		json.RawMessage("{}"),
		createdAt,
		false,
		sql.NullTime{},
		outbox.AnnouncementDeliveryPreferred,
		nil,
	)
}

func newAnnouncementClient(
	t *testing.T,
	tenantID, actorID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminAnnouncementServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock, sessionToken
}

func newAnnouncementRequest(tenantID uuid.UUID) *publiraadminv1.ListAnnouncementsRequest {
	req := &publiraadminv1.ListAnnouncementsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	return req
}

func TestCreateAnnouncementRefusesATenantAuditor(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, auth.RoleTenantAuditor)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, auth.RoleTenantAuditor)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Translations: []*publiraadminv1.AnnouncementTranslation{
			{Title: "Maintenance Notice", Body: "Maintenance starts today at 25:00."},
		},
	}

	_, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateAnnouncement code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestCreateAnnouncementWritesEveryTranslationAndQueuesOneNotificationEvent(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateAnnouncement)).
		WithArgs(sqlmock.AnyArg(), tenantID, "announcement", sqlmock.AnyArg(), json.RawMessage("{}"), false, sql.NullTime{}, outbox.AnnouncementDeliveryPreferred, nil).
		WillReturnRows(announcementRowColumns().
			AddRow(announcementID, tenantID, "announcement", nil, json.RawMessage("{}"), now, false, sql.NullTime{}, outbox.AnnouncementDeliveryPreferred, nil))
	// The English copy is sent first, and the default locale's still answers
	// the announcement's own title and body.
	expectAnnouncementTranslationInsert(mock, tenantID, announcementID, "en", "Update", "Body", now)
	expectAnnouncementTranslationInsert(mock, tenantID, announcementID, "ja", "Update (ja)", "Body (ja)", now)
	// One event for the announcement, however many languages it is written in:
	// each reader is told once, in their own.
	expectAnnouncementNotificationEvent(mock, tenantID, announcementID)
	mock.ExpectCommit()

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Translations: []*publiraadminv1.AnnouncementTranslation{
			{Locale: "en", Title: " Update ", Body: "Body"},
			{Locale: "ja", Title: "Update (ja)", Body: "Body (ja)"},
		},
	}

	resp, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	if got := resp.Announcement.GetTitle(); got != "Update (ja)" {
		t.Fatalf("title = %q, want the default locale's", got)
	}
	var written []string
	for _, translation := range resp.Announcement.GetTranslations() {
		written = append(written, translation.Locale+":"+translation.Title)
	}
	if !slices.Equal(written, []string{"en:Update", "ja:Update (ja)"}) {
		t.Fatalf("translations = %v, want both in the order sent", written)
	}

	assertExpectations(t, mock)
}

// The delivery a post asks for is what the row stores, what the response
// answers, and what the audit entry of the post records; leaving it out is the
// preferred delivery.
func TestCreateAnnouncementStoresAndRecordsItsDelivery(t *testing.T) {
	for _, tc := range []struct {
		name      string
		requested publiraadminv1.AnnouncementDelivery
		stored    string
		answered  publiraadminv1.AnnouncementDelivery
	}{
		{
			name:      "unspecified",
			requested: publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_UNSPECIFIED,
			stored:    outbox.AnnouncementDeliveryPreferred,
			answered:  publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_PREFERRED,
		},
		{
			name:      "preferred",
			requested: publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_PREFERRED,
			stored:    outbox.AnnouncementDeliveryPreferred,
			answered:  publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_PREFERRED,
		},
		{
			name:      "everyone",
			requested: publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_EVERYONE,
			stored:    outbox.AnnouncementDeliveryEveryone,
			answered:  publiraadminv1.AnnouncementDelivery_ANNOUNCEMENT_DELIVERY_EVERYONE,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			announcementID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateAnnouncement)).
				WithArgs(sqlmock.AnyArg(), tenantID, "announcement", sqlmock.AnyArg(), json.RawMessage("{}"), false, sql.NullTime{}, tc.stored, nil).
				WillReturnRows(announcementRowColumns().
					AddRow(announcementID, tenantID, "announcement", nil, json.RawMessage("{}"), now, false, sql.NullTime{}, tc.stored, nil))
			expectAnnouncementTranslationInsert(mock, tenantID, announcementID, "ja", "Terms of use updated", "Body", now)
			expectAnnouncementNotificationEvent(mock, tenantID, announcementID)
			mock.ExpectCommit()

			mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
				WithArgs(
					sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
					"announcement_created", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
					sql.NullString{String: "delivery=" + tc.stored, Valid: true}, sqlmock.AnyArg(),
				).
				WillReturnResult(sqlmock.NewResult(0, 1))

			client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			resp, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.CreateAnnouncementRequest{
				Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Terms of use updated", Body: "Body"}},
				Delivery:     tc.requested,
			})
			if err != nil {
				t.Fatalf("CreateAnnouncement: %v", err)
			}
			if got := resp.GetAnnouncement().GetDelivery(); got != tc.answered {
				t.Fatalf("delivery = %v, want %v", got, tc.answered)
			}

			assertExpectations(t, mock)
		})
	}
}

func TestCreateAnnouncementRefusesADeliveryItDoesNotKnow(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, uuid.Must(uuid.NewV7()), time.Now().UTC().Truncate(time.Microsecond))

	_, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.CreateAnnouncementRequest{
		Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Translations: []*publiraadminv1.AnnouncementTranslation{{Title: "Update", Body: "Body"}},
		Delivery:     publiraadminv1.AnnouncementDelivery(99),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateAnnouncement error = %v, want invalid_argument", err)
	}

	assertExpectations(t, mock)
}

// What CreateAnnouncement refuses before it writes anything: a locale the
// tenant does not offer, a locale named twice, a translation missing its title
// or body, and copy with nothing in the default locale, which is what a reader
// in any locale nothing was written in is shown.
func TestCreateAnnouncementRefusesTranslationsItCannotServe(t *testing.T) {
	tests := []struct {
		name         string
		translations []*publiraadminv1.AnnouncementTranslation
	}{
		{
			name:         "no translation",
			translations: nil,
		},
		{
			name: "locale the tenant does not offer",
			translations: []*publiraadminv1.AnnouncementTranslation{
				{Locale: "ja", Title: "Update", Body: "Body"},
				{Locale: "fr", Title: "Update (fr)", Body: "Body (fr)"},
			},
		},
		{
			name: "locale named twice",
			translations: []*publiraadminv1.AnnouncementTranslation{
				{Locale: "ja", Title: "Update", Body: "Body"},
				{Locale: "", Title: "Update again", Body: "Body"},
			},
		},
		{
			name: "no default locale",
			translations: []*publiraadminv1.AnnouncementTranslation{
				{Locale: "en", Title: "Update", Body: "Body"},
			},
		},
		{
			name: "blank title",
			translations: []*publiraadminv1.AnnouncementTranslation{
				{Locale: "ja", Title: "Update", Body: "Body"},
				{Locale: "en", Title: "  ", Body: "Body"},
			},
		},
		{
			name: "blank body",
			translations: []*publiraadminv1.AnnouncementTranslation{
				{Locale: "ja", Title: "Update", Body: ""},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			_, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.CreateAnnouncementRequest{
				Tenant:       &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Translations: test.translations,
			})
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateAnnouncement error = %v, want invalid_argument", err)
			}

			assertExpectations(t, mock)
		})
	}
}

// expectAnnouncementTranslationInsert is one locale's copy CreateAnnouncement
// writes beside the announcement, in the same transaction.
func expectAnnouncementTranslationInsert(
	mock sqlmock.Sqlmock,
	tenantID, announcementID uuid.UUID,
	locale, title, body string,
	now time.Time,
) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateAnnouncementTranslation)).
		WithArgs(sqlmock.AnyArg(), announcementID, tenantID, locale, title, body).
		WillReturnRows(announcementTranslationColumns().
			AddRow(uuid.Must(uuid.NewV7()), announcementID, tenantID, locale, title, body, now, now))
}

// expectAnnouncementTranslationsRead is the read of every translation of the
// announcements one console page lists.
func expectAnnouncementTranslationsRead(
	mock sqlmock.Sqlmock,
	tenantID uuid.UUID,
	translations ...dbmodels.AnnouncementTranslation,
) {
	rows := announcementTranslationColumns()
	for _, translation := range translations {
		rows.AddRow(uuid.Must(uuid.NewV7()), translation.AnnouncementID, translation.TenantID, translation.Locale, translation.Title, translation.Body, time.Now(), time.Now())
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementTranslations)).
		WithArgs(tenantID, sqlmock.AnyArg()).
		WillReturnRows(rows)
}

// announcementRowColumns is what CreateAnnouncement returns: the announcements
// row alone, without the translation the list queries join.
func announcementRowColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "tenant_id", "announcement_type", "link_url", "metadata", "created_at", "pinned", "pinned_until", "delivery", "audience"})
}

func announcementTranslationColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "announcement_id", "tenant_id", "locale", "title", "body", "created_at", "updated_at"})
}

// expectAnnouncementNotificationEvent is the outbox row CreateAnnouncement
// writes beside every announcement, in the same transaction: the worker turns
// it into one bell notification per reader the announcement addresses.
func expectAnnouncementNotificationEvent(
	mock sqlmock.Sqlmock,
	tenantID, announcementID uuid.UUID,
) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAnnouncementNotification,
			sqlmock.AnyArg(),
			outbox.AnnouncementIdempotencyKey(announcementID),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAnnouncementNotification,
			json.RawMessage("{}"),
			outbox.AnnouncementIdempotencyKey(announcementID),
			"pending", int32(0), time.Now().UTC(), nil, time.Now().UTC(), time.Now().UTC(), nil,
		))
}

func TestListAnnouncementsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addAnnouncementRow(announcementColumns(), announcementID, tenantID, "Notice", "Body", "/announcements", now))
	expectAnnouncementTranslationsRead(mock, tenantID,
		dbmodels.AnnouncementTranslation{AnnouncementID: announcementID, TenantID: tenantID, Locale: "ja", Title: "Notice", Body: "Body"},
		dbmodels.AnnouncementTranslation{AnnouncementID: announcementID, TenantID: tenantID, Locale: "en", Title: "Notice (en)", Body: "Body (en)"},
	)

	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), newAnnouncementRequest(tenantID))
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Announcements) != 1 {
		t.Fatalf("announcements count = %d, want 1", len(resp.Announcements))
	}
	var locales []string
	for _, translation := range resp.Announcements[0].Translations {
		locales = append(locales, translation.Locale+":"+translation.Title)
	}
	if !slices.Equal(locales, []string{"ja:Notice", "en:Notice (en)"}) {
		t.Fatalf("translations = %v, want both, oldest first", locales)
	}
	if resp.PreviousToken != "" || resp.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.PreviousToken, resp.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListAnnouncementsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(
				addAnnouncementRow(announcementColumns(), ids[0], tenantID, "First", "body", "", now),
				ids[1], tenantID, "Second", "body", "", now.Add(-time.Minute),
			),
			ids[2], tenantID, "Third", "body", "", now.Add(-2*time.Minute),
		))
	expectAnnouncementTranslationsRead(mock, tenantID)

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Announcements) != 2 {
		t.Fatalf("announcements count = %d, want the over-fetched row dropped", len(resp.Announcements))
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	lastID := uuid.Must(uuid.NewV7())
	lastAt := now.Add(-2 * time.Minute)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addAnnouncementRow(announcementColumns(), lastID, tenantID, "Last", "body", "", lastAt))
	expectAnnouncementTranslationsRead(mock, tenantID)

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	prev, err := pagination.Decode(resp.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantPrev := []string{lastAt.Format(time.RFC3339Nano), lastID.String()}
	if prev.Direction != pagination.Backward || !slices.Equal(prev.Keys, wantPrev) {
		t.Fatalf("previous_token = %+v, want backward keys %v", prev, wantPrev)
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	newerAt := now.Add(-time.Minute)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantAsc)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(announcementColumns(), olderID, tenantID, "Older", "body", "", olderAt),
			newerID, tenantID, "Newer", "body", "", newerAt,
		))
	expectAnnouncementTranslationsRead(mock, tenantID)

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	titles := make([]string, 0, len(resp.Announcements))
	for _, item := range resp.Announcements {
		titles = append(titles, item.Title)
	}
	if !slices.Equal(titles, []string{"Newer", "Older"}) {
		t.Fatalf("titles = %v, want backward page restored to descending order", titles)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.PreviousToken)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	// After Page reverses ASC rows into DESC display order, next_token is
	// built from the last row of the display page (older).
	wantNext := []string{olderAt.Format(time.RFC3339Nano), olderID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                string
		direction           pagination.Direction
		wantQuery           string
		wantRecoveryQuery   string
		wantRecoveredTitles []string
	}{
		{
			name:                "forward",
			direction:           pagination.Forward,
			wantQuery:           dbmodels.ListAnnouncementsForTenantDesc,
			wantRecoveryQuery:   dbmodels.ListAnnouncementsForTenantAsc,
			wantRecoveredTitles: []string{"Newer", "Boundary"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           dbmodels.ListAnnouncementsForTenantAsc,
			wantRecoveryQuery:   dbmodels.ListAnnouncementsForTenantDesc,
			wantRecoveredTitles: []string{"Boundary", "Older"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					false,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(announcementColumns())

			req := newAnnouncementRequest(tenantID)
			req.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			recoveryToken := resp.PreviousToken
			otherToken := resp.NextToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.NextToken
				otherToken = resp.PreviousToken
				recoveryDirection = pagination.Forward
			}
			if otherToken != "" {
				t.Fatalf("opposite token = %q, want empty on an empty page", otherToken)
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
			recoveryRows := announcementColumns()
			if test.direction == pagination.Forward {
				recoveryRows = addAnnouncementRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Newer", "body", "", now.Add(time.Minute))
			} else {
				recoveryRows = addAnnouncementRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Older", "body", "", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					true,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(recoveryRows)
			expectAnnouncementTranslationsRead(mock, tenantID)

			recoveryReq := newAnnouncementRequest(tenantID)
			recoveryReq.Token = recoveryToken
			recovered, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), recoveryReq)
			if err != nil {
				t.Fatalf("ListAnnouncements recovery: %v", err)
			}
			titles := make([]string, 0, len(recovered.Announcements))
			for _, item := range recovered.Announcements {
				titles = append(titles, item.Title)
			}
			if !slices.Equal(titles, test.wantRecoveredTitles) {
				t.Fatalf("recovered titles = %v, want %v", titles, test.wantRecoveredTitles)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListAnnouncementsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: dbmodels.ListAnnouncementsForTenantAsc,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: dbmodels.ListAnnouncementsForTenantDesc,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					true,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(announcementColumns())

			req := newAnnouncementRequest(tenantID)
			req.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			if len(resp.Announcements) != 0 {
				t.Fatalf("announcements = %d rows, want an empty page", len(resp.Announcements))
			}
			if resp.PreviousToken != "" || resp.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.PreviousToken, resp.NextToken,
				)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListAnnouncementsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	req := newAnnouncementRequest(tenantID)
	req.Token = "not-a-valid-token"

	_, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "announcements" does not exist`))

	_, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), newAnnouncementRequest(tenantID))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}
