package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before a
// purchase recorded its revocation, and the one that moved the entitlement onto
// it.
const (
	beforePurchaseRevocationVersion = 20261014122039
	purchaseRevocationVersion       = 20261014134849
)

// A purchase refunded in full before purchases recorded a revocation is revoked
// by that refund once the migrations have run, so the entitlement that now
// reads the revocation does not open its episode again. A partial refund, and a
// purchase never refunded, stay open.
func TestPurchaseRevocationMigrationRevokesRefundedPurchases(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforePurchaseRevocationVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	refunded := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Refunded", Status: testutil.EpisodeStatusPublished, Price: 500})
	partial := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0002", Title: "Partly refunded", Status: testutil.EpisodeStatusPublished, Price: 500})
	paid := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0003", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The reader and the purchases are inserted by hand: the generated queries
	// read back every column on the newest schema, which this one predates.
	readerID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
		VALUES ($1, $2, 'ENDUSERA0001', 'reader@tenant-a.example.com', '', 'Reader')
	`, readerID, tenant.ID); err != nil {
		t.Fatalf("insert reader: %v", err)
	}
	refundedAt := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	insert := func(episodeID uuid.UUID, refundedAmount sql.NullInt32, refundedAt sql.NullTime) uuid.UUID {
		t.Helper()
		id := uuid.Must(uuid.NewV7())
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, refunded_amount, refunded_at, currency)
			VALUES ($1, $2, $3, $4, 500, $5, $6, 'JPY')
		`, id, tenant.ID, readerID, episodeID, refundedAmount, refundedAt); err != nil {
			t.Fatalf("insert purchase: %v", err)
		}
		return id
	}
	refundedID := insert(refunded.ID, sql.NullInt32{Int32: 500, Valid: true}, sql.NullTime{Time: refundedAt, Valid: true})
	partialID := insert(partial.ID, sql.NullInt32{Int32: 200, Valid: true}, sql.NullTime{})
	paidID := insert(paid.ID, sql.NullInt32{}, sql.NullTime{})

	pg.MigrateTo(t, purchaseRevocationVersion)

	type revocation struct {
		at     sql.NullTime
		reason sql.NullString
	}
	read := func(id uuid.UUID) revocation {
		t.Helper()
		var got revocation
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT revoked_at, revocation_reason
			FROM purchases
			WHERE id = $1
		`, id).Scan(&got.at, &got.reason); err != nil {
			t.Fatalf("read purchase %s: %v", id, err)
		}
		return got
	}
	if got := read(refundedID); !got.at.Valid || !got.at.Time.Equal(refundedAt) || got.reason.String != "refund" {
		t.Fatalf("refunded purchase = %+v, want revoked at %v for a refund", got, refundedAt)
	}
	for name, id := range map[string]uuid.UUID{"partly refunded": partialID, "paid": paidID} {
		if got := read(id); got.at.Valid || got.reason.Valid {
			t.Fatalf("%s purchase = %+v, want it left open", name, got)
		}
	}

	var granted []uuid.UUID
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT episode_id
		FROM episode_content_grants
		WHERE tenant_id = $1
			AND user_id = $2
		ORDER BY episode_id
	`, tenant.ID, readerID)
	if err != nil {
		t.Fatalf("read grants: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan grant: %v", err)
		}
		granted = append(granted, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read grants: %v", err)
	}
	want := map[uuid.UUID]bool{partial.ID: true, paid.ID: true}
	if len(granted) != len(want) || !want[granted[0]] || !want[granted[1]] {
		t.Fatalf("granted episodes = %v, want the partly refunded and the paid one", granted)
	}

	// Added NOT VALID so the column additions scanned nothing, the constraints
	// have to end up validated once the backfill has revoked every refund.
	for _, name := range []string{"purchases_revocation_reason_check", "purchases_refund_revokes_check"} {
		var validated bool
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT convalidated
			FROM pg_constraint
			WHERE conrelid = 'purchases'::regclass
				AND conname = $1
		`, name).Scan(&validated); err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !validated {
			t.Fatalf("%s is still NOT VALID after the migrations", name)
		}
	}

	// A write that records a full refund and leaves the purchase open is what
	// the constraint is there to refuse.
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE purchases
		SET refunded_amount = 500,
			refunded_at = NOW()
		WHERE id = $1
	`, paidID); err == nil {
		t.Fatal("a full refund that leaves the purchase open was accepted")
	}
}
