package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListPlatformOperatorsPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		number := strconv.Itoa(index + 1)
		operator := pg.SeedPlatformOperator(
			t,
			"PLATPAGE00"+number,
			"platform-page-"+number+"@example.com",
			"Platform Page "+number,
		)
		ids[index] = operator.ID
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE platform_users SET created_at = $1", createdAt); err != nil {
		t.Fatalf("align platform operator created_at: %v", err)
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListPlatformOperatorsDesc(ctx, dbmodels.ListPlatformOperatorsDescParams{Limit: 2})
	if err != nil {
		t.Fatalf("ListPlatformOperatorsDesc first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("first page count = %d, want 2", len(firstPage))
	}

	secondPage, err := queries.ListPlatformOperatorsDesc(ctx, dbmodels.ListPlatformOperatorsDescParams{
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListPlatformOperatorsDesc second page: %v", err)
	}
	if len(secondPage) != 2 {
		t.Fatalf("second page count = %d, want 2", len(secondPage))
	}

	seen := []uuid.UUID{firstPage[0].ID, firstPage[1].ID, secondPage[0].ID, secondPage[1].ID}
	if !slices.Equal(sortedUUIDs(seen), sortedUUIDs(ids)) {
		t.Fatalf("paged IDs = %v, want every row exactly once %v", seen, ids)
	}

	previousPage, err := queries.ListPlatformOperatorsAsc(ctx, dbmodels.ListPlatformOperatorsAscParams{
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListPlatformOperatorsAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{firstPage[1].ID, firstPage[0].ID}
	gotPreviousScan := []uuid.UUID{previousPage[0].ID, previousPage[1].ID}
	if !slices.Equal(gotPreviousScan, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", gotPreviousScan, wantPreviousScan)
	}
}
