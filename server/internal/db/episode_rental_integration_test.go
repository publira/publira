package dbtest

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// A rental undercuts the permanent copy and always expires, so a listing
// carries both of its columns or neither, priced below an episode that has a
// price.
func TestEpisodeListingRentalUndercutsThePermanentCopy(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tests := []struct {
		name               string
		price              int32
		rentalPrice, hours sql.NullInt32
		wantErr            bool
	}{
		{name: "an episode that is not rented", price: 500},
		{name: "a rental below the permanent copy", price: 500, rentalPrice: sql.NullInt32{Int32: 200, Valid: true}, hours: sql.NullInt32{Int32: 48, Valid: true}},
		{name: "a rental priced as the permanent copy", price: 500, rentalPrice: sql.NullInt32{Int32: 500, Valid: true}, hours: sql.NullInt32{Int32: 48, Valid: true}, wantErr: true},
		{name: "a rental of a free episode", price: 0, rentalPrice: sql.NullInt32{Int32: 100, Valid: true}, hours: sql.NullInt32{Int32: 48, Valid: true}, wantErr: true},
		{name: "a free rental", price: 500, rentalPrice: sql.NullInt32{Int32: 0, Valid: true}, hours: sql.NullInt32{Int32: 48, Valid: true}, wantErr: true},
		{name: "a rental without a period", price: 500, rentalPrice: sql.NullInt32{Int32: 200, Valid: true}, wantErr: true},
		{name: "a period without a rental", price: 500, hours: sql.NullInt32{Int32: 48, Valid: true}, wantErr: true},
		{name: "a rental that expires at once", price: 500, rentalPrice: sql.NullInt32{Int32: 200, Valid: true}, hours: sql.NullInt32{Int32: 0, Valid: true}, wantErr: true},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
				PublicID: fmt.Sprintf("EPISODEA%04d", i+1),
				Title:    tt.name,
				Price:    tt.price,
				Status:   testutil.EpisodeStatusPublished,
			})
			_, err := pg.DB.ExecContext(ctx, `
				UPDATE episode_listings
				SET rental_price = $2,
					rental_period_hours = $3
				WHERE episode_id = $1
			`, episode.ID, tt.rentalPrice, tt.hours)
			if tt.wantErr {
				if !isCheckViolation(err) || checkName(err) != "episode_listings_rental_check" {
					t.Fatalf("update error = %v, want episode_listings_rental_check violated", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("update: %v", err)
			}
		})
	}
}

// Every purchase written without a kind is the permanent copy, as every
// purchase recorded before rentals was, a kind naming neither sale is refused,
// and so is a rental that does not expire.
func TestPurchaseKindDefaultsToThePermanentCopy(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Price: 500, Status: testutil.EpisodeStatusPublished})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	var kind string
	if err := pg.DB.QueryRowContext(ctx, `SELECT kind FROM purchases WHERE tenant_id = $1`, tenant.ID).Scan(&kind); err != nil {
		t.Fatalf("read kind: %v", err)
	}
	if kind != "purchase" {
		t.Fatalf("kind = %q, want purchase", kind)
	}

	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, kind)
		VALUES ($1, $2, $3, $4, 500, 'JPY', 'subscription')
	`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, episode.ID)
	if !isCheckViolation(err) || checkName(err) != "purchases_kind_check" {
		t.Fatalf("insert error = %v, want purchases_kind_check violated", err)
	}

	// A rental that never expired would open the episode for good at the
	// rental's price.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, kind)
		VALUES ($1, $2, $3, $4, 200, 'JPY', 'rental')
	`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, episode.ID)
	if !isCheckViolation(err) || checkName(err) != "purchases_rental_expires_check" {
		t.Fatalf("insert error = %v, want purchases_rental_expires_check violated", err)
	}
}

// episode_content_grants names which sale a purchase grant is, and nothing on
// the grants that are no purchase, so a reader holding a rental can still be
// told apart from one holding the permanent copy.
func TestEpisodeContentGrantsNameThePurchaseKind(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Price: 500, Status: testutil.EpisodeStatusPublished})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, kind, expires_at)
		VALUES ($1, $2, $3, $4, 200, 'JPY', 'rental', now() + interval '48 hours'),
			($5, $2, $3, $4, 200, 'JPY', 'rental', now() - interval '1 hour')
	`, uuid.Must(uuid.NewV7()), tenant.ID, reader.ID, episode.ID, uuid.Must(uuid.NewV7())); err != nil {
		t.Fatalf("insert rentals: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id)
		VALUES ($1, $2, 'TICKET000001', $3, $4)
	`, uuid.Must(uuid.NewV7()), tenant.ID, episode.ID, reader.ID); err != nil {
		t.Fatalf("insert access ticket: %v", err)
	}

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT kind, purchase_kind
		FROM episode_content_grants
		WHERE tenant_id = $1
			AND user_id = $2
			AND episode_id = $3
		ORDER BY kind
	`, tenant.ID, reader.ID, episode.ID)
	if err != nil {
		t.Fatalf("read grants: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []string
	for rows.Next() {
		var (
			kind         string
			purchaseKind sql.NullString
		)
		if err := rows.Scan(&kind, &purchaseKind); err != nil {
			t.Fatalf("scan grant: %v", err)
		}
		got = append(got, kind+":"+purchaseKind.String)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read grants: %v", err)
	}
	// The expired rental grants nothing.
	want := []string{"access_ticket:", "purchase:rental"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("grants (kind:purchase kind) = %v, want %v", got, want)
	}
}
