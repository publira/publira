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

	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	getEpisodeReadThroughTotalsQuery = "-- name: GetEpisodeReadThroughTotals :one\n"
	listEpisodeReadThroughDescQuery  = "-- name: ListEpisodeReadThroughDesc :many\n"
)

func episodeReadThroughColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"episode_id",
		"complete_count",
		"member_view_count",
		"episode_public_id",
		"episode_title",
		"series_public_id",
		"series_title",
	})
}

func newEngagementClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminEngagementServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminEngagementServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newEpisodeReadThroughRequest(
	tenantID uuid.UUID,
	sessionToken, token string,
) *connect.Request[publiraadminv1.ListEpisodeReadThroughRequest] {
	req := connect.NewRequest(&publiraadminv1.ListEpisodeReadThroughRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestResolveReadThroughPeriodEndsOnTheLastCompleteDay(t *testing.T) {
	now := time.Date(2026, 3, 15, 9, 30, 0, 0, time.UTC)

	period := resolveReadThroughPeriod(now, time.UTC)

	if got, want := period.end.Format(time.DateOnly), "2026-03-14"; got != want {
		t.Fatalf("period end = %s, want %s", got, want)
	}
	if got, want := period.start.Format(time.DateOnly), "2026-02-15"; got != want {
		t.Fatalf("period start = %s, want %s", got, want)
	}
	days := int(period.end.Sub(period.start).Hours()/24) + 1
	if days != readThroughWindowDays {
		t.Fatalf("period spans %d days, want %d", days, readThroughWindowDays)
	}
}

func TestResolveReadThroughPeriodUsesTheTenantsDays(t *testing.T) {
	// One instant, two tenants: 2026-03-15T21:00Z is already the 16th in
	// Tokyo and still the 15th in Los Angeles, so their last complete day is
	// not the same one — and neither is the UTC day the report used to report.
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	losAngeles, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	now := time.Date(2026, 3, 15, 21, 0, 0, 0, time.UTC)

	tests := []struct {
		name     string
		location *time.Location
		want     string
	}{
		{name: "Tokyo has entered the next day", location: tokyo, want: "2026-03-15"},
		{name: "Los Angeles has not", location: losAngeles, want: "2026-03-14"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			period := resolveReadThroughPeriod(now, tt.location)
			if got := period.end.Format(time.DateOnly); got != tt.want {
				t.Fatalf("period end = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestListEpisodeReadThroughReturnsCountsAndTotals(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEngagementClient(t, tenantID, userID, now)

	firstEpisodeID := uuid.Must(uuid.NewV7())
	secondEpisodeID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeReadThroughTotalsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"complete_count", "member_view_count"}).
			AddRow(int64(9), int64(30)))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeReadThroughDescQuery)).
		WithArgs(
			tenantID,
			uuid.NullUUID{},
			false,
			sql.NullInt64{},
			int32(21),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnRows(episodeReadThroughColumns().
			AddRow(firstEpisodeID, int64(7), int64(20), "EPISODE1", "First", "SERIES1", "Series One").
			AddRow(secondEpisodeID, int64(2), int64(10), "EPISODE2", "Second", "SERIES1", "Series One"))

	resp, err := client.ListEpisodeReadThrough(context.Background(), newEpisodeReadThroughRequest(tenantID, sessionToken, ""))
	if err != nil {
		t.Fatalf("ListEpisodeReadThrough: %v", err)
	}
	if len(resp.Msg.Episodes) != 2 {
		t.Fatalf("episodes count = %d, want 2", len(resp.Msg.Episodes))
	}
	if got := resp.Msg.Episodes[0].CompleteCount; got != 7 {
		t.Fatalf("first complete_count = %d, want 7", got)
	}
	if got := resp.Msg.Episodes[0].MemberViewCount; got != 20 {
		t.Fatalf("first member_view_count = %d, want 20", got)
	}
	if got := resp.Msg.TotalCompleteCount; got != 9 {
		t.Fatalf("total_complete_count = %d, want 9", got)
	}
	if got := resp.Msg.TotalMemberViewCount; got != 30 {
		t.Fatalf("total_member_view_count = %d, want 30", got)
	}
	if resp.Msg.PeriodStart == "" || resp.Msg.PeriodEnd == "" {
		t.Fatalf("period = %q..%q, want both dates named", resp.Msg.PeriodStart, resp.Msg.PeriodEnd)
	}
	// The zone the period was counted in comes back with it, so the screen
	// names the same one the server used rather than a zone of its own.
	if got := resp.Msg.TimeZone; got != "Asia/Tokyo" {
		t.Fatalf("time_zone = %q, want the tenant's Asia/Tokyo", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListEpisodeReadThroughPagesOnTheCompletionKeyset(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEngagementClient(t, tenantID, userID, now)

	boundaryID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeReadThroughTotalsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"complete_count", "member_view_count"}).
			AddRow(int64(7), int64(20)))
	// Over-fetching by one is what tells the handler another page exists.
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeReadThroughDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullInt64{}, int32(2), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(episodeReadThroughColumns().
			AddRow(boundaryID, int64(5), int64(12), "EPISODE1", "First", "SERIES1", "Series One").
			AddRow(uuid.Must(uuid.NewV7()), int64(2), int64(8), "EPISODE2", "Second", "SERIES1", "Series One"))

	req := newEpisodeReadThroughRequest(tenantID, sessionToken, "")
	req.Msg.Limit = 1
	resp, err := client.ListEpisodeReadThrough(context.Background(), req)
	if err != nil {
		t.Fatalf("ListEpisodeReadThrough: %v", err)
	}
	if len(resp.Msg.Episodes) != 1 {
		t.Fatalf("episodes count = %d, want 1", len(resp.Msg.Episodes))
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token to the following page")
	}

	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("Decode(next_token): %v", err)
	}
	keys, err := pagination.DecodeCountUUID(cursor)
	if err != nil {
		t.Fatalf("DecodeCountUUID: %v", err)
	}
	if keys.Count != 5 || keys.ID != boundaryID {
		t.Fatalf("next_token keys = (%d, %s), want (5, %s)", keys.Count, keys.ID, boundaryID)
	}
	assertExpectations(t, mock)
}

func TestListEpisodeReadThroughRecoversFromAnEmptyPage(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEngagementClient(t, tenantID, userID, now)

	boundaryID := uuid.Must(uuid.NewV7())
	token := pagination.EncodeCountUUID(pagination.Forward, 5, boundaryID)
	mock.ExpectQuery(regexp.QuoteMeta(getEpisodeReadThroughTotalsQuery)).
		WithArgs(tenantID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"complete_count", "member_view_count"}).
			AddRow(int64(0), int64(0)))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeReadThroughDescQuery)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullInt64{Int64: 5, Valid: true},
			int32(21),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnRows(episodeReadThroughColumns())

	resp, err := client.ListEpisodeReadThrough(context.Background(), newEpisodeReadThroughRequest(tenantID, sessionToken, token))
	if err != nil {
		t.Fatalf("ListEpisodeReadThrough: %v", err)
	}
	if len(resp.Msg.Episodes) != 0 {
		t.Fatalf("episodes count = %d, want 0", len(resp.Msg.Episodes))
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a recovery token back to the page the client came from")
	}
	cursor, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("Decode(previous_token): %v", err)
	}
	keys, err := pagination.DecodeCountUUID(cursor)
	if err != nil {
		t.Fatalf("DecodeCountUUID: %v", err)
	}
	if !keys.Inclusive {
		t.Fatal("recovery token is not inclusive, so it cannot return the boundary row")
	}
	assertExpectations(t, mock)
}

func TestListEpisodeReadThroughRejectsMalformedToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newEngagementClient(t, tenantID, userID, now)

	_, err := client.ListEpisodeReadThrough(
		context.Background(),
		newEpisodeReadThroughRequest(tenantID, sessionToken, "not-a-token"),
	)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}
