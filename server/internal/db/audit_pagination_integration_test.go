package dbmodels_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListAuditLogsByTenantPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "AUDITTENANT1", "audit.example.com", "admin-audit.example.com", "Audit Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "AUDITUSER001", "audit-user@example.com", "Audit User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertAuditLog(t, ctx, pg.DB, tenantID, userID, createdAt.Add(-time.Duration(index)*time.Minute))
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListAuditLogsByTenantDesc(ctx, dbmodels.ListAuditLogsByTenantDescParams{
		TenantID: tenantID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByTenantDesc first page: %v", err)
	}
	if got := auditLogIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}

	secondPage, err := queries.ListAuditLogsByTenantDesc(ctx, dbmodels.ListAuditLogsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByTenantDesc second page: %v", err)
	}
	if got := auditLogIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want %v", got, ids[2:])
	}

	previousPage, err := queries.ListAuditLogsByTenantAsc(ctx, dbmodels.ListAuditLogsByTenantAscParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByTenantAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{ids[1], ids[0]}
	if got := auditLogIDs(previousPage); !slices.Equal(got, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", got, wantPreviousScan)
	}
}

func mustInsertAuditLog(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, userID uuid.UUID,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO audit_logs (
			id, tenant_id, actor_user_id, actor_role, action, outcome, created_at
		) VALUES ($1, $2, $3, 'editor', 'series_updated', 'success', $4)
	`, id, tenantID, userID, createdAt)
	if err != nil {
		t.Fatalf("insert audit log: %v", err)
	}
	return id
}

type auditLogRow interface {
	dbmodels.ListAuditLogsByTenantAscRow | dbmodels.ListAuditLogsByTenantDescRow
}

func auditLogIDs[T auditLogRow](rows []T) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		switch value := any(row).(type) {
		case dbmodels.ListAuditLogsByTenantAscRow:
			ids = append(ids, value.ID)
		case dbmodels.ListAuditLogsByTenantDescRow:
			ids = append(ids, value.ID)
		}
	}
	return ids
}
