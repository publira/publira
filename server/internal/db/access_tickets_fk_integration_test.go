package dbmodels_test

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/testutil"
)

// TestAccessTicketsRejectCrossTenantReferences verifies composite FKs on
// access_tickets prevent user/episode rows from another tenant (issue #569).
func TestAccessTicketsRejectCrossTenantReferences(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Superuser bypasses RLS; we are testing declarative FK integrity only.
	db := pg.DB

	tenantA := mustInsertTenant(t, ctx, db, "TENANTAAAAA1", "a.example.com", "admin-a.example.com", "Tenant A")
	tenantB := mustInsertTenant(t, ctx, db, "TENANTBBBBB2", "b.example.com", "admin-b.example.com", "Tenant B")

	userA := mustInsertUser(t, ctx, db, tenantA, "USERAAAAAAA1", "user-a@example.com", "User A")
	userB := mustInsertUser(t, ctx, db, tenantB, "USERBBBBBBB2", "user-b@example.com", "User B")

	episodeA := mustInsertEpisode(t, ctx, db, tenantA, "EPAAAAAAAAA1", "Episode A")
	episodeB := mustInsertEpisode(t, ctx, db, tenantB, "EPBBBBBBBBB2", "Episode B")

	// Same-tenant grant succeeds.
	if err := insertAccessTicket(ctx, db, tenantA, "TICKETVALID1", episodeA, userA); err != nil {
		t.Fatalf("same-tenant access_tickets insert: %v", err)
	}

	// Cross-tenant episode must fail (composite FK on tenant_id, episode_id).
	err := insertAccessTicket(ctx, db, tenantA, "TICKETXEP001", episodeB, userA)
	if !isForeignKeyViolation(err) {
		t.Fatalf("cross-tenant episode insert error = %v, want foreign_key_violation", err)
	}
	if !strings.Contains(err.Error(), "access_tickets_tenant_episode_id_fkey") {
		t.Fatalf("cross-tenant episode error = %v, want access_tickets_tenant_episode_id_fkey", err)
	}

	// Cross-tenant user must fail (composite FK on tenant_id, user_id).
	err = insertAccessTicket(ctx, db, tenantA, "TICKETXUSR01", episodeA, userB)
	if !isForeignKeyViolation(err) {
		t.Fatalf("cross-tenant user insert error = %v, want foreign_key_violation", err)
	}
	if !strings.Contains(err.Error(), "access_tickets_tenant_user_id_fkey") {
		t.Fatalf("cross-tenant user error = %v, want access_tickets_tenant_user_id_fkey", err)
	}
}

func mustInsertTenant(t *testing.T, ctx context.Context, db *sql.DB, publicID, domain, adminDomain, name string) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
		VALUES ($1, $2, $3, $4, $5, 'active')
	`, id, publicID, domain, adminDomain, name)
	if err != nil {
		t.Fatalf("insert tenant %s: %v", publicID, err)
	}
	return id
}

func mustInsertUser(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, publicID, email, name string) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status)
		VALUES ($1, $2, $3, $4, 'hash', $5, 'active')
	`, id, tenantID, publicID, email, name)
	if err != nil {
		t.Fatalf("insert user %s: %v", publicID, err)
	}
	return id
}

func mustInsertEpisode(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, publicID, title string) uuid.UUID {
	t.Helper()
	seriesID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	episodeID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	seriesPublicID := publicID
	if len(seriesPublicID) > 12 {
		seriesPublicID = seriesPublicID[:12]
	}
	// Distinct series public_id per episode seed (global unique on series.public_id).
	seriesPublicID = "S" + publicID[1:]
	if len(seriesPublicID) > 12 {
		seriesPublicID = seriesPublicID[:12]
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO series (id, tenant_id, public_id, title, is_published)
		VALUES ($1, $2, $3, $4, false)
	`, seriesID, tenantID, seriesPublicID, title+" series")
	if err != nil {
		t.Fatalf("insert series for %s: %v", publicID, err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
		VALUES ($1, $2, $3, $4, 1, $5)
	`, episodeID, seriesID, publicID, title, tenantID)
	if err != nil {
		t.Fatalf("insert episode %s: %v", publicID, err)
	}
	return episodeID
}

func insertAccessTicket(ctx context.Context, db *sql.DB, tenantID uuid.UUID, publicID string, episodeID, userID uuid.UUID) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id)
		VALUES ($1, $2, $3, $4, $5)
	`, id, tenantID, publicID, episodeID, userID)
	return err
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23503"
	}
	// Drivers may wrap; fall back to message inspection.
	return err != nil && strings.Contains(err.Error(), "violates foreign key constraint")
}
