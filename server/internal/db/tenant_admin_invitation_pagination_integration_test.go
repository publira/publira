package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListTenantAdminInvitationsPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "INVITETNT001", "invite.example.com", "admin-invite.example.com", "Invitation Tenant")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertTenantAdminInvitation(t, ctx, pg.DB, tenantID, createdAt.Add(-time.Duration(index)*time.Minute))
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID: tenantID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsDesc first page: %v", err)
	}
	if got := tenantAdminInvitationIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}

	inclusiveNextPage, err := queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsDesc inclusive page: %v", err)
	}
	if got := tenantAdminInvitationIDs(inclusiveNextPage); !slices.Equal(got, ids[1:3]) {
		t.Fatalf("inclusive next page IDs = %v, want boundary included %v", got, ids[1:3])
	}

	secondPage, err := queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsDesc second page: %v", err)
	}
	if got := tenantAdminInvitationIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want %v", got, ids[2:])
	}

	previousPage, err := queries.ListTenantAdminInvitationsAsc(ctx, dbmodels.ListTenantAdminInvitationsAscParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{ids[1], ids[0]}
	if got := tenantAdminInvitationIDs(previousPage); !slices.Equal(got, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", got, wantPreviousScan)
	}
}

func TestListTenantAdminInvitationsPaginatesRowsSharingCreatedAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "INVITETNT002", "invite2.example.com", "admin-invite2.example.com", "Invitation Tenant 2")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 3)
	for index := range ids {
		ids[index] = mustInsertTenantAdminInvitation(t, ctx, pg.DB, tenantID, createdAt)
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID: tenantID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsDesc first page: %v", err)
	}
	secondPage, err := queries.ListTenantAdminInvitationsDesc(ctx, dbmodels.ListTenantAdminInvitationsDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListTenantAdminInvitationsDesc second page: %v", err)
	}

	seen := append(tenantAdminInvitationIDs(firstPage), tenantAdminInvitationIDs(secondPage)...)
	if !slices.Equal(sortedUUIDs(seen), sortedUUIDs(ids)) {
		t.Fatalf("paged IDs = %v, want every row exactly once %v", seen, ids)
	}
}

func mustInsertTenantAdminInvitation(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID uuid.UUID,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO tenant_admin_invitations (
			id, tenant_id, email, token_hash, expires_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $6)
	`, id, tenantID, id.String()+"@example.com", "token-"+id.String(), createdAt.Add(time.Hour), createdAt)
	if err != nil {
		t.Fatalf("insert tenant admin invitation: %v", err)
	}
	return id
}

func tenantAdminInvitationIDs(rows []dbmodels.TenantAdminInvitation) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}
