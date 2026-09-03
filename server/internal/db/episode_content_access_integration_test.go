package dbmodels_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

// TestUserHasEpisodeContentAccess verifies purchase/ticket grant predicates against real PostgreSQL.
func TestUserHasEpisodeContentAccess(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := pg.DB
	q := dbmodels.New(db)

	tenantA := mustInsertTenant(t, ctx, db, "TENANTAAAAA1", "a.example.com", "admin-a.example.com", "Tenant A")
	tenantB := mustInsertTenant(t, ctx, db, "TENANTBBBBB2", "b.example.com", "admin-b.example.com", "Tenant B")

	userA := mustInsertUser(t, ctx, db, tenantA, "USERAAAAAAA1", "user-a@example.com", "User A")
	userB := mustInsertUser(t, ctx, db, tenantB, "USERBBBBBBB2", "user-b@example.com", "User B")

	episodeA := mustInsertEpisode(t, ctx, db, tenantA, "EPAAAAAAAAA1", "Episode A")
	episodeB := mustInsertEpisode(t, ctx, db, tenantB, "EPBBBBBBBBB2", "Episode B")

	now := time.Now().UTC()
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	// No grants → false
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, false)

	// Valid purchase (no expiry) → true
	mustInsertPurchase(t, ctx, db, tenantA, userA, episodeA, nil)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, true)

	// Expired purchase only → false (replace with expired row after clearing)
	mustDeletePurchases(t, ctx, db, tenantA)
	mustInsertPurchase(t, ctx, db, tenantA, userA, episodeA, &past)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, false)

	// Future-expiring purchase → true
	mustDeletePurchases(t, ctx, db, tenantA)
	mustInsertPurchase(t, ctx, db, tenantA, userA, episodeA, &future)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, true)

	// Clear purchases; valid ticket → true
	mustDeletePurchases(t, ctx, db, tenantA)
	ticketID := mustInsertAccessTicketWithTimes(t, ctx, db, tenantA, "TICKETVALID1", episodeA, userA, nil, nil)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, true)

	// Revoked ticket → false
	mustRevokeAccessTicket(t, ctx, db, ticketID)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, false)

	// Expired ticket → false
	mustDeleteAccessTickets(t, ctx, db, tenantA)
	_ = mustInsertAccessTicketWithTimes(t, ctx, db, tenantA, "TICKETEXPR01", episodeA, userA, &past, nil)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, false)

	// Cross-tenant purchase/ticket must not grant access on tenant A episode for user A via tenant B data,
	// and tenant A user must not gain access from tenant B grants on episode B.
	mustDeleteAccessTickets(t, ctx, db, tenantA)
	mustInsertPurchase(t, ctx, db, tenantB, userB, episodeB, nil)
	_ = mustInsertAccessTicketWithTimes(t, ctx, db, tenantB, "TICKETOTHER1", episodeB, userB, nil, nil)
	assertContentAccess(t, ctx, q, tenantA, userA, episodeA, false)
	// Looking up with wrong tenant context still false for cross-tenant pair
	assertContentAccess(t, ctx, q, tenantA, userA, episodeB, false)
	assertContentAccess(t, ctx, q, tenantB, userA, episodeB, false)
}

func assertContentAccess(
	t *testing.T,
	ctx context.Context,
	q *dbmodels.Queries,
	tenantID, userID, episodeID uuid.UUID,
	want bool,
) {
	t.Helper()
	got, err := q.UserHasEpisodeContentAccess(ctx, dbmodels.UserHasEpisodeContentAccessParams{
		TenantID:  tenantID,
		UserID:    userID,
		EpisodeID: episodeID,
	})
	if err != nil {
		t.Fatalf("UserHasEpisodeContentAccess: %v", err)
	}
	if !got.Valid {
		t.Fatalf("has_access is NULL")
	}
	if got.Bool != want {
		t.Fatalf("has_access = %v, want %v (tenant=%s user=%s episode=%s)", got.Bool, want, tenantID, userID, episodeID)
	}
}

func mustInsertPurchase(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, userID, episodeID uuid.UUID,
	expiresAt *time.Time,
) {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	var expires any
	if expiresAt != nil {
		expires = *expiresAt
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, expires_at)
		VALUES ($1, $2, $3, $4, 500, $5)
	`, id, tenantID, userID, episodeID, expires)
	if err != nil {
		t.Fatalf("insert purchase: %v", err)
	}
}

func mustDeletePurchases(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `DELETE FROM purchases WHERE tenant_id = $1`, tenantID); err != nil {
		t.Fatalf("delete purchases: %v", err)
	}
}

func mustInsertAccessTicketWithTimes(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID uuid.UUID,
	publicID string,
	episodeID, userID uuid.UUID,
	expiresAt *time.Time,
	revokedAt *time.Time,
) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	var expires any
	if expiresAt != nil {
		expires = *expiresAt
	}
	var revoked any
	if revokedAt != nil {
		revoked = *revokedAt
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at, revoked_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, tenantID, publicID, episodeID, userID, expires, revoked)
	if err != nil {
		t.Fatalf("insert access_ticket %s: %v", publicID, err)
	}
	return id
}

func mustRevokeAccessTicket(t *testing.T, ctx context.Context, db *sql.DB, ticketID uuid.UUID) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `UPDATE access_tickets SET revoked_at = NOW() WHERE id = $1`, ticketID); err != nil {
		t.Fatalf("revoke access_ticket: %v", err)
	}
}

func mustDeleteAccessTickets(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `DELETE FROM access_tickets WHERE tenant_id = $1`, tenantID); err != nil {
		t.Fatalf("delete access_tickets: %v", err)
	}
}
