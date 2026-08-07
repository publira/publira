package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

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

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetActiveAccessTicketForUserEpisode :one\n")).
		WithArgs(tenantID, memberID, episodeID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateAccessTicket :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), episodeID, memberID, sql.NullTime{}, sql.NullString{}, uuid.NullUUID{UUID: actorID, Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "episode_id", "user_id", "expires_at", "revoked_at", "note", "created_by_user_id", "created_at"}).
			AddRow(ticketID, tenantID, "TICKET000001", episodeID, memberID, nil, nil, nil, actorID, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
			"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
			"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
		}).AddRow(
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

func TestIssueAccessTicketReturnsExistingActive(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

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

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetActiveAccessTicketForUserEpisode :one\n")).
		WithArgs(tenantID, memberID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "episode_id", "user_id", "expires_at", "revoked_at", "note", "created_by_user_id", "created_at"}).
			AddRow(ticketID, tenantID, "TICKETEXIST01", episodeID, memberID, nil, nil, nil, actorID, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKETEXIST01").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
			"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
			"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
		}).AddRow(
			ticketID, tenantID, "TICKETEXIST01", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, nil, nil, actorID, now,
		))

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
	if resp.Msg.Ticket.PublicId != "TICKETEXIST01" {
		t.Fatalf("public_id = %q, want TICKETEXIST01", resp.Msg.Ticket.PublicId)
	}

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
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetAccessTicketByPublicIDForTenant :one\n")).
		WithArgs(tenantID, "TICKET000001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
			"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
			"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
		}).AddRow(
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
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
			"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
			"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
		}).AddRow(
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

func TestListAccessTicketsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	memberID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	ticketID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: ListAccessTicketsForTenant :many\n")).
		WithArgs(tenantID, int32(20), int32(0), uuid.NullUUID{}, uuid.NullUUID{}, false).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "public_id", "episode_id", "episode_public_id", "episode_title",
			"series_public_id", "series_title", "user_id", "user_public_id", "user_name", "user_email",
			"expires_at", "revoked_at", "note", "created_by_user_id", "created_at",
		}).AddRow(
			ticketID, tenantID, "TICKET000001", episodeID, "EPISODE001", "Episode 1",
			"SERIES001", "Series 1", memberID, "MEMBER001", "Sample Member", "member@example.com",
			nil, nil, "reviewer grant", actorID, now,
		))

	client := publiraadminv1connect.NewAdminAccessTicketServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListAccessTicketsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ListAccessTickets(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAccessTickets: %v", err)
	}
	if len(resp.Msg.Tickets) != 1 {
		t.Fatalf("tickets count = %d, want 1", len(resp.Msg.Tickets))
	}
	if resp.Msg.Tickets[0].Note != "reviewer grant" {
		t.Fatalf("note = %q, want reviewer grant", resp.Msg.Tickets[0].Note)
	}

	assertExpectations(t, mock)
}
