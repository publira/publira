package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

const (
	listMyEpisodeReadsAscQuery  = "-- name: ListMyEpisodeReadsAsc :many\n"
	listMyEpisodeReadsDescQuery = "-- name: ListMyEpisodeReadsDesc :many\n"
)

func episodeReadRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "read_at", "episode_public_id", "episode_title", "episode_order_index", "series_public_id", "series_title",
	})
}

func addEpisodeReadRow(rows *sqlmock.Rows, id uuid.UUID, readAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, readAt, "EPISODE"+id.String(), "Episode title", int32(3), "SERIES001", "Series title")
}

func assertEpisodeReadEpisodeIDs(t *testing.T, reads []*publirav1.MyEpisodeRead, want []uuid.UUID) {
	t.Helper()
	got := make([]string, 0, len(reads))
	for _, read := range reads {
		got = append(got, read.Episode.GetPublicId())
	}
	wantStrings := make([]string, 0, len(want))
	for _, id := range want {
		wantStrings = append(wantStrings, "EPISODE"+id.String())
	}
	if !slices.Equal(got, wantStrings) {
		t.Fatalf("episode public IDs = %v, want %v", got, wantStrings)
	}
}

func assertEpisodeReadToken(t *testing.T, raw string, wantDirection pagination.Direction, wantTime time.Time, wantID uuid.UUID) {
	t.Helper()
	cursor, err := pagination.Decode(raw)
	if err != nil {
		t.Fatalf("Decode(%q): %v", raw, err)
	}
	keys, err := pagination.DecodeTimeUUID(cursor)
	if err != nil {
		t.Fatalf("DecodeTimeUUID(%q): %v", raw, err)
	}
	if cursor.Direction != wantDirection || !keys.Time.Equal(wantTime) || keys.ID != wantID || keys.Inclusive {
		t.Fatalf("token = %+v %+v, want direction=%q time=%s id=%s inclusive=false", cursor, keys, wantDirection, wantTime, wantID)
	}
}

func TestEpisodeReadListReturnsTheReadersOwnHistory(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	readID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listMyEpisodeReadsDescQuery)).
		WithArgs(tenantID, userID, sql.NullTime{}, false, uuid.NullUUID{}, int32(21)).
		WillReturnRows(addEpisodeReadRow(episodeReadRows(), readID, now))

	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyEpisodeReads(context.Background(), newAuthedPublicRequest(&publirav1.ListMyEpisodeReadsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	if len(response.Msg.Reads) != 1 {
		t.Fatalf("read count = %d, want 1", len(response.Msg.Reads))
	}
	read := response.Msg.Reads[0]
	if read.Episode.GetPublicId() != "EPISODE"+readID.String() || read.Episode.GetOrderIndex() != 3 {
		t.Fatalf("episode = %+v, want the finished episode and its number", read.Episode)
	}
	if read.Series.GetPublicId() != "SERIES001" || read.Series.GetTitle() != "Series title" {
		t.Fatalf("series = %+v, want the episode's own series", read.Series)
	}
	if got, want := read.ReadAt, now.Format(time.RFC3339Nano); got != want {
		t.Fatalf("read_at = %q, want %q", got, want)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, mock)
}

func TestEpisodeReadListForwardPageReturnsNeighborTokens(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	cursorID := uuid.Must(uuid.NewV7())
	firstID := uuid.Must(uuid.NewV7())
	secondID := uuid.Must(uuid.NewV7())
	extraID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	cursorAt := now.Add(-time.Minute)
	firstAt := cursorAt.Add(-time.Minute)
	secondAt := firstAt.Add(-time.Minute)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	mock.ExpectQuery(regexp.QuoteMeta(listMyEpisodeReadsDescQuery)).
		WithArgs(
			tenantID,
			userID,
			sql.NullTime{Time: cursorAt, Valid: true},
			false,
			uuid.NullUUID{UUID: cursorID, Valid: true},
			int32(3),
		).
		WillReturnRows(addEpisodeReadRow(addEpisodeReadRow(addEpisodeReadRow(episodeReadRows(), firstID, firstAt), secondID, secondAt), extraID, secondAt.Add(-time.Minute)))

	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyEpisodeReads(context.Background(), newAuthedPublicRequest(&publirav1.ListMyEpisodeReadsRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  pagination.EncodeTimeUUID(pagination.Forward, cursorAt, cursorID),
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	assertEpisodeReadEpisodeIDs(t, response.Msg.Reads, []uuid.UUID{firstID, secondID})
	assertEpisodeReadToken(t, response.Msg.PreviousToken, pagination.Backward, firstAt, firstID)
	assertEpisodeReadToken(t, response.Msg.NextToken, pagination.Forward, secondAt, secondID)
	assertPublicExpectations(t, mock)
}

func TestEpisodeReadListBackwardPageReturnsDisplayOrderAndNeighborTokens(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	cursorID := uuid.Must(uuid.NewV7())
	oldestID := uuid.Must(uuid.NewV7())
	middleID := uuid.Must(uuid.NewV7())
	newestID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	cursorAt := now.Add(-4 * time.Minute)
	oldestAt := cursorAt.Add(time.Minute)
	middleAt := oldestAt.Add(time.Minute)

	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	mock.ExpectQuery(regexp.QuoteMeta(listMyEpisodeReadsAscQuery)).
		WithArgs(
			tenantID,
			userID,
			sql.NullTime{Time: cursorAt, Valid: true},
			false,
			uuid.NullUUID{UUID: cursorID, Valid: true},
			int32(3),
		).
		WillReturnRows(addEpisodeReadRow(addEpisodeReadRow(addEpisodeReadRow(episodeReadRows(), oldestID, oldestAt), middleID, middleAt), newestID, middleAt.Add(time.Minute)))

	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyEpisodeReads(context.Background(), newAuthedPublicRequest(&publirav1.ListMyEpisodeReadsRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  pagination.EncodeTimeUUID(pagination.Backward, cursorAt, cursorID),
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	assertEpisodeReadEpisodeIDs(t, response.Msg.Reads, []uuid.UUID{middleID, oldestID})
	assertEpisodeReadToken(t, response.Msg.PreviousToken, pagination.Backward, middleAt, middleID)
	assertEpisodeReadToken(t, response.Msg.NextToken, pagination.Forward, oldestAt, oldestID)
	assertPublicExpectations(t, mock)
}

func TestEpisodeReadListEmptyPagesReturnRecoveryTokens(t *testing.T) {
	tests := []struct {
		name              string
		direction         pagination.Direction
		inclusive         bool
		query             string
		wantPreviousToken string
		wantNextToken     string
	}{
		{
			name:              "forward page",
			direction:         pagination.Forward,
			query:             listMyEpisodeReadsDescQuery,
			wantPreviousToken: "recovery backward",
		},
		{
			name:          "backward page",
			direction:     pagination.Backward,
			query:         listMyEpisodeReadsAscQuery,
			wantNextToken: "recovery forward",
		},
		{
			name:      "inclusive recovery page",
			direction: pagination.Forward,
			inclusive: true,
			query:     listMyEpisodeReadsDescQuery,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			cursorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			cursorAt := now.Add(-time.Minute)

			testServer, mock := newTestPublicServer(t)
			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectAuthSession(mock, tenantID, userID, now)
			mock.ExpectQuery(regexp.QuoteMeta(tt.query)).
				WithArgs(
					tenantID,
					userID,
					sql.NullTime{Time: cursorAt, Valid: true},
					tt.inclusive,
					uuid.NullUUID{UUID: cursorID, Valid: true},
					int32(3),
				).
				WillReturnRows(episodeReadRows())

			token := pagination.EncodeTimeUUID(tt.direction, cursorAt, cursorID)
			if tt.inclusive {
				token = pagination.EncodeTimeUUIDRecovery(tt.direction, cursorAt, cursorID)
			}
			client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
			response, err := client.ListMyEpisodeReads(context.Background(), newAuthedPublicRequest(&publirav1.ListMyEpisodeReadsRequest{
				Limit:  2,
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  token,
			}, tenantID.String()))
			if err != nil {
				t.Fatalf("ListMyEpisodeReads: %v", err)
			}

			wantPreviousToken := tt.wantPreviousToken
			if wantPreviousToken == "recovery backward" {
				wantPreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, cursorAt, cursorID)
			}
			wantNextToken := tt.wantNextToken
			if wantNextToken == "recovery forward" {
				wantNextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, cursorAt, cursorID)
			}
			if response.Msg.PreviousToken != wantPreviousToken || response.Msg.NextToken != wantNextToken {
				t.Fatalf("tokens = (%q, %q), want (%q, %q)", response.Msg.PreviousToken, response.Msg.NextToken, wantPreviousToken, wantNextToken)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestEpisodeReadListRejectsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)

	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListMyEpisodeReads(context.Background(), newAuthedPublicRequest(&publirav1.ListMyEpisodeReadsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListMyEpisodeReads code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertPublicExpectations(t, mock)
}

func TestEpisodeReadListRequiresSignIn(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewEpisodeReadServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListMyEpisodeReads(context.Background(), connect.NewRequest(&publirav1.ListMyEpisodeReadsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListMyEpisodeReads code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertPublicExpectations(t, mock)
}
