package dbmodels_test

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListAccessTicketsForTenantPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TICKETTNT001", "ticket.example.com", "admin-ticket.example.com", "Ticket Tenant")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "EPTICKET0001", "Ticket Episode")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertAccessTicketAt(
			t, ctx, pg.DB, tenantID, episodeID,
			fmt.Sprintf("TICKETPAGE%02d", index),
			createdAt.Add(-time.Duration(index)*time.Minute),
		)
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID: tenantID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantDesc first page: %v", err)
	}
	if got := accessTicketDescIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}

	inclusiveNextPage, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantDesc inclusive page: %v", err)
	}
	if got := accessTicketDescIDs(inclusiveNextPage); !slices.Equal(got, ids[1:3]) {
		t.Fatalf("inclusive next page IDs = %v, want boundary included %v", got, ids[1:3])
	}

	secondPage, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantDesc second page: %v", err)
	}
	if got := accessTicketDescIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want the last page reached without an offset %v", got, ids[2:])
	}

	previousPage, err := queries.ListAccessTicketsForTenantAsc(ctx, dbmodels.ListAccessTicketsForTenantAscParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{ids[1], ids[0]}
	if got := accessTicketAscIDs(previousPage); !slices.Equal(got, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", got, wantPreviousScan)
	}
}

// Rows created in the same transaction share created_at, so the id tiebreaker is
// the only thing keeping the page boundary on exactly one row.
func TestListAccessTicketsForTenantPaginatesRowsSharingCreatedAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TICKETTNT002", "ticket2.example.com", "admin-ticket2.example.com", "Ticket Tenant 2")
	episodeID := mustInsertEpisode(t, ctx, pg.DB, tenantID, "EPTICKET0002", "Ticket Episode 2")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 3)
	for index := range ids {
		ids[index] = mustInsertAccessTicketAt(
			t, ctx, pg.DB, tenantID, episodeID,
			fmt.Sprintf("TICKETTIED%02d", index),
			createdAt,
		)
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID: tenantID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantDesc first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("first page rows = %d, want 2", len(firstPage))
	}
	secondPage, err := queries.ListAccessTicketsForTenantDesc(ctx, dbmodels.ListAccessTicketsForTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAccessTicketsForTenantDesc second page: %v", err)
	}

	seen := append(accessTicketDescIDs(firstPage), accessTicketDescIDs(secondPage)...)
	if !slices.Equal(sortedUUIDs(seen), sortedUUIDs(ids)) {
		t.Fatalf("paged IDs = %v, want every row exactly once %v", seen, ids)
	}
}

// Each ticket gets its own user: the unique partial index on non-revoked
// (tenant, user, episode) rows allows only one live ticket per pair.
func mustInsertAccessTicketAt(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, episodeID uuid.UUID,
	publicID string,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	userID := mustInsertUser(t, ctx, db, tenantID, "U"+publicID[1:], publicID+"@example.com", "Member "+publicID)
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, tenantID, publicID, episodeID, userID, createdAt)
	if err != nil {
		t.Fatalf("insert access ticket %s: %v", publicID, err)
	}
	return id
}

func accessTicketDescIDs(rows []dbmodels.ListAccessTicketsForTenantDescRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func accessTicketAscIDs(rows []dbmodels.ListAccessTicketsForTenantAscRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}
