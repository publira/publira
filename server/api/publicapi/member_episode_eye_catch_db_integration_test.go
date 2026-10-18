package publicapi

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedSeriesEyeCatch gives the series an eye-catch of one portrait variant and
// returns the image's id.
func seedSeriesEyeCatch(t *testing.T, env *publicDBEnv, tenantID uuid.UUID, series testutil.Series) uuid.UUID {
	t.Helper()

	ctx := context.Background()
	imageID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `INSERT INTO series_images (id, tenant_id, series_id) VALUES ($1, $2, $3)`,
		imageID, tenantID, series.ID); err != nil {
		t.Fatalf("seed series image: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `INSERT INTO series_image_variants
		(id, tenant_id, series_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'md', 'portrait', 'local', 'tenants/TENANTA/series/portrait/768', 'image/webp', 3072, 768, 1024)`,
		uuid.Must(uuid.NewV7()), tenantID, imageID); err != nil {
		t.Fatalf("seed series image variant: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE series SET eye_catch_image_id = $1 WHERE id = $2`, imageID, series.ID); err != nil {
		t.Fatalf("point the series at its eye-catch: %v", err)
	}
	return imageID
}

// assertEpisodeEyeCatch checks that the episode carries the seeded square
// variant of imageID under its own route, or, for uuid.Nil, no eye-catch at
// all.
func assertEpisodeEyeCatch(t *testing.T, episode *publirattypesv1.Episode, imageID uuid.UUID) {
	t.Helper()

	variants := episode.GetEyeCatchImageVariants()
	if imageID == uuid.Nil {
		if len(variants) != 0 || episode.GetEyeCatchImageUpdatedAt() != "" {
			t.Fatalf("episode %s = %v at %q, want no eye-catch of its own", episode.GetPublicId(), variants, episode.GetEyeCatchImageUpdatedAt())
		}
		return
	}
	wantPrefix := "/images/episode-eye-catches/" + imageID.String() + "/square/600"
	if len(variants) != 1 || !strings.HasPrefix(variants[0].GetUrl(), wantPrefix) {
		t.Fatalf("episode %s variants = %v, want the seeded variant under %q", episode.GetPublicId(), variants, wantPrefix)
	}
	if episode.GetEyeCatchImageUpdatedAt() == "" {
		t.Fatalf("episode %s eye_catch_image_updated_at is empty", episode.GetPublicId())
	}
}

// A reading history entry draws the episode's own eye-catch, and its series'
// where the episode has none, so it carries both. Two entries of one series
// carry the same series variants.
func TestDBListMyEpisodeReadsCarriesBothEyeCatches(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERART01", "member-art@example.com", "Member", "tenant_member")
	illustrated := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESART001", Title: "Illustrated", Published: true})
	withEyeCatch := env.PG.SeedEpisode(t, tenant.ID, illustrated.ID, testutil.EpisodeSeed{PublicID: "EPISODEART01", Title: "Chapter One", Status: testutil.EpisodeStatusPublished})
	withoutEyeCatch := env.PG.SeedEpisode(t, tenant.ID, illustrated.ID, testutil.EpisodeSeed{PublicID: "EPISODEART02", Title: "Chapter Two", Status: testutil.EpisodeStatusPublished})
	bare := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBARE01", Title: "Bare", Published: true})
	bareEpisode := env.PG.SeedEpisode(t, tenant.ID, bare.ID, testutil.EpisodeSeed{PublicID: "EPISODEBARE1", Title: "Chapter One", Status: testutil.EpisodeStatusPublished})
	seriesImageID := seedSeriesEyeCatch(t, env, tenant.ID, illustrated)
	episodeImageID := seedEpisodeEyeCatch(t, env, tenant.ID, withEyeCatch)

	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, member))
	client := env.episodeReadClient()
	for _, episode := range []testutil.Episode{withEyeCatch, withoutEyeCatch, bareEpisode} {
		if _, err := client.MarkEpisodeAsRead(ctx, episodeReadRequest(tenant, episode.ID.String())); err != nil {
			t.Fatalf("MarkEpisodeAsRead %s: %v", episode.PublicID, err)
		}
	}

	response, err := client.ListMyEpisodeReads(ctx, episodeReadListRequest(tenant, 0, ""))
	if err != nil {
		t.Fatalf("ListMyEpisodeReads: %v", err)
	}
	if len(response.Reads) != 3 {
		t.Fatalf("reads = %v, want all three", historyEpisodePublicIDs(response.Reads))
	}
	wantSeriesURL := "/images/series/" + seriesImageID.String() + "/portrait/768"
	for _, read := range response.Reads {
		series := read.GetSeries()
		switch read.GetEpisode().GetPublicId() {
		case withEyeCatch.PublicID:
			assertEpisodeEyeCatch(t, read.GetEpisode(), episodeImageID)
		case withoutEyeCatch.PublicID, bareEpisode.PublicID:
			assertEpisodeEyeCatch(t, read.GetEpisode(), uuid.Nil)
		}
		variants := series.GetEyeCatchImageVariants()
		if series.GetPublicId() == bare.PublicID {
			if len(variants) != 0 {
				t.Fatalf("series %s variants = %v, want none", series.GetPublicId(), variants)
			}
			continue
		}
		if len(variants) != 1 || !strings.HasPrefix(variants[0].GetUrl(), wantSeriesURL) {
			t.Fatalf("series %s variants = %v, want the seeded variant under %q", series.GetPublicId(), variants, wantSeriesURL)
		}
	}
}

func TestDBListMyRecentSeriesCarriesTheEpisodesEyeCatch(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERART01", "member-art@example.com", "Member", "tenant_member")
	illustrated := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESART001", Title: "Illustrated", Published: true})
	withEyeCatch := seedEpisodeWithPages(t, env, tenant.ID, illustrated.ID, testutil.EpisodeSeed{PublicID: "EPISODEART01", Title: "Chapter One", Status: testutil.EpisodeStatusPublished}, 10)
	bare := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBARE01", Title: "Bare", Published: true})
	withoutEyeCatch := seedEpisodeWithPages(t, env, tenant.ID, bare.ID, testutil.EpisodeSeed{PublicID: "EPISODEBARE1", Title: "Chapter One", Status: testutil.EpisodeStatusPublished}, 10)
	imageID := seedEpisodeEyeCatch(t, env, tenant.ID, withEyeCatch)

	ctx := testutil.WithBearer(context.Background(), tokenFor(t, tenant, member))
	client := env.episodeReadClient()
	for _, episode := range []testutil.Episode{withEyeCatch, withoutEyeCatch} {
		if _, err := client.SaveReadingPosition(ctx, saveReadingPositionRequest(tenant, episode.ID.String(), 3)); err != nil {
			t.Fatalf("SaveReadingPosition %s: %v", episode.PublicID, err)
		}
	}

	response, err := client.ListMyRecentSeries(ctx, recentSeriesRequest(tenant, 0, ""))
	if err != nil {
		t.Fatalf("ListMyRecentSeries: %v", err)
	}
	if len(response.Series) != 2 {
		t.Fatalf("series = %v, want both", recentSeriesPublicIDs(response.Series))
	}
	for _, item := range response.Series {
		switch item.GetEpisode().GetPublicId() {
		case withEyeCatch.PublicID:
			assertEpisodeEyeCatch(t, item.GetEpisode(), imageID)
		case withoutEyeCatch.PublicID:
			assertEpisodeEyeCatch(t, item.GetEpisode(), uuid.Nil)
		default:
			t.Fatalf("episode = %q, want one of the two in progress", item.GetEpisode().GetPublicId())
		}
	}
}

func TestDBListMyFollowUpdatesCarriesTheEpisodesEyeCatch(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERART01", "member-art@example.com", "Member", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESART001", Title: "Followed", Published: true})
	withEyeCatch := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEART01", Title: "Chapter One", Status: testutil.EpisodeStatusPublished})
	withoutEyeCatch := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEART02", Title: "Chapter Two", Status: testutil.EpisodeStatusPublished})
	imageID := seedEpisodeEyeCatch(t, env, tenant.ID, withEyeCatch)
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, series.ID); err != nil {
		t.Fatalf("insert series follow: %v", err)
	}

	response, err := env.followClient().ListMyFollowUpdates(testutil.WithBearer(context.Background(), tokenFor(t, tenant, member)), followUpdateRequest(tenant, 0, ""))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates: %v", err)
	}
	if len(response.Updates) != 2 {
		t.Fatalf("updates = %v, want both episodes", followUpdateEpisodePublicIDs(response.Updates))
	}
	for _, update := range response.Updates {
		switch update.GetEpisode().GetPublicId() {
		case withEyeCatch.PublicID:
			assertEpisodeEyeCatch(t, update.GetEpisode(), imageID)
		case withoutEyeCatch.PublicID:
			assertEpisodeEyeCatch(t, update.GetEpisode(), uuid.Nil)
		default:
			t.Fatalf("episode = %q, want one of the followed series' two", update.GetEpisode().GetPublicId())
		}
	}
}
