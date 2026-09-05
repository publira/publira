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
	listMyPurchasesAscQuery  = "-- name: ListMyPurchasesAsc :many\n"
	listMyPurchasesDescQuery = "-- name: ListMyPurchasesDesc :many\n"
)

func TestPurchaseListReturnsOnlySessionUsersPurchases(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	purchaseID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listMyPurchasesDescQuery)).
		WithArgs(tenantID, userID, sql.NullTime{}, false, uuid.NullUUID{}, int32(21)).
		WillReturnRows(purchaseRows().AddRow(
			purchaseID,
			int32(500),
			now.Add(time.Hour),
			now,
			"EPISODE001",
			"Episode title",
			int32(3),
			"SERIES001",
			"Series title",
		))

	client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyPurchases(context.Background(), newAuthedPublicRequest(&publirav1.ListMyPurchasesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(response.Msg.Purchases) != 1 {
		t.Fatalf("purchase count = %d, want 1", len(response.Msg.Purchases))
	}
	purchase := response.Msg.Purchases[0]
	if !purchase.IsActive {
		t.Fatal("is_active = false, want true")
	}
	if purchase.Episode.GetPublicId() != "EPISODE001" || purchase.Series.GetPublicId() != "SERIES001" {
		t.Fatalf("purchase item = %+v, want episode and series public IDs", purchase)
	}
	if purchase.PriceAtPurchase != 500 {
		t.Fatalf("price_at_purchase = %d, want 500", purchase.PriceAtPurchase)
	}
	assertPublicExpectations(t, mock)
}

func TestPurchaseListForwardPageReturnsNeighborTokens(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta(listMyPurchasesDescQuery)).
		WithArgs(
			tenantID,
			userID,
			sql.NullTime{Time: cursorAt, Valid: true},
			false,
			uuid.NullUUID{UUID: cursorID, Valid: true},
			int32(3),
		).
		WillReturnRows(addPurchaseRow(addPurchaseRow(addPurchaseRow(purchaseRows(), firstID, firstAt), secondID, secondAt), extraID, secondAt.Add(-time.Minute)))

	client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyPurchases(context.Background(), newAuthedPublicRequest(&publirav1.ListMyPurchasesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  pagination.EncodeTimeUUID(pagination.Forward, cursorAt, cursorID),
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	assertPurchaseIDs(t, response.Msg.Purchases, []uuid.UUID{firstID, secondID})
	assertPurchaseToken(t, response.Msg.PreviousToken, pagination.Backward, firstAt, firstID)
	assertPurchaseToken(t, response.Msg.NextToken, pagination.Forward, secondAt, secondID)
	assertPublicExpectations(t, mock)
}

func TestPurchaseListBackwardPageReturnsDisplayOrderAndNeighborTokens(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta(listMyPurchasesAscQuery)).
		WithArgs(
			tenantID,
			userID,
			sql.NullTime{Time: cursorAt, Valid: true},
			false,
			uuid.NullUUID{UUID: cursorID, Valid: true},
			int32(3),
		).
		WillReturnRows(addPurchaseRow(addPurchaseRow(addPurchaseRow(purchaseRows(), oldestID, oldestAt), middleID, middleAt), newestID, middleAt.Add(time.Minute)))

	client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
	response, err := client.ListMyPurchases(context.Background(), newAuthedPublicRequest(&publirav1.ListMyPurchasesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  pagination.EncodeTimeUUID(pagination.Backward, cursorAt, cursorID),
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	assertPurchaseIDs(t, response.Msg.Purchases, []uuid.UUID{middleID, oldestID})
	assertPurchaseToken(t, response.Msg.PreviousToken, pagination.Backward, middleAt, middleID)
	assertPurchaseToken(t, response.Msg.NextToken, pagination.Forward, oldestAt, oldestID)
	assertPublicExpectations(t, mock)
}

func TestPurchaseListEmptyPagesReturnRecoveryTokens(t *testing.T) {
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
			query:             listMyPurchasesDescQuery,
			wantPreviousToken: "recovery backward",
		},
		{
			name:          "backward page",
			direction:     pagination.Backward,
			query:         listMyPurchasesAscQuery,
			wantNextToken: "recovery forward",
		},
		{
			name:      "inclusive recovery page",
			direction: pagination.Forward,
			inclusive: true,
			query:     listMyPurchasesDescQuery,
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
				WillReturnRows(purchaseRows())

			token := pagination.EncodeTimeUUID(tt.direction, cursorAt, cursorID)
			if tt.inclusive {
				token = pagination.EncodeTimeUUIDRecovery(tt.direction, cursorAt, cursorID)
			}
			client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
			response, err := client.ListMyPurchases(context.Background(), newAuthedPublicRequest(&publirav1.ListMyPurchasesRequest{
				Limit:  2,
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:  token,
			}, tenantID.String()))
			if err != nil {
				t.Fatalf("ListMyPurchases: %v", err)
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

func TestPurchaseListRejectsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)

	client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListMyPurchases(context.Background(), newAuthedPublicRequest(&publirav1.ListMyPurchasesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListMyPurchases code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertPublicExpectations(t, mock)
}

func TestPurchaseListRequiresSignIn(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewPurchaseServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListMyPurchases(context.Background(), connect.NewRequest(&publirav1.ListMyPurchasesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListMyPurchases code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	assertPublicExpectations(t, mock)
}

func purchaseRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "price_at_purchase", "expires_at", "purchased_at", "episode_public_id", "episode_title", "episode_order_index", "series_public_id", "series_title",
	})
}

func addPurchaseRow(rows *sqlmock.Rows, id uuid.UUID, purchasedAt time.Time) *sqlmock.Rows {
	return rows.AddRow(
		id,
		int32(500),
		nil,
		purchasedAt,
		"EPISODE"+id.String(),
		"Episode title",
		int32(3),
		"SERIES001",
		"Series title",
	)
}

func assertPurchaseIDs(t *testing.T, purchases []*publirav1.MyPurchase, want []uuid.UUID) {
	t.Helper()
	got := make([]string, 0, len(purchases))
	for _, purchase := range purchases {
		got = append(got, purchase.Id)
	}
	wantStrings := make([]string, 0, len(want))
	for _, id := range want {
		wantStrings = append(wantStrings, id.String())
	}
	if !slices.Equal(got, wantStrings) {
		t.Fatalf("purchase IDs = %v, want %v", got, wantStrings)
	}
}

func assertPurchaseToken(t *testing.T, raw string, wantDirection pagination.Direction, wantTime time.Time, wantID uuid.UUID) {
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
