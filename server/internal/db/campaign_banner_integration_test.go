package dbtest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

type dueCampaignBanner struct {
	id       uuid.UUID
	startDue bool
	endDue   bool
}

func dueCampaignBanners(t *testing.T, ctx context.Context, q *dbmodels.Queries) []dueCampaignBanner {
	t.Helper()
	rows, err := q.ListCampaignBannerBoundariesDue(ctx)
	if err != nil {
		t.Fatalf("ListCampaignBannerBoundariesDue: %v", err)
	}
	due := make([]dueCampaignBanner, 0, len(rows))
	for _, row := range rows {
		due = append(due, dueCampaignBanner{id: row.ID, startDue: row.StartDue.Bool, endDue: row.EndDue.Bool})
	}
	return due
}

func TestListCampaignBannerBoundariesDue(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC()

	opened := pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{Published: true})
	over := pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		Published: true, StartsAt: now.Add(-2 * time.Hour), EndsAt: now.Add(-time.Hour),
	})
	pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		Published: true, StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour),
	})
	// An unpublished banner is in nothing a site cached, so none of its
	// boundaries is owed a drop.
	pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{Published: false})

	want := []dueCampaignBanner{
		{id: over.ID, startDue: true, endDue: true},
		{id: opened.ID, startDue: true, endDue: false},
	}
	if got := dueCampaignBanners(t, ctx, q); !slices.Equal(got, want) {
		t.Fatalf("due banners = %v, want %v", got, want)
	}

	for _, id := range []uuid.UUID{opened.ID, over.ID} {
		if err := q.MarkCampaignBannerStartRevalidated(ctx, id); err != nil {
			t.Fatalf("MarkCampaignBannerStartRevalidated: %v", err)
		}
	}
	if err := q.MarkCampaignBannerEndRevalidated(ctx, over.ID); err != nil {
		t.Fatalf("MarkCampaignBannerEndRevalidated: %v", err)
	}
	if got := dueCampaignBanners(t, ctx, q); len(got) != 0 {
		t.Fatalf("due banners after marking = %v, want none until the next boundary passes", got)
	}
}

// The marks re-check the instant, so a banner rescheduled ahead between the
// listing and the mark keeps its drop owed rather than losing it.
func TestMarkCampaignBannerBoundaryLeavesABoundaryStillAhead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC()
	ahead := pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{
		Published: true, StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour),
	})

	if err := q.MarkCampaignBannerStartRevalidated(ctx, ahead.ID); err != nil {
		t.Fatalf("MarkCampaignBannerStartRevalidated: %v", err)
	}
	if err := q.MarkCampaignBannerEndRevalidated(ctx, ahead.ID); err != nil {
		t.Fatalf("MarkCampaignBannerEndRevalidated: %v", err)
	}
	var marked int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM campaign_banners WHERE id = $1 AND (start_revalidated_at IS NOT NULL OR end_revalidated_at IS NOT NULL)", ahead.ID,
	).Scan(&marked); err != nil {
		t.Fatalf("read campaign banner: %v", err)
	}
	if marked != 0 {
		t.Fatal("a boundary still ahead was marked applied, want it left owed")
	}
}

// Deleting a banner takes its images and their variants with it, so nothing
// the orphan sweep reads is left naming its objects.
func TestDeletingACampaignBannerCascadesToItsImages(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	banner := pg.SeedCampaignBanner(t, tenant.ID, testutil.CampaignBannerSeed{Published: true})

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM campaign_banners WHERE id = $1", banner.ID); err != nil {
		t.Fatalf("delete campaign banner: %v", err)
	}
	for _, table := range []string{"campaign_banner_images", "campaign_banner_image_variants"} {
		var rows int
		if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE tenant_id = $1", tenant.ID).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if rows != 0 {
			t.Fatalf("%s rows after deleting the banner = %d, want 0", table, rows)
		}
	}
}
