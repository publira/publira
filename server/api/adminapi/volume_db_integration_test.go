package adminapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// volumeEnv is a tenant with a series of three episodes and a second series
// of one, and its tenant_admin signing the requests.
type volumeEnv struct {
	env      *adminDBEnv
	tenant   adminDBTenant
	series   testutil.Series
	episodes []testutil.Episode
	other    testutil.Episode
}

func newVolumeEnv(t *testing.T) volumeEnv {
	t.Helper()
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "VOLUMES", "volumes.example.com", "Volumes", "VOLADMIN01", "admin@volumes.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "VOLSERIES001", Published: true})
	episodes := make([]testutil.Episode, 0, 3)
	for _, publicID := range []string{"VOLEPISODE01", "VOLEPISODE02", "VOLEPISODE03"} {
		episodes = append(episodes, env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID: publicID,
			Price:    300,
			Status:   testutil.EpisodeStatusPublished,
		}))
	}
	otherSeries := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "VOLSERIES002", Published: true})
	other := env.PG.SeedEpisode(t, tenant.Tenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "VOLEPISODE09", Price: 300})
	return volumeEnv{env: env, tenant: tenant, series: series, episodes: episodes, other: other}
}

func (v volumeEnv) ctx() context.Context {
	return testutil.WithBearer(context.Background(), v.tenant.token())
}

func (v volumeEnv) create(t *testing.T, title string, price int32) *publiraadminv1.AdminVolume {
	t.Helper()
	created, err := v.env.seriesClient().CreateVolume(v.ctx(), &publiraadminv1.CreateVolumeRequest{
		Tenant:   v.tenant.tenantContext(),
		SeriesId: v.series.ID.String(),
		Title:    title,
		Price:    price,
		Currency: "USD",
	})
	if err != nil {
		t.Fatalf("CreateVolume(%q): %v", title, err)
	}
	return created.Volume
}

func (v volumeEnv) setEpisodes(volumeID string, episodes ...testutil.Episode) (*publiraadminv1.AdminVolume, error) {
	ids := make([]string, 0, len(episodes))
	for _, episode := range episodes {
		ids = append(ids, episode.ID.String())
	}
	res, err := v.env.seriesClient().SetVolumeEpisodes(v.ctx(), &publiraadminv1.SetVolumeEpisodesRequest{
		Tenant:     v.tenant.tenantContext(),
		VolumeId:   volumeID,
		EpisodeIds: ids,
	})
	if err != nil {
		return nil, err
	}
	return res.Volume, nil
}

func (v volumeEnv) publish(volumeID string, published bool) (*publiraadminv1.AdminVolume, error) {
	res, err := v.env.seriesClient().PublishVolume(v.ctx(), &publiraadminv1.PublishVolumeRequest{
		Tenant:    v.tenant.tenantContext(),
		VolumeId:  volumeID,
		Published: published,
	})
	if err != nil {
		return nil, err
	}
	return res.Volume, nil
}

func (v volumeEnv) list(t *testing.T) []*publiraadminv1.AdminVolume {
	t.Helper()
	res, err := v.env.seriesClient().ListVolumes(v.ctx(), &publiraadminv1.ListVolumesRequest{
		Tenant:   v.tenant.tenantContext(),
		SeriesId: v.series.ID.String(),
	})
	if err != nil {
		t.Fatalf("ListVolumes: %v", err)
	}
	return res.Volumes
}

func (v volumeEnv) volumeAuditCount(t *testing.T, action, targetType, targetID string) int {
	t.Helper()
	return v.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = $3 AND target_id = $4 AND outcome = 'success'",
		v.tenant.Tenant.ID, action, targetType, targetID,
	)
}

func episodeIDStrings(episodes ...testutil.Episode) []string {
	ids := make([]string, 0, len(episodes))
	for _, episode := range episodes {
		ids = append(ids, episode.ID.String())
	}
	return ids
}

// An editor creates a volume, gives it episodes in an order of its own,
// prices it, and puts it on sale, and the console reads all of it back.
func TestDBAVolumeIsCreatedFilledPricedAndPublished(t *testing.T) {
	t.Parallel()

	v := newVolumeEnv(t)

	volume := v.create(t, "  Volume One  ", 900)
	if volume.Title != "Volume One" || volume.Price != 900 || volume.SeriesId != v.series.ID.String() {
		t.Fatalf("created volume = %+v, want Volume One at 900 of the series", volume)
	}
	if volume.Published || volume.PublishedAt != "" || len(volume.EpisodeIds) != 0 || volume.OrderIndex != 0 {
		t.Fatalf("created volume = %+v, want an empty unpublished volume first in the series", volume)
	}
	if _, err := v.publish(volume.Id, true); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("publishing an empty volume = %v, want failed_precondition", err)
	}

	filled, err := v.setEpisodes(volume.Id, v.episodes[1], v.episodes[0])
	if err != nil {
		t.Fatalf("SetVolumeEpisodes: %v", err)
	}
	if want := episodeIDStrings(v.episodes[1], v.episodes[0]); !slices.Equal(filled.EpisodeIds, want) {
		t.Fatalf("episode_ids = %v, want the order given %v", filled.EpisodeIds, want)
	}

	updated, err := v.env.seriesClient().UpdateVolume(v.ctx(), &publiraadminv1.UpdateVolumeRequest{
		Tenant:   v.tenant.tenantContext(),
		VolumeId: volume.Id,
		Title:    "Volume 1",
		Price:    800,
		Currency: "USD",
	})
	if err != nil {
		t.Fatalf("UpdateVolume: %v", err)
	}
	if updated.Volume.Title != "Volume 1" || updated.Volume.Price != 800 {
		t.Fatalf("updated volume = %+v, want Volume 1 at 800", updated.Volume)
	}

	published, err := v.publish(volume.Id, true)
	if err != nil {
		t.Fatalf("PublishVolume: %v", err)
	}
	if !published.Published || published.PublishedAt == "" {
		t.Fatalf("published volume = %+v, want it on sale since now", published)
	}
	// Publishing again keeps the instant it was put on sale.
	again, err := v.publish(volume.Id, true)
	if err != nil {
		t.Fatalf("PublishVolume again: %v", err)
	}
	if again.PublishedAt != published.PublishedAt {
		t.Fatalf("published_at = %s after a second publish, want %s kept", again.PublishedAt, published.PublishedAt)
	}
	if _, err := v.setEpisodes(volume.Id); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("emptying a volume on sale = %v, want failed_precondition", err)
	}

	listed := v.list(t)
	if len(listed) != 1 || listed[0].Id != volume.Id || listed[0].Title != "Volume 1" || !listed[0].Published {
		t.Fatalf("listed volumes = %+v, want the one published volume", listed)
	}

	unpublished, err := v.publish(volume.Id, false)
	if err != nil {
		t.Fatalf("PublishVolume(false): %v", err)
	}
	// Taken off sale, it keeps the instant it was first put on sale.
	if unpublished.Published || unpublished.PublishedAt != published.PublishedAt {
		t.Fatalf("unpublished volume = %+v, want it off sale and first published at %s", unpublished, published.PublishedAt)
	}

	for action, want := range map[string]int{
		"volume_created":     1,
		"volume_updated":     2,
		"volume_published":   1,
		"volume_unpublished": 1,
	} {
		if got := v.volumeAuditCount(t, action, "volume", volume.PublicId); got != want {
			t.Errorf("audit %s = %d, want %d", action, got, want)
		}
	}
}

// An episode is in at most one volume and only in a volume of its own series,
// and a volume that has been on sale keeps every episode it held: a checkout
// started while it was on sale may still complete after it is taken off.
func TestDBSetVolumeEpisodesKeepsEachEpisodeInOneVolumeAndWhatWasOnSale(t *testing.T) {
	t.Parallel()

	v := newVolumeEnv(t)
	first := v.create(t, "Volume 1", 900)
	second := v.create(t, "Volume 2", 900)
	if second.OrderIndex != first.OrderIndex+1 {
		t.Fatalf("order_index = %d after %d, want the next one", second.OrderIndex, first.OrderIndex)
	}

	if _, err := v.setEpisodes(first.Id, v.other); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an episode of another series = %v, want invalid_argument", err)
	}
	if _, err := v.setEpisodes(first.Id, v.episodes[0], v.episodes[0]); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an episode named twice = %v, want invalid_argument", err)
	}
	if _, err := v.setEpisodes(first.Id, v.episodes[0], v.episodes[1], v.episodes[2]); err != nil {
		t.Fatalf("SetVolumeEpisodes: %v", err)
	}
	if _, err := v.setEpisodes(second.Id, v.episodes[2]); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("an episode another volume holds = %v, want failed_precondition", err)
	}
	// Before it is ever on sale, a volume is the editor's to change freely.
	if _, err := v.setEpisodes(first.Id, v.episodes[0], v.episodes[1]); err != nil {
		t.Fatalf("taking an episode out of a volume never on sale: %v", err)
	}
	if _, err := v.setEpisodes(second.Id, v.episodes[2]); err != nil {
		t.Fatalf("moving the freed episode to the second volume: %v", err)
	}

	if _, err := v.publish(first.Id, true); err != nil {
		t.Fatalf("PublishVolume: %v", err)
	}
	if _, err := v.setEpisodes(first.Id, v.episodes[0]); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("taking an episode out of a volume on sale = %v, want failed_precondition", err)
	}
	if _, err := v.publish(first.Id, false); err != nil {
		t.Fatalf("PublishVolume(false): %v", err)
	}
	if _, err := v.setEpisodes(first.Id, v.episodes[0]); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("taking an episode out of a volume taken off sale = %v, want failed_precondition", err)
	}
	if _, err := v.setEpisodes(first.Id); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("emptying a volume that has been on sale = %v, want failed_precondition", err)
	}
	// Reordering what it holds takes nothing from a buyer.
	reordered, err := v.setEpisodes(first.Id, v.episodes[1], v.episodes[0])
	if err != nil {
		t.Fatalf("reordering a volume that has been on sale: %v", err)
	}
	if want := episodeIDStrings(v.episodes[1], v.episodes[0]); !slices.Equal(reordered.EpisodeIds, want) {
		t.Fatalf("episode_ids = %v, want %v", reordered.EpisodeIds, want)
	}
}

func TestDBReorderVolumesWritesTheOrderTheConsoleRead(t *testing.T) {
	t.Parallel()

	v := newVolumeEnv(t)
	first := v.create(t, "Volume 1", 900)
	second := v.create(t, "Volume 2", 900)
	third := v.create(t, "Volume 3", 900)

	reorder := func(order, expected []string) (*publiraadminv1.ReorderVolumesResponse, error) {
		return v.env.seriesClient().ReorderVolumes(v.ctx(), &publiraadminv1.ReorderVolumesRequest{
			Tenant:            v.tenant.tenantContext(),
			SeriesId:          v.series.ID.String(),
			VolumeIds:         order,
			ExpectedVolumeIds: expected,
		})
	}
	if _, err := reorder([]string{third.Id, first.Id, second.Id}, []string{second.Id, first.Id, third.Id}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a reorder from an order the series is not in = %v, want failed_precondition", err)
	}
	res, err := reorder([]string{third.Id, first.Id, second.Id}, []string{first.Id, second.Id, third.Id})
	if err != nil {
		t.Fatalf("ReorderVolumes: %v", err)
	}
	got := make([]string, 0, len(res.Volumes))
	for _, volume := range res.Volumes {
		got = append(got, volume.Title)
	}
	if want := []string{"Volume 3", "Volume 1", "Volume 2"}; !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if count := v.volumeAuditCount(t, "volumes_reordered", "series", v.series.PublicID); count != 1 {
		t.Fatalf("audit volumes_reordered = %d, want 1", count)
	}
}

func TestDBCreateVolumeRefusesWhatAVolumeCannotBe(t *testing.T) {
	t.Parallel()

	v := newVolumeEnv(t)
	for name, req := range map[string]*publiraadminv1.CreateVolumeRequest{
		"no title":       {SeriesId: v.series.ID.String(), Title: "  ", Price: 900},
		"a long title":   {SeriesId: v.series.ID.String(), Title: strings.Repeat("a", 256), Price: 900},
		"a free volume":  {SeriesId: v.series.ID.String(), Title: "Free", Price: 0},
		"a series id":    {SeriesId: "not-an-id", Title: "Volume", Price: 900},
		"another series": {SeriesId: uuid.NewString(), Title: "Volume", Price: 900},
		"a price in a currency the tenant does not sell in": {SeriesId: v.series.ID.String(), Title: "Volume", Price: 900, Currency: "JPY"},
	} {
		req.Tenant = v.tenant.tenantContext()
		_, err := v.env.seriesClient().CreateVolume(v.ctx(), req)
		want := connect.CodeInvalidArgument
		switch name {
		case "another series":
			want = connect.CodeNotFound
		case "a price in a currency the tenant does not sell in":
			want = connect.CodeFailedPrecondition
		}
		if connect.CodeOf(err) != want {
			t.Errorf("%s = %v, want %s", name, err, want)
		}
	}
	if count := v.env.countRows(t, "SELECT count(*) FROM volumes WHERE tenant_id = $1", v.tenant.Tenant.ID); count != 0 {
		t.Fatalf("volumes stored = %d, want none", count)
	}
}

// A cover is cut into every ratio an eye-catch has, served from the volume
// cover route, and taken away again without touching the volume.
func TestDBAVolumeCoverIsUploadedAndRemoved(t *testing.T) {
	t.Parallel()

	v := newVolumeEnv(t)
	volume := v.create(t, "Volume 1", 900)

	uploaded, err := v.env.seriesClient().UploadVolumeCoverImage(v.ctx(), &publiraadminv1.UploadVolumeCoverImageRequest{
		Tenant:           v.tenant.tenantContext(),
		VolumeId:         volume.Id,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UploadVolumeCoverImage: %v", err)
	}
	if got := len(uploaded.Volume.CoverImageVariants); got != eyeCatchVariantCount || uploaded.Volume.CoverImageUpdatedAt == "" {
		t.Fatalf("cover = %d variants updated %q, want %d", got, uploaded.Volume.CoverImageUpdatedAt, eyeCatchVariantCount)
	}
	for _, variant := range uploaded.Volume.CoverImageVariants {
		if !strings.HasPrefix(variant.Url, "/images/volume-covers/") {
			t.Fatalf("variant url = %q, want it under /images/volume-covers/", variant.Url)
		}
	}

	removed, err := v.env.seriesClient().DeleteVolumeCoverImage(v.ctx(), &publiraadminv1.DeleteVolumeCoverImageRequest{
		Tenant:   v.tenant.tenantContext(),
		VolumeId: volume.Id,
	})
	if err != nil {
		t.Fatalf("DeleteVolumeCoverImage: %v", err)
	}
	if len(removed.Volume.CoverImageVariants) != 0 || removed.Volume.CoverImageUpdatedAt != "" || removed.Volume.Title != "Volume 1" {
		t.Fatalf("volume after removing its cover = %+v, want it as it was with no cover", removed.Volume)
	}
	// The cover's rows wait for the orphan image sweep.
	if count := v.env.countRows(t, "SELECT count(*) FROM volume_cover_images WHERE tenant_id = $1", v.tenant.Tenant.ID); count != 1 {
		t.Fatalf("cover rows = %d, want the one the sweep reclaims", count)
	}
}
