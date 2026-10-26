package publicapi

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedEpisodeEyeCatch gives the episode an eye-catch of one square variant
// and returns the image's id.
func seedEpisodeEyeCatch(t *testing.T, env *publicDBEnv, tenantID uuid.UUID, episode testutil.Episode) uuid.UUID {
	t.Helper()

	ctx := context.Background()
	imageID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `INSERT INTO episode_eye_catch_images (id, tenant_id, episode_id) VALUES ($1, $2, $3)`,
		imageID, tenantID, episode.ID); err != nil {
		t.Fatalf("seed episode eye-catch image: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `INSERT INTO episode_eye_catch_image_variants
		(id, tenant_id, episode_eye_catch_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'square_600w', 'square', 's3', 'tenants/TENANTA/episode-eye-catches/episode.webp', 'image/webp', 1, 600, 600)`,
		uuid.Must(uuid.NewV7()), tenantID, imageID); err != nil {
		t.Fatalf("seed episode eye-catch variant: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE episodes SET eye_catch_image_id = $1 WHERE id = $2`, imageID, episode.ID); err != nil {
		t.Fatalf("point the episode at its eye-catch: %v", err)
	}
	return imageID
}

// The series page and the top page draw an episode row from the episodes the
// series detail lists, so each of them carries its own eye-catch, and one
// without carries none rather than its series'.
func TestDBGetSeriesDetailCarriesEachEpisodesEyeCatch(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Serialized Story",
		Published: true,
	})
	withEyeCatch := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB01",
		Title:    "Chapter One",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB02",
		Title:    "Chapter Two",
		Status:   testutil.EpisodeStatusPublished,
	})
	imageID := seedEpisodeEyeCatch(t, env, tenant.ID, withEyeCatch)

	resp, err := env.catalogClient().GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if got := episodePublicIDs(resp.Episodes); len(got) != 2 {
		t.Fatalf("episodes = %v, want both published ones", got)
	}
	first := resp.Episodes[0]
	if len(first.EyeCatchImageVariants) != 1 || !strings.HasPrefix(first.EyeCatchImageVariants[0].Url, "/images/episode-eye-catches/"+imageID.String()+"/") {
		t.Fatalf("first episode variants = %v, want the seeded variant under its own route", first.EyeCatchImageVariants)
	}
	if first.EyeCatchImageUpdatedAt == "" {
		t.Fatal("first episode eye_catch_image_updated_at is empty")
	}
	second := resp.Episodes[1]
	if len(second.EyeCatchImageVariants) != 0 || second.EyeCatchImageUpdatedAt != "" {
		t.Fatalf("second episode = %v at %q, want no eye-catch of its own", second.EyeCatchImageVariants, second.EyeCatchImageUpdatedAt)
	}
}

func TestDBGetEpisodeDetailCarriesTheEpisodesEyeCatch(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Serialized Story",
		Published: true,
	})
	withEyeCatch := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB01",
		Title:    "Chapter One",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB02",
		Title:    "Chapter Two",
		Status:   testutil.EpisodeStatusPublished,
	})
	imageID := seedEpisodeEyeCatch(t, env, tenant.ID, withEyeCatch)

	read := func(publicID string) *publirav1.GetEpisodeDetailResponse {
		t.Helper()
		resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		})
		if err != nil {
			t.Fatalf("GetEpisodeDetail(%s): %v", publicID, err)
		}
		return resp
	}

	with := read("EPISODEPUB01").Episode
	if len(with.EyeCatchImageVariants) != 1 || with.EyeCatchImageVariants[0].VariantType != "square" || with.EyeCatchImageVariants[0].Width != 600 {
		t.Fatalf("episode variants = %v, want the seeded square variant", with.EyeCatchImageVariants)
	}
	wantPrefix := "/images/episode-eye-catches/" + imageID.String() + "/square/600"
	if url := with.EyeCatchImageVariants[0].Url; !strings.HasPrefix(url, wantPrefix) {
		t.Fatalf("episode variant url = %q, want it under %q", url, wantPrefix)
	}
	without := read("EPISODEPUB02").Episode
	if len(without.EyeCatchImageVariants) != 0 || without.EyeCatchImageUpdatedAt != "" {
		t.Fatalf("episode without an eye-catch = %v at %q, want both empty", without.EyeCatchImageVariants, without.EyeCatchImageUpdatedAt)
	}
}
