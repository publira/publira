package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// A purchase bought one episode or one volume, never both and never neither,
// and a volume is sold for good: never rented, and never through a store.
func TestPurchaseBuysOneEpisodeOrOneVolume(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Price: 500, Status: testutil.EpisodeStatusPublished})
	volume := pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{Published: true, EpisodeIDs: []uuid.UUID{episode.ID}})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	insert := func(episodeID, volumeID uuid.NullUUID, kind string, expiresAt sql.NullTime, store sql.NullString) error {
		var transactionID sql.NullString
		if store.Valid {
			transactionID = sql.NullString{String: uuid.NewString(), Valid: true}
		}
		_, err := pg.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, volume_id, price_at_purchase, currency, kind, expires_at, store, store_transaction_id)
			VALUES ($1, $2, $3, $4, $5, 900, 'JPY', $6, $7, $8, $9)
		`, uuid.New(), tenant.ID, reader.ID, episodeID, volumeID, kind, expiresAt, store, transactionID)
		return err
	}
	ofEpisode := uuid.NullUUID{UUID: episode.ID, Valid: true}
	ofVolume := uuid.NullUUID{UUID: volume.ID, Valid: true}
	inADay := sql.NullTime{Time: time.Now().Add(24 * time.Hour), Valid: true}

	if err := insert(ofEpisode, uuid.NullUUID{}, "purchase", sql.NullTime{}, sql.NullString{}); err != nil {
		t.Fatalf("a purchase of an episode: %v", err)
	}
	if err := insert(uuid.NullUUID{}, ofVolume, "purchase", sql.NullTime{}, sql.NullString{}); err != nil {
		t.Fatalf("a purchase of a volume: %v", err)
	}
	for name, err := range map[string]error{
		"a purchase of both":           insert(ofEpisode, ofVolume, "purchase", sql.NullTime{}, sql.NullString{}),
		"a purchase of neither":        insert(uuid.NullUUID{}, uuid.NullUUID{}, "purchase", sql.NullTime{}, sql.NullString{}),
		"a rental of a volume":         insert(uuid.NullUUID{}, ofVolume, "rental", inADay, sql.NullString{}),
		"a volume bought from a store": insert(uuid.NullUUID{}, ofVolume, "purchase", sql.NullTime{}, sql.NullString{String: "app_store", Valid: true}),
	} {
		if !isCheckViolation(err) || checkName(err) != "purchases_item_check" {
			t.Errorf("%s = %v, want purchases_item_check violated", name, err)
		}
	}
}

// An episode is in at most one volume.
func TestAnEpisodeIsInAtMostOneVolume(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Paid", Price: 500})
	pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{EpisodeIDs: []uuid.UUID{episode.ID}})
	other := pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{OrderIndex: 1})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO volume_episodes (tenant_id, volume_id, episode_id, "position")
		VALUES ($1, $2, $3, 0)
	`, tenant.ID, other.ID, episode.ID)
	if !isUniqueViolation(err) {
		t.Fatalf("an episode put in a second volume = %v, want a unique violation", err)
	}
}

// A purchase of a volume grants every episode the volume holds, as a purchase
// of each, and nothing outside it; a revoked one grants nothing.
func TestAVolumePurchaseGrantsTheEpisodesOfTheVolume(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	first := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Price: 500, Status: testutil.EpisodeStatusPublished})
	second := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0002", Price: 500, Status: testutil.EpisodeStatusPublished})
	outside := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0003", Price: 500, Status: testutil.EpisodeStatusPublished})
	volume := pg.SeedVolume(t, tenant.ID, series.ID, testutil.VolumeSeed{Published: true, EpisodeIDs: []uuid.UUID{first.ID, second.ID}})
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	purchaseID := uuid.New()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, volume_id, price_at_purchase, currency)
		VALUES ($1, $2, $3, $4, 900, 'JPY')
	`, purchaseID, tenant.ID, reader.ID, volume.ID); err != nil {
		t.Fatalf("record the purchase of the volume: %v", err)
	}

	granted := func() map[uuid.UUID]string {
		t.Helper()
		rows, err := pg.DB.QueryContext(ctx, `
			SELECT episode_id, kind || ':' || coalesce(purchase_kind, '')
			FROM episode_grants
			WHERE tenant_id = $1
				AND user_id = $2
		`, tenant.ID, reader.ID)
		if err != nil {
			t.Fatalf("read the grants: %v", err)
		}
		defer rows.Close() //nolint:errcheck
		grants := map[uuid.UUID]string{}
		for rows.Next() {
			var (
				episodeID uuid.UUID
				kind      string
			)
			if err := rows.Scan(&episodeID, &kind); err != nil {
				t.Fatalf("scan a grant: %v", err)
			}
			grants[episodeID] = kind
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("read the grants: %v", err)
		}
		return grants
	}

	grants := granted()
	ids := make([]uuid.UUID, 0, len(grants))
	for id, kind := range grants {
		if kind != "purchase:purchase" {
			t.Errorf("grant on %s = %q, want a purchase of the permanent copy", id, kind)
		}
		ids = append(ids, id)
	}
	if len(ids) != 2 || !slices.Contains(ids, first.ID) || !slices.Contains(ids, second.ID) || slices.Contains(ids, outside.ID) {
		t.Fatalf("granted episodes = %v, want the volume's two and not the one outside it", ids)
	}

	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE purchases
		SET revoked_at = now(), revocation_reason = 'refund', refunded_at = now(), refunded_amount = 900
		WHERE id = $1
	`, purchaseID); err != nil {
		t.Fatalf("revoke the purchase: %v", err)
	}
	if grants := granted(); len(grants) != 0 {
		t.Fatalf("grants after the purchase was revoked = %v, want none", grants)
	}
}
