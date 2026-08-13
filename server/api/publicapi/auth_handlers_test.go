package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	getUserByIDQuery                  = "-- name: GetUserByID :one\n"
	listTenantUserRolesQuery          = "-- name: ListTenantUserRoles :many\nSELECT role\nFROM tenant_user_roles\nWHERE user_id = $1\nORDER BY role\n"
	listAnnouncementsForUserDescQuery = "-- name: ListAnnouncementsForUserDesc :many\n"
	listAnnouncementsForUserAscQuery  = "-- name: ListAnnouncementsForUserAsc :many\n"
	markAnnouncementAsReadQuery       = "-- name: MarkAnnouncementAsRead :one\nINSERT INTO announcement_reads (announcement_id, user_id, read_at)\nSELECT n.id, $3, NOW()\nFROM announcements n\nWHERE n.id = $1\n    AND n.tenant_id = $2\n    AND (n.target_user_id IS NULL OR n.target_user_id = $3)\nON CONFLICT (announcement_id, user_id) DO UPDATE\nSET read_at = EXCLUDED.read_at\nRETURNING announcement_id, user_id, read_at\n"
	markAllAnnouncementsAsReadQuery   = "-- name: MarkAllAnnouncementsAsRead :execrows\nINSERT INTO announcement_reads (announcement_id, user_id, read_at)\nSELECT n.id, $2, NOW()\nFROM announcements n\nWHERE n.tenant_id = $1\n    AND (n.target_user_id IS NULL OR n.target_user_id = $2)\n    AND NOT EXISTS (\n        SELECT 1\n        FROM announcement_reads nr\n        WHERE nr.announcement_id = n.id\n            AND nr.user_id = $2\n    )\n"
)

const testPublicUserPublicID = "USR001"

func issueTestPublicToken(tenantID string) string {
	token, _, err := auth.MustTokenManagerFromEnv().Issue(
		testPublicUserPublicID,
		auth.AudiencePublic,
		tenantID,
		"tenant_member",
		1,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func expectAuthSession(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, testPublicUserPublicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(userID, testPublicUserPublicID, "Member User", "member@example.com", "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}).
			AddRow(userID, testPublicUserPublicID, "member@example.com", "", "Member User", now, "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_member"))
}

func newAuthedPublicRequest[T any](msg *T, tenantID string) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+issueTestPublicToken(tenantID))
	return req
}

func announcementColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "target_user_id", "announcement_type", "title", "body", "link_url", "metadata", "created_at", "is_read", "read_at",
	})
}

func addAnnouncementRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	title string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		uuid.NullUUID{},
		"member_episode_published",
		title,
		"最新話が公開されました",
		"/series/S001/episodes/E001",
		json.RawMessage("{}"),
		createdAt,
		true,
		createdAt,
	)
}

func newAnnouncementClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publirav1connect.AuthServiceClient, sqlmock.Sqlmock) {
	t.Helper()
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	return publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL), mock
}

func newListAnnouncementsRequest(tenantID uuid.UUID) *connect.Request[publirav1.ListAnnouncementsRequest] {
	return newAuthedPublicRequest(&publirav1.ListAnnouncementsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String())
}

func announcementTitles(items []*publirav1.AnnouncementItem) []string {
	titles := make([]string, 0, len(items))
	for _, item := range items {
		titles = append(titles, item.Title)
	}
	return titles
}

func TestAuthListAnnouncementsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newAnnouncementClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForUserDescQuery)).
		WithArgs(userID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addAnnouncementRow(announcementColumns(), announcementID, tenantID, "新着エピソード", now))

	req := newListAnnouncementsRequest(tenantID)
	req.Msg.Limit = -1
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}

	if len(resp.Msg.Announcements) != 1 {
		t.Fatalf("announcements count = %d, want 1", len(resp.Msg.Announcements))
	}
	if resp.Msg.Announcements[0].LinkUrl != "/series/S001/episodes/E001" {
		t.Fatalf("link_url = %q, want /series/S001/episodes/E001", resp.Msg.Announcements[0].LinkUrl)
	}
	if !resp.Msg.Announcements[0].IsRead {
		t.Fatalf("is_read = false, want true")
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}

	assertPublicExpectations(t, mock)
}

func TestAuthListAnnouncementsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newAnnouncementClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForUserDescQuery)).
		WithArgs(userID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(
				addAnnouncementRow(announcementColumns(), ids[0], tenantID, "first", now),
				ids[1], tenantID, "second", now.Add(-time.Minute),
			),
			ids[2], tenantID, "third", now.Add(-2*time.Minute),
		))

	req := newListAnnouncementsRequest(tenantID)
	req.Msg.Limit = 2
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if got := announcementTitles(resp.Msg.Announcements); !slices.Equal(got, []string{"first", "second"}) {
		t.Fatalf("titles = %v, want the over-fetched row dropped", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}

	assertPublicExpectations(t, mock)
}

func TestAuthListAnnouncementsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock := newAnnouncementClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForUserDescQuery)).
		WithArgs(userID, tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addAnnouncementRow(announcementColumns(), uuid.Must(uuid.NewV7()), tenantID, "last", now.Add(-2*time.Minute)))

	req := newListAnnouncementsRequest(tenantID)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}

	assertPublicExpectations(t, mock)
}

func TestAuthListAnnouncementsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock := newAnnouncementClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForUserAscQuery)).
		WithArgs(userID, tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(announcementColumns(), uuid.Must(uuid.NewV7()), tenantID, "older", now.Add(-2*time.Minute)),
			uuid.Must(uuid.NewV7()), tenantID, "newer", now.Add(-time.Minute),
		))

	req := newListAnnouncementsRequest(tenantID)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if got := announcementTitles(resp.Msg.Announcements); !slices.Equal(got, []string{"newer", "older"}) {
		t.Fatalf("titles = %v, want backward page restored to descending order", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}

	assertPublicExpectations(t, mock)
}

func TestAuthListAnnouncementsEmptyPageKeepsAWayBack(t *testing.T) {
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
			wantQuery:           listAnnouncementsForUserDescQuery,
			wantRecoveryQuery:   listAnnouncementsForUserAscQuery,
			wantRecoveredTitles: []string{"newer", "boundary"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           listAnnouncementsForUserAscQuery,
			wantRecoveryQuery:   listAnnouncementsForUserDescQuery,
			wantRecoveredTitles: []string{"boundary", "older"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock := newAnnouncementClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(userID, tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(announcementColumns())

			req := newListAnnouncementsRequest(tenantID)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAnnouncements(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectAuthSession(mock, tenantID, userID, now)
			recoveryRows := addAnnouncementRow(announcementColumns(), boundaryID, tenantID, "boundary", now)
			if test.direction == pagination.Forward {
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "newer", now.Add(time.Minute))
			} else {
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "older", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(userID, tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newListAnnouncementsRequest(tenantID)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListAnnouncements(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListAnnouncements recovery: %v", err)
			}
			if got := announcementTitles(recovered.Msg.Announcements); !slices.Equal(got, test.wantRecoveredTitles) {
				t.Fatalf("recovered titles = %v, want %v", got, test.wantRecoveredTitles)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestAuthListAnnouncementsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listAnnouncementsForUserAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listAnnouncementsForUserDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock := newAnnouncementClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(userID, tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(announcementColumns())

			req := newListAnnouncementsRequest(tenantID)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAnnouncements(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			if len(resp.Msg.Announcements) != 0 {
				t.Fatalf("announcements = %v, want an empty page", announcementTitles(resp.Msg.Announcements))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestAuthListAnnouncementsInvalidToken(t *testing.T) {
	boundaryAt := time.Now().UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
	boundaryID := uuid.Must(uuid.NewV7()).String()

	// Every one of these fails before the query runs, so no row is mocked.
	tests := map[string]string{
		"not a token":        "not-a-valid-token",
		"too few keys":       pagination.Encode(pagination.Forward, boundaryAt),
		"too many keys":      pagination.Encode(pagination.Forward, boundaryAt, boundaryID, "inclusive", "extra"),
		"unknown third key":  pagination.Encode(pagination.Forward, boundaryAt, boundaryID, "exclusive"),
		"created_at not iso": pagination.Encode(pagination.Forward, "2026-08-11 00:00:00", boundaryID),
		"id not a uuid":      pagination.Encode(pagination.Forward, boundaryAt, "not-a-uuid"),
	}

	for name, token := range tests {
		t.Run(name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock := newAnnouncementClient(t, tenantID, userID, now)

			req := newListAnnouncementsRequest(tenantID)
			req.Msg.Token = token
			_, err := client.ListAnnouncements(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			if err.Error() != "invalid_argument: token is invalid" {
				t.Fatalf("error = %q, want token internals hidden", err)
			}

			assertPublicExpectations(t, mock)
		})
	}
}

func TestAuthMarkAnnouncementAsRead(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		announcementID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)
		mock.ExpectQuery(regexp.QuoteMeta(markAnnouncementAsReadQuery)).
			WithArgs(announcementID, tenantID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"announcement_id", "user_id", "read_at"}).
				AddRow(announcementID, userID, now))

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		resp, err := client.MarkAnnouncementAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAnnouncementAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			AnnouncementId: announcementID.String(),
		}, tenantID.String()))
		if err != nil {
			t.Fatalf("MarkAnnouncementAsRead: %v", err)
		}
		if !resp.Msg.Marked {
			t.Fatalf("marked = false, want true")
		}

		assertPublicExpectations(t, mock)
	})

	t.Run("invalid-announcement-id", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		_, err := client.MarkAnnouncementAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAnnouncementAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			AnnouncementId: "not-a-uuid",
		}, tenantID.String()))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
		}

		assertPublicExpectations(t, mock)
	})

	t.Run("not-found", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		announcementID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)
		mock.ExpectQuery(regexp.QuoteMeta(markAnnouncementAsReadQuery)).
			WithArgs(announcementID, tenantID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"announcement_id", "user_id", "read_at"}))

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		_, err := client.MarkAnnouncementAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAnnouncementAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			AnnouncementId: announcementID.String(),
		}, tenantID.String()))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
		}

		assertPublicExpectations(t, mock)
	})
}

func TestAuthMarkAllAnnouncementsAsRead(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	mock.ExpectExec(regexp.QuoteMeta(markAllAnnouncementsAsReadQuery)).
		WithArgs(tenantID, userID).
		WillReturnResult(sqlmock.NewResult(0, 3))

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.MarkAllAnnouncementsAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAllAnnouncementsAsReadRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("MarkAllAnnouncementsAsRead: %v", err)
	}
	if resp.Msg.MarkedCount != 3 {
		t.Fatalf("marked_count = %d, want 3", resp.Msg.MarkedCount)
	}

	assertPublicExpectations(t, mock)
}
