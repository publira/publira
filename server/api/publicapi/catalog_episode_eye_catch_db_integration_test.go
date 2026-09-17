package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Episodes have no artwork of their own, so the episode read carries its
// series' eye catch for the links to the neighbouring episodes, the same
// variants the series read answers with.
func TestDBGetEpisodeDetailCarriesTheSeriesEyeCatch(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	illustrated := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESART001", Title: "Illustrated", Published: true})
	env.PG.SeedEpisode(t, tenant.ID, illustrated.ID, testutil.EpisodeSeed{PublicID: "EPISODEART01", Status: testutil.EpisodeStatusPublished})
	bare := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBARE01", Title: "Bare", Published: true})
	env.PG.SeedEpisode(t, tenant.ID, bare.ID, testutil.EpisodeSeed{PublicID: "EPISODEBARE1", Status: testutil.EpisodeStatusPublished})

	ctx := context.Background()
	imageID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx,
		"INSERT INTO series_images (id, tenant_id, series_id) VALUES ($1, $2, $3)", imageID, tenant.ID, illustrated.ID,
	); err != nil {
		t.Fatalf("insert series image: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO series_image_variants (
			id, tenant_id, series_image_id, label, variant_type,
			storage_provider, object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'md', 'portrait', 'local', 'tenants/TENANTA/series/portrait/768', 'image/webp', 3072, 768, 1024)
	`, uuid.Must(uuid.NewV7()), tenant.ID, imageID); err != nil {
		t.Fatalf("insert series image variant: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx,
		"UPDATE series SET eye_catch_image_id = $2 WHERE id = $1", illustrated.ID, imageID,
	); err != nil {
		t.Fatalf("point series at its eye catch: %v", err)
	}

	read := func(t *testing.T, publicID string) *publirav1.GetEpisodeDetailResponse {
		t.Helper()
		resp, err := env.catalogClient().GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		return resp.Msg
	}

	t.Run("series-with-an-eye-catch", func(t *testing.T) {
		series := read(t, "EPISODEART01").Series
		variants := series.GetEyeCatchImageVariants()
		if len(variants) != 1 {
			t.Fatalf("eye_catch_image_variants = %+v, want one", variants)
		}
		if want := "/images/series/" + imageID.String() + "/portrait/768"; variants[0].Url != want {
			t.Fatalf("variant url = %q, want %q", variants[0].Url, want)
		}
		if _, err := time.Parse(time.RFC3339, series.EyeCatchImageUpdatedAt); err != nil {
			t.Fatalf("eye_catch_image_updated_at = %q, want an RFC 3339 instant: %v", series.EyeCatchImageUpdatedAt, err)
		}
	})

	t.Run("series-without-one", func(t *testing.T) {
		series := read(t, "EPISODEBARE1").Series
		if len(series.GetEyeCatchImageVariants()) != 0 || series.EyeCatchImageUpdatedAt != "" {
			t.Fatalf("series = %+v, want no eye catch", series)
		}
	})
}
