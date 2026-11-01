package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The preview length is set on creation, changed with the price, and kept by
// a pricing change that does not name it, so a console that sends none
// leaves the preview its staff set. Each change is an episode_updated entry.
func TestDBEpisodePreviewPageCountIsStoredWithThePrice(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Priced Series"})

	created, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:           tenant.tenantContext(),
		SeriesId:         series.ID.String(),
		Title:            "Chapter One",
		Price:            300,
		PreviewPageCount: 2,
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if got := created.Episode.PreviewPageCount; got != 2 {
		t.Fatalf("created preview_page_count = %d, want 2", got)
	}
	episodePublicID := created.Episode.PublicId
	if got := getDBEpisode(t, env, tenant, series.PublicID, episodePublicID).Episode.PreviewPageCount; got != 2 {
		t.Fatalf("stored preview_page_count = %d, want 2", got)
	}

	five := int32(5)
	repriced, err := client.UpdateEpisodePricing(ctx, &publiraadminv1.UpdateEpisodePricingRequest{
		Tenant:           tenant.tenantContext(),
		EpisodeId:        created.Episode.Id,
		Price:            300,
		PreviewPageCount: &five,
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePricing with a preview: %v", err)
	}
	if got := repriced.Episode.PreviewPageCount; got != 5 {
		t.Fatalf("repriced preview_page_count = %d, want 5", got)
	}

	if _, err := client.UpdateEpisodePricing(ctx, &publiraadminv1.UpdateEpisodePricingRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: created.Episode.Id,
		Price:     500,
	}); err != nil {
		t.Fatalf("UpdateEpisodePricing without a preview: %v", err)
	}
	after := getDBEpisode(t, env, tenant, series.PublicID, episodePublicID).Episode
	if after.Price != 500 || after.PreviewPageCount != 5 {
		t.Fatalf("stored price %d and preview_page_count %d, want 500 and the 5 left as it was", after.Price, after.PreviewPageCount)
	}
	if got := env.episodeUpdatedEntries(t, tenant, episodePublicID); got != 2 {
		t.Fatalf("episode_updated entries = %d, want 2", got)
	}

	negative := int32(-1)
	if _, err := client.UpdateEpisodePricing(ctx, &publiraadminv1.UpdateEpisodePricingRequest{
		Tenant:           tenant.tenantContext(),
		EpisodeId:        created.Episode.Id,
		Price:            500,
		PreviewPageCount: &negative,
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodePricing with a negative preview error = %v, want invalid_argument", err)
	}
	if _, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:           tenant.tenantContext(),
		SeriesId:         series.ID.String(),
		Title:            "Chapter Two",
		PreviewPageCount: -1,
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateEpisode with a negative preview error = %v, want invalid_argument", err)
	}
	if got := getDBEpisode(t, env, tenant, series.PublicID, episodePublicID).Episode.PreviewPageCount; got != 5 {
		t.Fatalf("preview_page_count after the refused change = %d, want 5", got)
	}
}
