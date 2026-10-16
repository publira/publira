package testutil

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/publicid"
)

// CampaignBannerSeed describes a campaign banner to insert. A zero window is
// open now: it started an hour ago and ends in an hour.
type CampaignBannerSeed struct {
	PublicID     string
	LinkURL      string
	StartsAt     time.Time
	EndsAt       time.Time
	DisplayOrder int32
	Published    bool
	// WithoutImage leaves the banner pointing at no image, a state no admin
	// write leaves behind but the schema allows.
	WithoutImage bool
}

// CampaignBanner is a seeded campaign_banners row with the one image variant
// the seed stores for it: the landscape ratio at 800 pixels wide.
type CampaignBanner struct {
	ID        uuid.UUID
	PublicID  string
	ImageID   uuid.UUID
	VariantID uuid.UUID
	ObjectKey string
}

// SeedCampaignBanner inserts a banner, and unless the seed says otherwise its
// image with one variant, the way CreateCampaignBanner stores them.
func (e *PostgresEnv) SeedCampaignBanner(t *testing.T, tenantID uuid.UUID, seed CampaignBannerSeed) CampaignBanner {
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
	startsAt, endsAt := seed.StartsAt, seed.EndsAt
	if startsAt.IsZero() {
		startsAt = time.Now().Add(-time.Hour)
	}
	if endsAt.IsZero() {
		endsAt = time.Now().Add(time.Hour)
	}
	banner := CampaignBanner{ID: uuid.Must(uuid.NewV7()), PublicID: publicID}

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO campaign_banners (id, tenant_id, public_id, link_url, starts_at, ends_at, display_order, is_published)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, banner.ID, tenantID, publicID, defaultIfEmpty(seed.LinkURL, "/series"), startsAt, endsAt, seed.DisplayOrder, seed.Published); err != nil {
		t.Fatalf("insert campaign banner %s: %v", publicID, err)
	}
	if seed.WithoutImage {
		return banner
	}

	banner.ImageID = uuid.Must(uuid.NewV7())
	banner.VariantID = uuid.Must(uuid.NewV7())
	banner.ObjectKey = "tenants/seed/campaign-banners/" + publicID + "/" + banner.ImageID.String() + "-landscape_800w.jpg"
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO campaign_banner_images (id, tenant_id, campaign_banner_id)
		VALUES ($1, $2, $3)
	`, banner.ImageID, tenantID, banner.ID); err != nil {
		t.Fatalf("insert campaign banner image for %s: %v", publicID, err)
	}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO campaign_banner_image_variants (
			id, tenant_id, campaign_banner_image_id, label, variant_type,
			storage_provider, object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'landscape_800w', 'landscape', 's3', $4, 'image/jpeg', 1024, 800, 450)
	`, banner.VariantID, tenantID, banner.ImageID, banner.ObjectKey); err != nil {
		t.Fatalf("insert campaign banner image variant for %s: %v", publicID, err)
	}
	if _, err := e.DB.ExecContext(ctx,
		"UPDATE campaign_banners SET image_id = $2 WHERE id = $1", banner.ID, banner.ImageID,
	); err != nil {
		t.Fatalf("point campaign banner %s at its image: %v", publicID, err)
	}
	return banner
}
