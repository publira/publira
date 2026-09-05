package adminapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func ticketDetailColumns() []string {
	return []string{
		"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
		"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
		"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
	}
}

func TestIssueAccessTicketRequiresTenantAdmin(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.IssueAccessTicketRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		UserPublicId:    "MEMBER001",
		EpisodePublicId: "EPISODE001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.IssueAccessTicket(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("IssueAccessTicket code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestIssueAccessTicketSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "MEMBER001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(memberID, "MEMBER001", "Sample Member", "member@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode 1", int32(1), int32(500), nil, "published", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetNonRevokedAccessTicketForUserEpisode :one\n")).
		WithArgs(tenantID, memberID, episodeID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateAccessTicket :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), episodeID, memberID, sql.NullTime{}, sql.NullString{}, uuid.NullUUID{UUID: actorID, Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "episode_id", "user_id", "expires_at", "revoked_at", "note", "created_by_user_id", "created_at"}).
			AddRow(ticketID, tenantID, "TICKET000001", episodeID, memberID, nil, nil, nil, actorID, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()).AddRow(
			ticketID, tenantID, "TICKET000001", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, nil, nil, actorID, now,
		))

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.IssueAccessTicketRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		UserPublicId:    "MEMBER001",
		EpisodePublicId: "EPISODE001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.IssueAccessTicket(context.Background(), req)
	if err != nil {
		t.Fatalf("IssueAccessTicket: %v", err)
	}
	if resp.Msg.Ticket == nil {
		t.Fatal("ticket is nil")
	}
	if resp.Msg.Ticket.PublicId != "TICKET000001" {
		t.Fatalf("public_id = %q, want TICKET000001", resp.Msg.Ticket.PublicId)
	}
	if resp.Msg.Ticket.Status != "active" {
		t.Fatalf("status = %q, want active", resp.Msg.Ticket.Status)
	}
	if resp.Msg.Ticket.UserPublicId != "MEMBER001" {
		t.Fatalf("user_public_id = %q, want MEMBER001", resp.Msg.Ticket.UserPublicId)
	}

	assertExpectations(t, mock)
}

func TestIssueAccessTicketReturnsExistingNonRevoked(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "MEMBER001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(memberID, "MEMBER001", "Sample Member", "member@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
			AddRow(episodeID, "EPISODE001", "Episode 1", int32(1), int32(500), nil, "published", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetNonRevokedAccessTicketForUserEpisode :one\n")).
		WithArgs(tenantID, memberID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "episode_id", "user_id", "expires_at", "revoked_at", "note", "created_by_user_id", "created_at"}).
			AddRow(ticketID, tenantID, "TICKETEXIST01", episodeID, memberID, nil, nil, nil, actorID, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKETEXIST01").
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()).AddRow(
			ticketID, tenantID, "TICKETEXIST01", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, nil, nil, actorID, now,
		))

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.IssueAccessTicketRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		UserPublicId:    "MEMBER001",
		EpisodePublicId: "EPISODE001",
		// Requested expiry is ignored when a non-revoked ticket already exists.
		ExpiresAt: time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.IssueAccessTicket(context.Background(), req)
	if err != nil {
		t.Fatalf("IssueAccessTicket: %v", err)
	}
	if resp.Msg.Ticket.PublicId != "TICKETEXIST01" {
		t.Fatalf("public_id = %q, want TICKETEXIST01", resp.Msg.Ticket.PublicId)
	}
	if resp.Msg.Ticket.ExpiresAt != "" {
		t.Fatalf("expires_at = %q, want empty (existing ticket unchanged)", resp.Msg.Ticket.ExpiresAt)
	}

	assertExpectations(t, mock)
}

func TestIssueAccessTicketRejectsInvalidExpiresAt(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)

	t.Run("malformed", func(t *testing.T) {
		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

		mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
			WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "MEMBER001").
			WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
				AddRow(memberID, "MEMBER001", "Sample Member", "member@example.com", "active", tenantID, now))

		mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
			WithArgs(tenantID, "EPISODE001").
			WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
				AddRow(episodeID, "EPISODE001", "Episode 1", int32(1), int32(500), nil, "published", nil, now))

		req := connect.NewRequest(&publiraadminv1.IssueAccessTicketRequest{
			Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			UserPublicId:    "MEMBER001",
			EpisodePublicId: "EPISODE001",
			ExpiresAt:       "not-a-timestamp",
		})
		req.Header().Set("Authorization", "Bearer "+sessionToken)

		_, err := client.IssueAccessTicket(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	t.Run("past", func(t *testing.T) {
		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

		mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
			WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "MEMBER001").
			WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
				AddRow(memberID, "MEMBER001", "Sample Member", "member@example.com", "active", tenantID, now))

		mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
			WithArgs(tenantID, "EPISODE001").
			WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "title", "order_index", "price", "reading_period_hours", "status", "scheduled_at", "published_at"}).
				AddRow(episodeID, "EPISODE001", "Episode 1", int32(1), int32(500), nil, "published", nil, now))

		req := connect.NewRequest(&publiraadminv1.IssueAccessTicketRequest{
			Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			UserPublicId:    "MEMBER001",
			EpisodePublicId: "EPISODE001",
			ExpiresAt:       time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
		})
		req.Header().Set("Authorization", "Bearer "+sessionToken)

		_, err := client.IssueAccessTicket(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
		}
	})

	assertExpectations(t, mock)
}

func TestRevokeAccessTicketSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	revokedAt := now.Add(time.Minute)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()).AddRow(
			ticketID, tenantID, "TICKET000001", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, nil, nil, actorID, now,
		))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: RevokeAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "episode_id", "user_id", "expires_at", "revoked_at", "note", "created_by_user_id", "created_at"}).
			AddRow(ticketID, tenantID, "TICKET000001", episodeID, memberID, nil, revokedAt, nil, actorID, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()).AddRow(
			ticketID, tenantID, "TICKET000001", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, revokedAt, nil, actorID, now,
		))

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.RevokeAccessTicketRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "TICKET000001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.RevokeAccessTicket(context.Background(), req)
	if err != nil {
		t.Fatalf("RevokeAccessTicket: %v", err)
	}
	if resp.Msg.Ticket.Status != "revoked" {
		t.Fatalf("status = %q, want revoked", resp.Msg.Ticket.Status)
	}
	if resp.Msg.Ticket.RevokedAt == "" {
		t.Fatal("revoked_at is empty")
	}

	assertExpectations(t, mock)
}

func TestRevokeAccessTicketAlreadyRevoked(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	revokedAt := now.Add(-time.Minute)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()).AddRow(
			ticketID, tenantID, "TICKET000001", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, revokedAt, nil, actorID, now,
		))

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.RevokeAccessTicketRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "TICKET000001",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.RevokeAccessTicket(context.Background(), req)
	if err != nil {
		t.Fatalf("RevokeAccessTicket: %v", err)
	}
	if resp.Msg.Ticket.Status != "revoked" {
		t.Fatalf("status = %q, want revoked", resp.Msg.Ticket.Status)
	}

	// No update and no audit insert should have been expected beyond the get above.
	assertExpectations(t, mock)
}

func newAccessTicketClient(
	t *testing.T,
	tenantID, actorID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminAccessTicketServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newListAccessTicketsRequest(
	tenantID uuid.UUID,
	sessionToken string,
) *connect.Request[publiraadminv1.ListAccessTicketsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListAccessTicketsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func addTicketRow(
	rows *sqlmock.Rows,
	id uuid.UUID,
	publicID, note string,
	createdAt time.Time,
) *sqlmock.Rows {
	var noteValue driver.Value
	if note != "" {
		noteValue = note
	}
	return rows.AddRow(
		id, uuid.Must(uuid.NewV7()), publicID, uuid.Must(uuid.NewV7()), "EPISODE001", "Episode 1",
		"SERIES001", "Series 1", uuid.Must(uuid.NewV7()), "MEMBER001", "Sample Member", "member@example.com",
		nil, nil, noteValue, uuid.Must(uuid.NewV7()), createdAt,
	)
}

func ticketPublicIDs(tickets []*publiraadminv1.AdminAccessTicket) []string {
	publicIDs := make([]string, 0, len(tickets))
	for _, ticket := range tickets {
		publicIDs = append(publicIDs, ticket.PublicId)
	}
	return publicIDs
}

func TestListAccessTicketsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addTicketRow(
			sqlmock.NewRows(ticketDetailColumns()),
			ticketID, "TICKET000001", "reviewer grant", now,
		))

	resp, err := client.ListAccessTickets(context.Background(), newListAccessTicketsRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 1 {
		t.Fatalf("tickets count = %d, want 1", len(resp.Msg.Tickets))
	}
	if resp.Msg.Tickets[0].Note != "reviewer grant" {
		t.Fatalf("note = %q, want reviewer grant", resp.Msg.Tickets[0].Note)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsFallsBackForOversizedLimit(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	// An out-of-range limit falls back to the default (20), plus the one
	// over-fetched row that reports whether another page follows.
	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(sqlmock.NewRows(ticketDetailColumns()))

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.Limit = 500
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 0 {
		t.Fatalf("tickets count = %d, want 0", len(resp.Msg.Tickets))
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsUserFilterMissingUser(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDForTenantQuery)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "MISSING").
		WillReturnError(sql.ErrNoRows)

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.UserPublicId = "MISSING"
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 0 {
		t.Fatalf("tickets count = %d, want 0", len(resp.Msg.Tickets))
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsEpisodeFilterMissingEpisode(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeByPublicIDForTenantQuery)).
		WithArgs(tenantID, "MISSING_EP").
		WillReturnError(sql.ErrNoRows)

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.EpisodePublicId = "MISSING_EP"
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 0 {
		t.Fatalf("tickets count = %d, want 0", len(resp.Msg.Tickets))
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsActiveOnly(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, true, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addTicketRow(
			sqlmock.NewRows(ticketDetailColumns()),
			ticketID, "TICKETACTIVE1", "", now,
		))

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.ActiveOnly = true
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 1 {
		t.Fatalf("tickets count = %d, want 1", len(resp.Msg.Tickets))
	}
	if resp.Msg.Tickets[0].Status != "active" {
		t.Fatalf("status = %q, want active", resp.Msg.Tickets[0].Status)
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addTicketRow(
			addTicketRow(
				addTicketRow(sqlmock.NewRows(ticketDetailColumns()), ids[0], "TICKET000001", "", now),
				ids[1], "TICKET000002", "", now.Add(-time.Minute),
			),
			ids[2], "TICKET000003", "", now.Add(-2*time.Minute),
		))

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 2 {
		t.Fatalf("tickets count = %d, want the over-fetched row dropped", len(resp.Msg.Tickets))
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

	assertExpectations(t, mock)
}

// The last page is reachable by following next_token, without an offset.
func TestListAccessTicketsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTicketRow(
			sqlmock.NewRows(ticketDetailColumns()),
			uuid.Must(uuid.NewV7()), "TICKET000003", "", now.Add(-2*time.Minute),
		))

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if !slices.Equal(ticketPublicIDs(resp.Msg.Tickets), []string{"TICKET000003"}) {
		t.Fatalf("public_ids = %v, want the page after the boundary row", ticketPublicIDs(resp.Msg.Tickets))
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantAscQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTicketRow(
			addTicketRow(
				sqlmock.NewRows(ticketDetailColumns()),
				uuid.Must(uuid.NewV7()), "TICKET000002", "", now.Add(-2*time.Minute),
			),
			uuid.Must(uuid.NewV7()), "TICKET000001", "", now.Add(-time.Minute),
		))

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if !slices.Equal(ticketPublicIDs(resp.Msg.Tickets), []string{"TICKET000001", "TICKET000002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to descending order", ticketPublicIDs(resp.Msg.Tickets))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                 string
		direction            pagination.Direction
		wantQuery            string
		wantRecoveryQuery    string
		wantRecoveredTickets []string
	}{
		{
			name:                 "forward",
			direction:            pagination.Forward,
			wantQuery:            listAccessTicketsForTenantDescQuery,
			wantRecoveryQuery:    listAccessTicketsForTenantAscQuery,
			wantRecoveredTickets: []string{"TICKET000001", "TICKET000002"},
		},
		{
			name:                 "backward",
			direction:            pagination.Backward,
			wantQuery:            listAccessTicketsForTenantAscQuery,
			wantRecoveryQuery:    listAccessTicketsForTenantDescQuery,
			wantRecoveredTickets: []string{"TICKET000002", "TICKET000003"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, boundaryID, false, now, int32(21)).
				WillReturnRows(sqlmock.NewRows(ticketDetailColumns()))

			req := newListAccessTicketsRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAccessTickets(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAccessTickets: %v", err)
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
			expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
			recoveryRows := addTicketRow(sqlmock.NewRows(ticketDetailColumns()), boundaryID, "TICKET000002", "", now)
			if test.direction == pagination.Forward {
				recoveryRows = addTicketRow(recoveryRows, uuid.Must(uuid.NewV7()), "TICKET000001", "", now.Add(time.Minute))
			} else {
				recoveryRows = addTicketRow(recoveryRows, uuid.Must(uuid.NewV7()), "TICKET000003", "", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newListAccessTicketsRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListAccessTickets(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListAccessTickets recovery: %v", err)
			}
			if !slices.Equal(ticketPublicIDs(recovered.Msg.Tickets), test.wantRecoveredTickets) {
				t.Fatalf(
					"recovered public_ids = %v, want %v",
					ticketPublicIDs(recovered.Msg.Tickets), test.wantRecoveredTickets,
				)
			}

			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListAccessTicketsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listAccessTicketsForTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listAccessTicketsForTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, boundaryID, true, now, int32(21)).
				WillReturnRows(sqlmock.NewRows(ticketDetailColumns()))

			req := newListAccessTicketsRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAccessTickets(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAccessTickets: %v", err)
			}
			if len(resp.Msg.Tickets) != 0 {
				t.Fatalf("tickets = %d rows, want an empty page", len(resp.Msg.Tickets))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}

			assertExpectations(t, mock)
		})
	}
}

func TestListAccessTicketsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	req := newListAccessTicketsRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"
	_, err := client.ListAccessTickets(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListAccessTickets code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("ListAccessTickets error = %v, want invalid_argument token is invalid", err)
	}

	assertExpectations(t, mock)
}

func TestListAccessTicketsDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAccessTicketClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAccessTicketsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, uuid.NullUUID{}, false, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "access_tickets" does not exist`))

	_, err := client.ListAccessTickets(context.Background(), newListAccessTicketsRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListAccessTickets code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}
