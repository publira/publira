package publicapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
)

const listMyPurchasesDescQuery = "-- name: ListMyPurchasesDesc :many\n"

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
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "price_at_purchase", "expires_at", "purchased_at", "episode_public_id", "episode_title", "episode_order_index", "series_public_id", "series_title",
		}).AddRow(
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
