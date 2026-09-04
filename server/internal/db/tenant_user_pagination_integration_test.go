package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListTenantUsersPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "USERTNT00001", "users.example.com", "admin-users.example.com", "User Tenant")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertTenantMemberAt(
			t, ctx, pg.DB, tenantID,
			fmt.Sprintf("USERPAGE%03d", index),
			fmt.Sprintf("Member %d", index),
			createdAt.Add(-time.Duration(index)*time.Minute),
		)
	}

	queries := dbmodels.New(pg.DB)
	tenant := uuid.NullUUID{UUID: tenantID, Valid: true}
	firstPage, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID: tenant,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc first page: %v", err)
	}
	if got := tenantUserDescIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}
	if firstPage[0].Role != "tenant_editor" {
		t.Fatalf("role = %q, want the member's tenant role", firstPage[0].Role)
	}

	inclusiveNextPage, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID:        tenant,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].UserID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc inclusive page: %v", err)
	}
	if got := tenantUserDescIDs(inclusiveNextPage); !slices.Equal(got, ids[1:3]) {
		t.Fatalf("inclusive next page IDs = %v, want boundary included %v", got, ids[1:3])
	}

	secondPage, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID:        tenant,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].UserID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc second page: %v", err)
	}
	if got := tenantUserDescIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want the last page reached without an offset %v", got, ids[2:])
	}

	previousPage, err := queries.ListTenantUsersAsc(ctx, dbmodels.ListTenantUsersAscParams{
		TenantID:        tenant,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].UserID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{ids[1], ids[0]}
	if got := tenantUserAscIDs(previousPage); !slices.Equal(got, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", got, wantPreviousScan)
	}
}

// The keyword has to be matched by the database. Filtering an already-fetched
// page in Go would hide every match that sits on a later page.
func TestListTenantUsersFiltersByKeywordAcrossPages(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "USERTNT00002", "users2.example.com", "admin-users2.example.com", "User Tenant 2")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	for index := range 3 {
		mustInsertTenantMemberAt(
			t, ctx, pg.DB, tenantID,
			fmt.Sprintf("USERPLAIN%02d", index),
			fmt.Sprintf("Plain %d", index),
			createdAt.Add(-time.Duration(index)*time.Minute),
		)
	}
	// Oldest, so it lands past the first page of an unfiltered scan.
	wantedID := mustInsertTenantMemberAt(
		t, ctx, pg.DB, tenantID, "USERWANTED01", "編集 太郎", createdAt.Add(-time.Hour),
	)

	queries := dbmodels.New(pg.DB)
	tenant := uuid.NullUUID{UUID: tenantID, Valid: true}
	byName, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID: tenant,
		Query:    sql.NullString{String: "編集", Valid: true},
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc by name: %v", err)
	}
	if got := tenantUserDescIDs(byName); !slices.Equal(got, []uuid.UUID{wantedID}) {
		t.Fatalf("keyword page IDs = %v, want only %v", got, wantedID)
	}

	byPublicID, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID: tenant,
		Query:    sql.NullString{String: "wanted", Valid: true},
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc by public_id: %v", err)
	}
	// public_id is stored upper case, so the match has to be case-insensitive.
	if got := tenantUserDescIDs(byPublicID); !slices.Equal(got, []uuid.UUID{wantedID}) {
		t.Fatalf("case-insensitive page IDs = %v, want only %v", got, wantedID)
	}

	unfiltered, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID: tenant,
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc unfiltered: %v", err)
	}
	if len(unfiltered) != 4 {
		t.Fatalf("unfiltered rows = %d, want every member of the tenant", len(unfiltered))
	}
}

// Rows created in the same transaction share created_at, so the id tiebreaker is
// the only thing keeping the page boundary on exactly one row.
func TestListTenantUsersPaginatesRowsSharingCreatedAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "USERTNT00003", "users3.example.com", "admin-users3.example.com", "User Tenant 3")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 3)
	for index := range ids {
		ids[index] = mustInsertTenantMemberAt(
			t, ctx, pg.DB, tenantID,
			fmt.Sprintf("USERTIED%03d", index),
			fmt.Sprintf("Tied %d", index),
			createdAt,
		)
	}

	queries := dbmodels.New(pg.DB)
	tenant := uuid.NullUUID{UUID: tenantID, Valid: true}
	firstPage, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID: tenant,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("first page rows = %d, want 2", len(firstPage))
	}
	secondPage, err := queries.ListTenantUsersDesc(ctx, dbmodels.ListTenantUsersDescParams{
		TenantID:        tenant,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].UserID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantUsersDesc second page: %v", err)
	}

	seen := append(tenantUserDescIDs(firstPage), tenantUserDescIDs(secondPage)...)
	if !slices.Equal(sortedUUIDs(seen), sortedUUIDs(ids)) {
		t.Fatalf("paged IDs = %v, want every row exactly once %v", seen, ids)
	}
}

// A tenant member is a user that holds a tenant role; users without one are not
// part of this list.
func mustInsertTenantMemberAt(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID uuid.UUID,
	publicID, name string,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	userID := mustInsertUser(t, ctx, db, tenantID, publicID, publicID+"@example.com", name)
	if _, err := db.ExecContext(ctx, `
		UPDATE users SET created_at = $2 WHERE id = $1
	`, userID, createdAt); err != nil {
		t.Fatalf("set created_at for %s: %v", publicID, err)
	}
	roleID := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO tenant_user_roles (id, tenant_id, user_id, role)
		VALUES ($1, $2, $3, 'tenant_editor')
	`, roleID, tenantID, userID); err != nil {
		t.Fatalf("insert tenant role for %s: %v", publicID, err)
	}
	return userID
}

func tenantUserDescIDs(rows []dbmodels.ListTenantUsersDescRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	return ids
}

func tenantUserAscIDs(rows []dbmodels.ListTenantUsersAscRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	return ids
}
