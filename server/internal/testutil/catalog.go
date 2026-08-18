package testutil

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/publicid"
)

// Episode listing statuses, as stored in episode_listings.status. A seed that
// leaves the status empty gets the column default, which is a draft.
const (
	EpisodeStatusDraft     = "draft"
	EpisodeStatusScheduled = "scheduled"
	EpisodeStatusPublished = "published"
)

// seedPastOffset is how far back a seed puts a publication time when the test
// did not name one. The public catalog queries compare against NOW(), so a
// timestamp taken at insert time would be a coin flip against clock skew.
const seedPastOffset = time.Hour

// Series is a seeded series row. The public catalog addresses a series by its
// public ID; the UUID is what the other seed helpers hang rows off.
type Series struct {
	ID       uuid.UUID
	PublicID string
	Title    string
}

// SeriesSeed describes one series to insert. The zero value is an unpublished
// series, which is the shape the public API has to hide.
type SeriesSeed struct {
	PublicID string
	Title    string
	Synopsis string
	// LabelID hangs the series off a seeded label. Zero means no label.
	LabelID uuid.UUID
	// Published maps to series.is_published. Published series are also the only
	// ones that get a published_at, which the catalog queries require.
	Published bool
	// PublishedAt defaults to an hour ago. Set it in the future to seed a series
	// whose publication has not come around yet.
	PublishedAt time.Time
}

// Episode is a seeded episode together with the listing that prices it.
type Episode struct {
	ID       uuid.UUID
	PublicID string
	Title    string
	Price    int32
}

// EpisodeSeed describes one episode and its episode_listings row. The zero
// value is a free draft episode appended to the end of the series.
type EpisodeSeed struct {
	PublicID string
	Title    string
	// OrderIndex defaults to the position after the episodes already seeded for
	// the series, the same way the admin API appends.
	OrderIndex int32
	Price      int32
	// Status is one of the EpisodeStatus constants; empty means draft.
	Status string
	// PublishedAt defaults to an hour ago for a published listing. Set it in the
	// future to seed a listing that is published but not yet readable.
	PublishedAt time.Time
	// ScheduledAt is only stored for a scheduled listing.
	ScheduledAt time.Time
}

// Page is a seeded page together with the version the seed created.
type Page struct {
	ID        uuid.UUID
	VersionID uuid.UUID
	Slug      string
	Title     string
}

// PageSeed describes one page and its single version. The zero value is a draft
// page: it has no published version, so the public API must not serve it.
type PageSeed struct {
	Slug            string
	Title           string
	ContentMarkdown string
	Published       bool
	DisplayInFooter bool
	// PublishedAt defaults to an hour ago. Set it in the future to seed a page
	// version that is published but not yet due.
	PublishedAt time.Time
}

// SeedSeries inserts a series and its series_listings row for the tenant.
// Uses the superuser connection, which is not subject to RLS.
func (e *PostgresEnv) SeedSeries(t *testing.T, tenantID uuid.UUID, seed SeriesSeed) Series {
	t.Helper()
	e.requireDB(t)

	publicID := defaultIfEmpty(seed.PublicID, "SERIES000001")
	title := defaultIfEmpty(seed.Title, "Series")
	seriesID := uuid.Must(uuid.NewV7())

	publishedAt := sql.NullTime{}
	if seed.Published {
		publishedAt = sql.NullTime{Time: seedTime(seed.PublishedAt), Valid: true}
	}

	ctx, cancel := seedContext()
	defer cancel()

	labelID := uuid.NullUUID{UUID: seed.LabelID, Valid: seed.LabelID != uuid.Nil}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO series (id, tenant_id, public_id, title, is_published, published_at, label_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, seriesID, tenantID, publicID, title, seed.Published, publishedAt, labelID); err != nil {
		t.Fatalf("insert series %s: %v", publicID, err)
	}

	synopsis := sql.NullString{String: seed.Synopsis, Valid: seed.Synopsis != ""}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO series_listings (series_id, tenant_id, synopsis, is_published, published_at)
		VALUES ($1, $2, $3, $4, $5)
	`, seriesID, tenantID, synopsis, seed.Published, publishedAt); err != nil {
		t.Fatalf("insert series_listings %s: %v", publicID, err)
	}

	return Series{ID: seriesID, PublicID: publicID, Title: title}
}

// Creator is a seeded creators row. The public catalog addresses an author by
// public ID; the UUID is what series_creators hangs off.
type Creator struct {
	ID       uuid.UUID
	PublicID string
	Name     string
}

// CreatorSeed describes one creator to insert. The zero value is a nameless
// unpublished author: they stay out of the public catalog until a published
// series credits them.
type CreatorSeed struct {
	PublicID    string
	Name        string
	ProfileText string
}

// Label is a seeded labels row. The public catalog addresses a label by its
// public ID; the UUID is what series.label_id hangs off.
type Label struct {
	ID       uuid.UUID
	PublicID string
	Name     string
}

// LabelSeed describes one label to insert. The zero value is a nameless label.
type LabelSeed struct {
	PublicID string
	Name     string
}

// SeedLabel inserts a label for the tenant. Uses the superuser connection,
// which is not subject to RLS.
func (e *PostgresEnv) SeedLabel(t *testing.T, tenantID uuid.UUID, seed LabelSeed) Label {
	t.Helper()
	e.requireDB(t)

	labelID := uuid.Must(uuid.NewV7())
	publicID := seed.PublicID
	if publicID == "" {
		var err error
		publicID, err = publicid.New()
		if err != nil {
			t.Fatalf("publicid.New: %v", err)
		}
	}
	name := defaultIfEmpty(seed.Name, "Label")

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO labels (id, tenant_id, public_id, name)
		VALUES ($1, $2, $3, $4)
	`, labelID, tenantID, publicID, name); err != nil {
		t.Fatalf("insert label %s: %v", publicID, err)
	}

	return Label{ID: labelID, PublicID: publicID, Name: name}
}

// SeedCreator inserts a creator for the tenant. Uses the superuser connection,
// which is not subject to RLS.
func (e *PostgresEnv) SeedCreator(t *testing.T, tenantID uuid.UUID, seed CreatorSeed) Creator {
	t.Helper()
	e.requireDB(t)

	creatorID := uuid.Must(uuid.NewV7())
	publicID := seed.PublicID
	if publicID == "" {
		var err error
		publicID, err = publicid.New()
		if err != nil {
			t.Fatalf("publicid.New: %v", err)
		}
	}
	name := defaultIfEmpty(seed.Name, "Creator")

	ctx, cancel := seedContext()
	defer cancel()

	profileText := sql.NullString{String: seed.ProfileText, Valid: seed.ProfileText != ""}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
		VALUES ($1, $2, $3, $4, $5)
	`, creatorID, tenantID, publicID, name, profileText); err != nil {
		t.Fatalf("insert creator %s: %v", publicID, err)
	}

	return Creator{ID: creatorID, PublicID: publicID, Name: name}
}

// SeedSeriesCreator credits the creator on the series. Role defaults to writer.
func (e *PostgresEnv) SeedSeriesCreator(t *testing.T, tenantID, seriesID, creatorID uuid.UUID, role string) {
	t.Helper()
	e.requireDB(t)

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO series_creators (series_id, creator_id, role, display_order, tenant_id)
		VALUES ($1, $2, $3, 0, $4)
	`, seriesID, creatorID, defaultIfEmpty(role, "writer"), tenantID); err != nil {
		t.Fatalf("insert series_creators series=%s creator=%s: %v", seriesID, creatorID, err)
	}
}

// SeedEpisode inserts an episode of the series and the episode_listings row that
// carries its price and publication state.
func (e *PostgresEnv) SeedEpisode(t *testing.T, tenantID, seriesID uuid.UUID, seed EpisodeSeed) Episode {
	t.Helper()
	e.requireDB(t)

	publicID := defaultIfEmpty(seed.PublicID, "EPISODE00001")
	title := defaultIfEmpty(seed.Title, "Episode")
	status := defaultIfEmpty(seed.Status, EpisodeStatusDraft)
	episodeID := uuid.Must(uuid.NewV7())

	ctx, cancel := seedContext()
	defer cancel()

	orderIndex := seed.OrderIndex
	if orderIndex == 0 {
		// Past the last episode rather than past the count, so appending still
		// lands at the end when earlier seeds picked their own order indexes.
		var lastOrderIndex int32
		if err := e.DB.QueryRowContext(ctx,
			"SELECT COALESCE(max(order_index), 0) FROM episodes WHERE series_id = $1", seriesID,
		).Scan(&lastOrderIndex); err != nil {
			t.Fatalf("last order_index of series %s: %v", seriesID, err)
		}
		orderIndex = lastOrderIndex + 1
	}

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO episodes (id, tenant_id, series_id, public_id, title, order_index)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, episodeID, tenantID, seriesID, publicID, title, orderIndex); err != nil {
		t.Fatalf("insert episode %s: %v", publicID, err)
	}

	publishedAt := sql.NullTime{}
	if status == EpisodeStatusPublished {
		publishedAt = sql.NullTime{Time: seedTime(seed.PublishedAt), Valid: true}
	}
	scheduledAt := sql.NullTime{}
	if status == EpisodeStatusScheduled {
		scheduledAt = sql.NullTime{Time: seed.ScheduledAt, Valid: !seed.ScheduledAt.IsZero()}
	}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO episode_listings (episode_id, tenant_id, price, status, scheduled_at, published_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, episodeID, tenantID, seed.Price, status, scheduledAt, publishedAt); err != nil {
		t.Fatalf("insert episode_listings %s: %v", publicID, err)
	}

	return Episode{ID: episodeID, PublicID: publicID, Title: title, Price: seed.Price}
}

// SeedEpisodeImage inserts one page image of the episode together with a single
// variant, which is what the image listing query joins against. Returns the
// episode_images id.
func (e *PostgresEnv) SeedEpisodeImage(t *testing.T, tenantID, episodeID uuid.UUID, displayOrder int32) uuid.UUID {
	t.Helper()
	e.requireDB(t)

	imageID := uuid.Must(uuid.NewV7())

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
		VALUES ($1, $2, $3, $4)
	`, imageID, tenantID, episodeID, displayOrder); err != nil {
		t.Fatalf("insert episode_images for episode %s: %v", episodeID, err)
	}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO episode_image_variants (
			id, episode_image_id, label, storage_provider, object_key,
			content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, 'original', 'local', $3, 'image/webp', 1024, 1200, 1800)
	`, uuid.Must(uuid.NewV7()), imageID, "episodes/"+episodeID.String()+"/"+imageID.String()); err != nil {
		t.Fatalf("insert episode_image_variants for image %s: %v", imageID, err)
	}

	return imageID
}

// SeedPurchase grants the user permanent access to the episode, the entitlement
// the public API checks before it hands out episode images.
func (e *PostgresEnv) SeedPurchase(t *testing.T, tenantID, userID, episodeID uuid.UUID, price int32) {
	t.Helper()
	e.requireDB(t)

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase)
		VALUES ($1, $2, $3, $4, $5)
	`, uuid.Must(uuid.NewV7()), tenantID, userID, episodeID, price); err != nil {
		t.Fatalf("insert purchase of episode %s: %v", episodeID, err)
	}
}

// SeedPage inserts a page and one version of it. A published seed also points
// pages.published_version_id at that version, which is the join the public page
// queries rely on; a draft leaves it null the way an unpublished page is stored.
func (e *PostgresEnv) SeedPage(t *testing.T, tenantID uuid.UUID, seed PageSeed) Page {
	t.Helper()
	e.requireDB(t)

	slug := normalizeSeedSlug(defaultIfEmpty(seed.Slug, "page"))
	title := defaultIfEmpty(seed.Title, "Page")
	pageID := uuid.Must(uuid.NewV7())
	versionID := uuid.Must(uuid.NewV7())

	status := "draft"
	publishedAt := sql.NullTime{}
	if seed.Published {
		status = "published"
		publishedAt = sql.NullTime{Time: seedTime(seed.PublishedAt), Valid: true}
	}

	ctx, cancel := seedContext()
	defer cancel()

	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO pages (id, tenant_id, slug, title, display_in_footer)
		VALUES ($1, $2, $3, $4, $5)
	`, pageID, tenantID, slug, title, seed.DisplayInFooter); err != nil {
		t.Fatalf("insert page %s: %v", slug, err)
	}
	if _, err := e.DB.ExecContext(ctx, `
		INSERT INTO page_versions (
			id, tenant_id, page_id, version_number, content_markdown, status, published_at
		)
		VALUES ($1, $2, $3, 1, $4, $5, $6)
	`, versionID, tenantID, pageID, seed.ContentMarkdown, status, publishedAt); err != nil {
		t.Fatalf("insert page_versions for %s: %v", slug, err)
	}
	if seed.Published {
		if _, err := e.DB.ExecContext(ctx,
			"UPDATE pages SET published_version_id = $1 WHERE id = $2", versionID, pageID,
		); err != nil {
			t.Fatalf("point page %s at its published version: %v", slug, err)
		}
	}

	return Page{ID: pageID, VersionID: versionID, Slug: slug, Title: title}
}

// normalizeSeedSlug stores a slug the way the admin API does, so a seeded page
// is reachable through the same lookups the console would produce.
func normalizeSeedSlug(slug string) string {
	return "/" + strings.Trim(strings.TrimSpace(slug), "/")
}

// seedTime resolves a seed timestamp, defaulting to safely in the past so the
// row is already visible to queries that compare against NOW().
func seedTime(at time.Time) time.Time {
	if at.IsZero() {
		return time.Now().Add(-seedPastOffset)
	}
	return at
}

func seedContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}

func (e *PostgresEnv) requireDB(t *testing.T) {
	t.Helper()
	if e == nil || e.DB == nil {
		t.Fatal("postgres env db is nil; call Reset first if needed")
	}
}
