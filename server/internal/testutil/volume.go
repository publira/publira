package testutil

import (
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/publicid"
)

// VolumeSeed describes a volume to insert. A zero price is 900, and the
// episodes are stored in the order given.
type VolumeSeed struct {
	PublicID   string
	Title      string
	OrderIndex int32
	Price      int32
	Published  bool
	EpisodeIDs []uuid.UUID
}

// Volume is a seeded volumes row.
type Volume struct {
	ID       uuid.UUID
	PublicID string
}

// SeedVolume inserts a volume of the series holding the given episodes, the
// way CreateVolume, SetVolumeEpisodes, and PublishVolume leave one.
func (e *PostgresEnv) SeedVolume(t *testing.T, tenantID, seriesID uuid.UUID, seed VolumeSeed) Volume {
	t.Helper()
	e.requireDB(t)

	publicID := seed.PublicID
	if publicID == "" {
		var err error
		publicID, err = publicid.New()
		if err != nil {
			t.Fatalf("publicid.New: %v", err)
		}
	}
	price := seed.Price
	if price == 0 {
		price = 900
	}
	volume := Volume{ID: uuid.Must(uuid.NewV7()), PublicID: publicID}

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO volumes (id, tenant_id, public_id, series_id, title, order_index, price, is_published, published_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN now() END)
	`, volume.ID, tenantID, publicID, seriesID, defaultIfEmpty(seed.Title, "Volume "+publicID), seed.OrderIndex, price, seed.Published); err != nil {
		t.Fatalf("insert volume %s: %v", publicID, err)
	}
	if len(seed.EpisodeIDs) > 0 {
		if _, err := e.DB.ExecContext(ctx, `
			INSERT INTO volume_episodes (tenant_id, volume_id, episode_id, "position")
			SELECT $1, $2, e.episode_id, (e.ordinality - 1)::int4
			FROM unnest($3::uuid[]) WITH ORDINALITY AS e(episode_id, ordinality)
		`, tenantID, volume.ID, pq.Array(uuidStrings(seed.EpisodeIDs))); err != nil {
			t.Fatalf("insert the episodes of volume %s: %v", publicID, err)
		}
	}
	return volume
}

func uuidStrings(ids []uuid.UUID) []string {
	values := make([]string, 0, len(ids))
	for _, id := range ids {
		values = append(values, id.String())
	}
	return values
}
