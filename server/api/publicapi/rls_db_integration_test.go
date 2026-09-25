package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// insufficientPrivilege is the SQLSTATE PostgreSQL raises when a row would break
// a row-level security policy.
const insufficientPrivilege = "42501"

// assertInsufficientPrivilege fails unless err is that refusal. A bare "some
// error came back" would be satisfied by a unique constraint the planted row
// happened to break, which says nothing about the policy under test.
func assertInsufficientPrivilege(t *testing.T, err error, what string) {
	t.Helper()

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilege {
		t.Fatalf("%s error = %v, want SQLSTATE %s", what, err, insufficientPrivilege)
	}
}

// These tests bypass the handlers and talk to PostgreSQL as publira_public
// directly. The RPC-level cases prove the handlers filter by tenant; these prove
// the database refuses to hand over another tenant's rows even when a query
// forgets to, which is the guarantee the public API leans on when a storefront
// request is answered on a shared connection pool.

func TestDBPublicRoleSeesOnlyTheScopedTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	theirs := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})

	env.withTenantConn(t, first.ID, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM series").Scan(&visible); err != nil {
			t.Fatalf("count series: %v", err)
		}
		if visible != 1 {
			t.Fatalf("visible series = %d, want only the one owned by tenant A", visible)
		}

		var title string
		err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", theirs.ID).Scan(&title)
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read tenant B series as tenant A: err = %v (title %q), want sql.ErrNoRows", err, title)
		}

		if err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", mine.ID).Scan(&title); err != nil {
			t.Fatalf("read own series: %v", err)
		}
		if title != "Tenant A Series" {
			t.Fatalf("own series title = %q, want Tenant A Series", title)
		}
	})
}

// publicDataTables are the tables a storefront request reads that hold tenant
// data. Each query is a literal so the count cannot be assembled from a name at
// runtime, and so a table added here without a policy is a failing test rather
// than a silent zero.
var publicDataTables = []struct {
	name  string
	count string
}{
	{name: "series", count: "SELECT count(*) FROM series"},
	{name: "episodes", count: "SELECT count(*) FROM episodes"},
	{name: "episode_listings", count: "SELECT count(*) FROM episode_listings"},
	// A view answers with its owner's rights unless it is declared
	// security_invoker, and this one's owner applies the migrations and
	// bypasses row-level security. It is in this list because that is the
	// difference between the catalog counting the tenant's free episodes and
	// counting everyone's.
	{name: "published_free_episodes", count: "SELECT count(*) FROM published_free_episodes"},
	// The surface views the catalog reads filter through. Like the one above,
	// they are views, and answer with their owner's rights unless declared
	// security_invoker.
	{name: "series_surfaces", count: "SELECT count(*) FROM series_surfaces"},
	{name: "episode_surfaces", count: "SELECT count(*) FROM episode_surfaces"},
	{name: "label_surfaces", count: "SELECT count(*) FROM label_surfaces"},
	// Where an episode may be bought, which the episode reads and the checkout
	// take from the tenant, the series, and the episode together.
	{name: "episode_purchase_availability", count: "SELECT count(*) FROM episode_purchase_availability"},
	// The purchases and access tickets that open a priced episode, which the
	// viewer and image-server read before they hand over a page.
	{name: "episode_content_grants", count: "SELECT count(*) FROM episode_content_grants"},
	// Every series row the catalog returns carries its credits, joined from
	// the creator, the credit, and the credit's role.
	{name: "creators", count: "SELECT count(*) FROM creators"},
	{name: "series_creators", count: "SELECT count(*) FROM series_creators"},
	{name: "creator_roles", count: "SELECT count(*) FROM creator_roles"},
	// Every episode carries its own credits, which the episode detail reads.
	{name: "episode_creators", count: "SELECT count(*) FROM episode_creators"},
	{name: "labels", count: "SELECT count(*) FROM labels"},
	// The rows behind every picture the storefront shows, each of which names
	// the object key a tenant's image is stored under.
	{name: "series_images", count: "SELECT count(*) FROM series_images"},
	{name: "series_image_variants", count: "SELECT count(*) FROM series_image_variants"},
	{name: "creator_images", count: "SELECT count(*) FROM creator_images"},
	{name: "creator_image_variants", count: "SELECT count(*) FROM creator_image_variants"},
	{name: "label_images", count: "SELECT count(*) FROM label_images"},
	{name: "label_image_variants", count: "SELECT count(*) FROM label_image_variants"},
	{name: "tenant_images", count: "SELECT count(*) FROM tenant_images"},
	{name: "tenant_image_variants", count: "SELECT count(*) FROM tenant_image_variants"},
	{name: "episode_images", count: "SELECT count(*) FROM episode_images"},
	// The tenant's own settings, which every storefront page reads to decide
	// how it looks and what it allows.
	{name: "tenant_config", count: "SELECT count(*) FROM tenant_config"},
	{name: "tenant_themes", count: "SELECT count(*) FROM tenant_themes"},
	{name: "tenant_community_limit_overrides", count: "SELECT count(*) FROM tenant_community_limit_overrides"},
	{name: "series_listings", count: "SELECT count(*) FROM series_listings"},
	{name: "episode_free_windows", count: "SELECT count(*) FROM episode_free_windows"},
	{name: "access_tickets", count: "SELECT count(*) FROM access_tickets"},
	{name: "content_ranking_snapshots", count: "SELECT count(*) FROM content_ranking_snapshots"},
	{name: "content_events", count: "SELECT count(*) FROM content_events"},
	{name: "genres", count: "SELECT count(*) FROM genres"},
	{name: "tags", count: "SELECT count(*) FROM tags"},
	{name: "series_genres", count: "SELECT count(*) FROM series_genres"},
	{name: "series_tags", count: "SELECT count(*) FROM series_tags"},
	{name: "episode_reads", count: "SELECT count(*) FROM episode_reads"},
	{name: "episode_reading_positions", count: "SELECT count(*) FROM episode_reading_positions"},
	// How the reader wants the viewer laid out, which the viewer reads on the
	// same connection as the position it opens at.
	{name: "user_viewer_preferences", count: "SELECT count(*) FROM user_viewer_preferences"},
	{name: "episode_ratings", count: "SELECT count(*) FROM episode_ratings"},
	// The public tally beside the reader's own ratings. It is the one of the
	// pair a storefront shows to everybody, so a missing policy here would hand
	// every tenant's rating counts to every other one.
	{name: "episode_rating_counts", count: "SELECT count(*) FROM episode_rating_counts"},
	// The series page reads all three of these to say what a series is rated:
	// the headcount behind the figure, the daily aggregates the figure itself
	// is derived from, and the tenant mean a series with few finished reads is
	// rated against.
	{name: "series_rating_counts", count: "SELECT count(*) FROM series_rating_counts"},
	{name: "content_daily_stats", count: "SELECT count(*) FROM content_daily_stats"},
	{name: "tenant_rating_totals", count: "SELECT count(*) FROM tenant_rating_totals"},
	{name: "users", count: "SELECT count(*) FROM users"},
	{name: "tenant_user_roles", count: "SELECT count(*) FROM tenant_user_roles"},
	// A sign-in link, a reset link, and an address change are each answered
	// by looking one of these up on the storefront's connection.
	{name: "user_email_verification_tokens", count: "SELECT count(*) FROM user_email_verification_tokens"},
	{name: "user_password_reset_tokens", count: "SELECT count(*) FROM user_password_reset_tokens"},
	{name: "user_email_change_tokens", count: "SELECT count(*) FROM user_email_change_tokens"},
	{name: "user_push_devices", count: "SELECT count(*) FROM user_push_devices"},
	{name: "series_follows", count: "SELECT count(*) FROM series_follows"},
	{name: "episode_follows", count: "SELECT count(*) FROM episode_follows"},
	{name: "creator_follows", count: "SELECT count(*) FROM creator_follows"},
	{name: "episode_comments", count: "SELECT count(*) FROM episode_comments"},
	{name: "episode_comment_reports", count: "SELECT count(*) FROM episode_comment_reports"},
	{name: "purchases", count: "SELECT count(*) FROM purchases"},
	// Written by the Stripe webhook rather than read by a page, and on the same
	// connection: a row names one tenant's payment intent and the money behind
	// it, so it needs the isolation purchases has.
	{name: "unapplied_stripe_refunds", count: "SELECT count(*) FROM unapplied_stripe_refunds"},
	// Opened by the app before the store's payment sheet, and naming the reader
	// and the price they agreed to.
	{name: "store_purchase_intents", count: "SELECT count(*) FROM store_purchase_intents"},
	// Written by the App Store notification on the same connection, naming one
	// tenant's store transaction.
	{name: "unapplied_store_refunds", count: "SELECT count(*) FROM unapplied_store_refunds"},
	{name: "pages", count: "SELECT count(*) FROM pages"},
	{name: "page_versions", count: "SELECT count(*) FROM page_versions"},
	// The page versions a reader agreed to at sign-up, which the storefront's
	// connection is what records.
	{name: "user_page_consents", count: "SELECT count(*) FROM user_page_consents"},
	// The tenant's own notices and one reader's state over them. The inbox is
	// answered on the storefront's connection, so a missing policy here would
	// put one tenant's notices — and one reader's read state — in another's.
	{name: "announcements", count: "SELECT count(*) FROM announcements"},
	{name: "announcement_reads", count: "SELECT count(*) FROM announcement_reads"},
	// Whether one reader takes mail. Nobody but that reader may read it, and
	// the settings screen writes it on this connection.
	{name: "user_notification_settings", count: "SELECT count(*) FROM user_notification_settings"},
	// One reader's bell and which of it they have seen, which the storefront
	// reads and marks on this connection.
	{name: "notifications", count: "SELECT count(*) FROM notifications"},
	{name: "notification_reads", count: "SELECT count(*) FROM notification_reads"},
	// The stored object keys of a tenant's episode pages. The viewer resolves a
	// page through these rows, so they are as much the tenant's as the episode
	// they decorate.
	{name: "episode_image_variants", count: "SELECT count(*) FROM episode_image_variants"},
	// What a reader wrote to the tenant through the contact form, which the
	// storefront's connection is what stores. A missing policy here would put
	// one tenant's messages, and the addresses on them, in another's inbox.
	{name: "contact_messages", count: "SELECT count(*) FROM contact_messages"},
	// The auth mails and the staff alerts a reader's comment raises are queued
	// here on the storefront's connection.
	{name: "outbox_events", count: "SELECT count(*) FROM outbox_events"},
}

// The fail-closed direction: a connection that never set app.current_tenant_id
// sees nothing, so a public code path that skips the tenant-scoping interceptor
// cannot leak one storefront's catalog into another's. Every table is seeded
// first — a count of zero over an empty table would hold whether or not the
// policy is there.
func TestDBPublicRoleSeesNothingWithoutTenantSetting(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	series := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	episode := env.PG.SeedEpisode(t, first.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0001",
		Title:    "Tenant A Episode",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	// A free episode as well as the priced one, so published_free_episodes has
	// a row of its own to withhold.
	env.PG.SeedEpisode(t, first.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0002",
		Title:    "Tenant A Free Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	seed := func(what, query string, args ...any) {
		t.Helper()
		if _, err := env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
			t.Fatalf("seed %s: %v", what, err)
		}
	}

	creator := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Aoi Sakura"})
	env.PG.SeedSeriesCreator(t, first.ID, series.ID, creator.ID, "")
	env.PG.SeedEpisodeCreator(t, first.ID, episode.ID, creator.ID, "")
	label := env.PG.SeedLabel(t, first.ID, testutil.LabelSeed{PublicID: "LABELA000001", Name: "Tenant A Label"})
	genre := env.PG.SeedGenre(t, first.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Fantasy"})
	env.PG.SeedSeriesGenre(t, first.ID, series.ID, genre.ID)
	tag := env.PG.SeedTag(t, first.ID, testutil.TagSeed{Name: "Swordplay"})
	env.PG.SeedSeriesTag(t, first.ID, series.ID, tag.ID)
	env.PG.SeedEpisodeFreeWindow(t, first.ID, episode.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	seriesImageID := uuid.Must(uuid.NewV7())
	seed("series image", "INSERT INTO series_images (id, tenant_id, series_id) VALUES ($1, $2, $3)", seriesImageID, first.ID, series.ID)
	seed("series image variant", `INSERT INTO series_image_variants
		(id, tenant_id, series_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'portrait-320', 'portrait', 's3', 'tenants/series.webp', 'image/webp', 1, 320, 480)`,
		uuid.Must(uuid.NewV7()), first.ID, seriesImageID)
	creatorImageID := uuid.Must(uuid.NewV7())
	seed("creator image", "INSERT INTO creator_images (id, tenant_id, creator_id) VALUES ($1, $2, $3)", creatorImageID, first.ID, creator.ID)
	seed("creator image variant", `INSERT INTO creator_image_variants
		(id, tenant_id, creator_image_id, label, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'avatar-160', 's3', 'tenants/creator.webp', 'image/webp', 1, 160, 160)`,
		uuid.Must(uuid.NewV7()), first.ID, creatorImageID)
	labelImageID := uuid.Must(uuid.NewV7())
	seed("label image", "INSERT INTO label_images (id, tenant_id, label_id) VALUES ($1, $2, $3)", labelImageID, first.ID, label.ID)
	seed("label image variant", `INSERT INTO label_image_variants
		(id, tenant_id, label_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'portrait-320', 'portrait', 's3', 'tenants/label.webp', 'image/webp', 1, 320, 480)`,
		uuid.Must(uuid.NewV7()), first.ID, labelImageID)
	tenantImageID := uuid.Must(uuid.NewV7())
	seed("tenant image", "INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)", tenantImageID, first.ID)
	seed("tenant image variant", `INSERT INTO tenant_image_variants
		(id, tenant_id, tenant_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'logo-1x', 'logo', 's3', 'tenants/logo.webp', 'image/webp', 1, 320, 320)`,
		uuid.Must(uuid.NewV7()), first.ID, tenantImageID)
	seed("tenant config", "INSERT INTO tenant_config (tenant_id) VALUES ($1)", first.ID)
	seed("tenant theme", "INSERT INTO tenant_themes (tenant_id) VALUES ($1)", first.ID)
	seed("community limit overrides", "INSERT INTO tenant_community_limit_overrides (tenant_id) VALUES ($1)", first.ID)
	seed("ranking snapshot", `INSERT INTO content_ranking_snapshots (id, tenant_id, ranking_key, period_start, period_end, entity_type, surface, items)
		VALUES ($1, $2, 'daily', CURRENT_DATE, CURRENT_DATE, 'series', 'web', '[]')`, uuid.Must(uuid.NewV7()), first.ID)

	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	// A reader holds no tenant role, so the role row comes from a staff account.
	env.PG.SeedTenantAdmin(t, first.ID, "ADMINA000001", "admin@tenant-a.example.com", "Admin")
	env.PG.SeedPurchase(t, first.ID, member.ID, episode.ID, episode.Price)
	seed("store purchase intent", "INSERT INTO store_purchase_intents (id, tenant_id, user_id, episode_id, price, product_id) VALUES ($1, $2, $3, $4, $5, $6)", uuid.Must(uuid.NewV7()), first.ID, member.ID, episode.ID, 500, "episode_500")
	seed("held store refund", "INSERT INTO unapplied_store_refunds (tenant_id, store, store_transaction_id) VALUES ($1, 'app_store', $2)", first.ID, "2000000000000001")
	seed("held refund", "INSERT INTO unapplied_stripe_refunds (tenant_id, stripe_payment_intent_id, refunded_amount) VALUES ($1, $2, $3)", first.ID, "pi_rls_held", 500)
	seed("access ticket", "INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id) VALUES ($1, $2, $3, $4, $5)", uuid.Must(uuid.NewV7()), first.ID, "TICKETA00001", episode.ID, member.ID)
	seed("content event", "INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, debounce_bucket) VALUES ($1, $2, 'series_view', $3, $4, 0)", uuid.Must(uuid.NewV7()), first.ID, member.ID, series.ID)
	seed("episode read", "INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)", uuid.Must(uuid.NewV7()), first.ID, member.ID, episode.ID)
	seed("reading position", "INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count) VALUES ($1, $2, $3, 1, 10)", first.ID, member.ID, episode.ID)
	seed("viewer preferences", "INSERT INTO user_viewer_preferences (tenant_id, user_id, wide_viewer_enabled) VALUES ($1, $2, true)", first.ID, member.ID)
	// The rating carries its own count rows: the triggers on episode_ratings
	// write the episode's tally and the series' one, so three tables are seeded
	// by this single insert.
	seed("episode rating", "INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score) VALUES ($1, $2, $3, 5)", first.ID, member.ID, episode.ID)
	seed("content daily stats", "INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, complete_count, rating_count, rating_sum) VALUES ($1, $2, CURRENT_DATE, 'series', $3, 1, 1, 5)", uuid.Must(uuid.NewV7()), first.ID, series.ID)
	seed("tenant rating totals", "INSERT INTO tenant_rating_totals (tenant_id, points, completed_reads) VALUES ($1, 5, 1)", first.ID)
	seed("email verification token", "INSERT INTO user_email_verification_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, 'verify-hash', NOW() + INTERVAL '1 hour')", uuid.Must(uuid.NewV7()), first.ID, member.ID)
	seed("password reset token", "INSERT INTO user_password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, 'reset-hash', NOW() + INTERVAL '1 hour')", uuid.Must(uuid.NewV7()), first.ID, member.ID)
	seed("email change token", `INSERT INTO user_email_change_tokens (id, tenant_id, user_id, current_email, new_email, current_email_token_hash, new_email_token_hash, expires_at)
		VALUES ($1, $2, $3, 'member@tenant-a.example.com', 'moved@tenant-a.example.com', 'current-hash', 'new-hash', NOW() + INTERVAL '1 hour')`,
		uuid.Must(uuid.NewV7()), first.ID, member.ID)
	seed("push device", "INSERT INTO user_push_devices (tenant_id, user_id, token, platform) VALUES ($1, $2, 'fcm-token-a', 'android')", first.ID, member.ID)
	seed("series follow", "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", first.ID, member.ID, series.ID)
	seed("episode follow", "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", first.ID, member.ID, episode.ID)
	seed("creator follow", "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", first.ID, member.ID, creator.ID)
	commentID := uuid.Must(uuid.NewV7())
	seed("comment", "INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, published_at) VALUES ($1, $2, 'COMMENTA0001', $3, $4, 'A comment about this episode.', 'published', NOW())", commentID, first.ID, episode.ID, member.ID)
	seed("comment report", "INSERT INTO episode_comment_reports (id, tenant_id, comment_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4, 'spam')", uuid.Must(uuid.NewV7()), first.ID, commentID, member.ID)
	privacy := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	seed("page consent", "INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)", first.ID, member.ID, privacy.VersionID)
	env.PG.SeedEpisodeImage(t, first.ID, episode.ID, 1)
	announcementID := insertAnnouncement(t, env, first.ID, uuid.NullUUID{}, "/series/SERIESA00001", "Tenant A Announcement")
	seed("announcement read", "INSERT INTO announcement_reads (announcement_id, tenant_id, user_id) VALUES ($1, $2, $3)", announcementID, first.ID, member.ID)
	seed("notification settings", "INSERT INTO user_notification_settings (tenant_id, user_id, email_notifications_enabled) VALUES ($1, $2, false)", first.ID, member.ID)
	bellID := insertTenantNotification(t, env, first.ID, member.ID, "episode_published", "episode:EPISODEA0001", `{"episode_id":"EPISODEA0001"}`)
	seed("notification read", "INSERT INTO notification_reads (notification_id, user_id, tenant_id) VALUES ($1, $2, $3)", bellID, member.ID, first.ID)
	seed("contact message", "INSERT INTO contact_messages (id, tenant_id, public_id, reply_to_email, body) VALUES ($1, $2, $3, $4, $5)", uuid.Must(uuid.NewV7()), first.ID, "CONTACTRLS01", "reader@example.test", "A question for Tenant A.")
	seed("outbox event", "INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key) VALUES ($1, $2, 'rls_probe', $3, 'rls:probe')", uuid.Must(uuid.NewV7()), first.ID, `{"tenant_id":"`+first.ID.String()+`"}`)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := env.PG.OpenPublicDB(t)
	for _, table := range publicDataTables {
		// The seed has to have landed, otherwise the assertion below is vacuous.
		if seeded := env.countRows(t, table.count); seeded == 0 {
			t.Fatalf("seeded %s rows = 0, want the fail-closed check to run against real rows", table.name)
		}

		var visible int
		if err := db.QueryRowContext(ctx, table.count).Scan(&visible); err != nil {
			t.Fatalf("count %s: %v", table.name, err)
		}
		if visible != 0 {
			t.Fatalf("%s rows visible without a tenant setting = %d, want 0", table.name, visible)
		}
	}
}

// The reader-owned pair — a read state over an announcement, and whether the
// reader takes mail — carries member isolation rather than tenant isolation, so
// one member of a tenant cannot read or rewrite another's. These two cases are
// the reading position pair's, over the tables this inbox writes.
func TestDBReaderStateIsMemberScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	owner := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "owner@tenant-a.example.com", "Owner")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")
	// The inserts below are aimed at a reader who has saved nothing, so neither
	// row collides with a primary key: a policy that stopped refusing the write
	// would be the only thing left that could refuse it.
	unsaved := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0003", "unsaved@tenant-a.example.com", "Unsaved")
	announcementID := insertAnnouncement(t, env, tenant.ID, uuid.NullUUID{}, "/series/SERIESA00001", "Tenant A Announcement")

	client := env.authClient()
	ownerToken := tokenFor(t, tenant, owner)
	if _, err := client.MarkAnnouncementAsRead(context.Background(), newBearerRequest(&publirav1.MarkAnnouncementAsReadRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: announcementID.String(),
	}, ownerToken)); err != nil {
		t.Fatalf("MarkAnnouncementAsRead as the owner: %v", err)
	}
	if _, err := client.UpdateNotificationSettings(context.Background(), newBearerRequest(&publirav1.UpdateNotificationSettingsRequest{
		Tenant:                    tenantContext(tenant),
		EmailNotificationsEnabled: false,
	}, ownerToken)); err != nil {
		t.Fatalf("UpdateNotificationSettings as the owner: %v", err)
	}

	otherToken := tokenFor(t, tenant, other)
	listed, err := client.ListAnnouncements(context.Background(), newBearerRequest(&publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
	}, otherToken))
	if err != nil {
		t.Fatalf("ListAnnouncements as the other member: %v", err)
	}
	if len(listed.Msg.Announcements) != 1 {
		t.Fatalf("announcements for the other member = %d, want 1", len(listed.Msg.Announcements))
	}
	if listed.Msg.Announcements[0].IsRead {
		t.Fatalf("announcement reads as read for the other member, want the owner's read state hidden")
	}
	settings, err := client.GetNotificationSettings(context.Background(), newBearerRequest(&publirav1.GetNotificationSettingsRequest{
		Tenant: tenantContext(tenant),
	}, otherToken))
	if err != nil {
		t.Fatalf("GetNotificationSettings as the other member: %v", err)
	}
	if !settings.Msg.EmailNotificationsEnabled {
		t.Fatalf("other member email_notifications_enabled = false, want the owner's setting hidden")
	}

	env.withTenantConn(t, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", other.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visibleReads int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM announcement_reads").Scan(&visibleReads); err != nil {
			t.Fatalf("count announcement_reads: %v", err)
		}
		if visibleReads != 0 {
			t.Fatalf("announcement_reads visible to the other member = %d, want 0", visibleReads)
		}
		var visibleSettings int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM user_notification_settings").Scan(&visibleSettings); err != nil {
			t.Fatalf("count user_notification_settings: %v", err)
		}
		if visibleSettings != 0 {
			t.Fatalf("user_notification_settings visible to the other member = %d, want 0", visibleSettings)
		}

		createdSettings, err := conn.ExecContext(ctx,
			"INSERT INTO user_notification_settings (tenant_id, user_id, email_notifications_enabled) VALUES ($1, $2, true)",
			tenant.ID, unsaved.ID,
		)
		if err == nil {
			t.Fatalf("write another member's notification settings succeeded: %#v", createdSettings)
		}
		// The SQLSTATE rather than any error, so a constraint the row happened to
		// break cannot stand in for the policy that has to refuse it.
		assertInsufficientPrivilege(t, err, "write another member's notification settings")
		createdRead, err := conn.ExecContext(ctx,
			"INSERT INTO announcement_reads (announcement_id, tenant_id, user_id) VALUES ($1, $2, $3)",
			announcementID, tenant.ID, unsaved.ID,
		)
		if err == nil {
			t.Fatalf("write another member's read state succeeded: %#v", createdRead)
		}
		assertInsufficientPrivilege(t, err, "write another member's read state")
		updated, err := conn.ExecContext(ctx,
			"UPDATE announcement_reads SET read_at = NOW() WHERE tenant_id = $1 AND user_id = $2",
			tenant.ID, owner.ID,
		)
		if err != nil {
			t.Fatalf("attempt to update another member's read state: %v", err)
		}
		if changed, err := updated.RowsAffected(); err != nil {
			t.Fatalf("other member update rows affected: %v", err)
		} else if changed != 0 {
			t.Fatalf("other member updated %d announcement reads, want 0", changed)
		}
	})
}

// The tenant half of the same policies, and the tenant isolation announcements
// itself gained. The other tenant's connection carries the same member id,
// which is the only thing member isolation would match on, so the tenant half
// is what has to hide every one of these rows.
func TestDBReaderStateIsTenantScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	announcementID := insertAnnouncement(t, env, tenant.ID, uuid.NullUUID{}, "/series/SERIESA00001", "Tenant A Announcement")

	client := env.authClient()
	token := tokenFor(t, tenant, member)
	if _, err := client.MarkAnnouncementAsRead(context.Background(), newBearerRequest(&publirav1.MarkAnnouncementAsReadRequest{
		Tenant:         tenantContext(tenant),
		AnnouncementId: announcementID.String(),
	}, token)); err != nil {
		t.Fatalf("MarkAnnouncementAsRead: %v", err)
	}
	if _, err := client.UpdateNotificationSettings(context.Background(), newBearerRequest(&publirav1.UpdateNotificationSettingsRequest{
		Tenant:                    tenantContext(tenant),
		EmailNotificationsEnabled: false,
	}, token)); err != nil {
		t.Fatalf("UpdateNotificationSettings: %v", err)
	}

	env.withTenantConn(t, otherTenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", member.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visibleAnnouncements int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM announcements").Scan(&visibleAnnouncements); err != nil {
			t.Fatalf("count announcements: %v", err)
		}
		if visibleAnnouncements != 0 {
			t.Fatalf("announcements visible to the other tenant = %d, want 0", visibleAnnouncements)
		}
		var visibleReads int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM announcement_reads").Scan(&visibleReads); err != nil {
			t.Fatalf("count announcement_reads: %v", err)
		}
		if visibleReads != 0 {
			t.Fatalf("announcement_reads visible to the other tenant = %d, want 0", visibleReads)
		}
		var visibleSettings int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM user_notification_settings").Scan(&visibleSettings); err != nil {
			t.Fatalf("count user_notification_settings: %v", err)
		}
		if visibleSettings != 0 {
			t.Fatalf("user_notification_settings visible to the other tenant = %d, want 0", visibleSettings)
		}
	})
}

// A bell row is one reader's, and so is the record that they have seen it. The
// write half of notifications stays tenant-wide, because an admin approving a
// comment or a reader whose report hides one files the row for somebody else;
// everything else about either table is the recipient's alone.
func TestDBNotificationsAreMemberScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	owner := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "owner@tenant-a.example.com", "Owner")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")
	// The writes below are aimed at a reader who has no bell row and no read
	// state yet, so no key can collide: a policy that stopped refusing the
	// write would be the only thing left that could refuse it.
	unsaved := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0003", "unsaved@tenant-a.example.com", "Unsaved")
	ownerBell := insertTenantNotification(t, env, tenant.ID, owner.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)

	client := env.notificationClient()
	if _, err := client.MarkNotificationAsRead(context.Background(), newBearerRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         tenantContext(tenant),
		NotificationId: ownerBell.String(),
	}, tokenFor(t, tenant, owner))); err != nil {
		t.Fatalf("MarkNotificationAsRead as the owner: %v", err)
	}

	env.withTenantConn(t, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", other.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visibleBells int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&visibleBells); err != nil {
			t.Fatalf("count notifications: %v", err)
		}
		if visibleBells != 0 {
			t.Fatalf("notifications visible to the other member = %d, want 0", visibleBells)
		}
		var visibleReads int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM notification_reads").Scan(&visibleReads); err != nil {
			t.Fatalf("count notification_reads: %v", err)
		}
		if visibleReads != 0 {
			t.Fatalf("notification_reads visible to the other member = %d, want 0", visibleReads)
		}

		createdRead, err := conn.ExecContext(ctx,
			"INSERT INTO notification_reads (notification_id, user_id, tenant_id) VALUES ($1, $2, $3)",
			ownerBell, unsaved.ID, tenant.ID,
		)
		if err == nil {
			t.Fatalf("write another member's read state succeeded: %#v", createdRead)
		}
		assertInsufficientPrivilege(t, err, "write another member's read state")

		for _, attempt := range []struct{ what, query string }{
			{"update another member's read state", "UPDATE notification_reads SET read_at = NOW() WHERE user_id = $1"},
			{"delete another member's read state", "DELETE FROM notification_reads WHERE user_id = $1"},
			{"update another member's bell row", "UPDATE notifications SET payload = '{}' WHERE user_id = $1"},
			{"delete another member's bell row", "DELETE FROM notifications WHERE user_id = $1"},
		} {
			result, err := conn.ExecContext(ctx, attempt.query, owner.ID)
			if err != nil {
				t.Fatalf("%s: %v", attempt.what, err)
			}
			if changed, err := result.RowsAffected(); err != nil {
				t.Fatalf("%s rows affected: %v", attempt.what, err)
			} else if changed != 0 {
				t.Fatalf("%s changed %d rows, want 0", attempt.what, changed)
			}
		}

		// Filing a row for another member is the delivery path, and it goes
		// through; reading it back is not the filer's to do.
		if _, err := conn.ExecContext(ctx,
			"INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key) VALUES ($1, $2, $3, 'comment_approved', 'comment:CMT001')",
			uuid.Must(uuid.NewV7()), tenant.ID, unsaved.ID,
		); err != nil {
			t.Fatalf("file a bell row for another member: %v", err)
		}
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&visibleBells); err != nil {
			t.Fatalf("count notifications after filing: %v", err)
		}
		if visibleBells != 0 {
			t.Fatalf("notifications visible to the filer = %d, want 0", visibleBells)
		}
	})

	if got := env.countRows(t, "SELECT count(*) FROM notification_reads WHERE user_id = $1", owner.ID); got != 1 {
		t.Fatalf("owner's notification_reads = %d, want the one they wrote left untouched", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM notifications WHERE user_id = $1 AND payload = '{\"episode_id\":\"E001\"}'::jsonb", owner.ID); got != 1 {
		t.Fatalf("owner's notifications = %d, want the one filed for them left untouched", got)
	}
}

// The tenant half of the same policies. The other tenant's connection carries
// the member's own id, which is all member isolation would match on, so the
// tenant half is what has to hide these rows and refuse these writes.
func TestDBNotificationsAreTenantScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	unsaved := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "unsaved@tenant-a.example.com", "Unsaved")
	bell := insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)
	unread := insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E002", `{"episode_id":"E002"}`)

	if _, err := env.notificationClient().MarkNotificationAsRead(context.Background(), newBearerRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         tenantContext(tenant),
		NotificationId: bell.String(),
	}, tokenFor(t, tenant, member))); err != nil {
		t.Fatalf("MarkNotificationAsRead: %v", err)
	}

	env.withTenantConn(t, otherTenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", member.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visibleBells int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&visibleBells); err != nil {
			t.Fatalf("count notifications: %v", err)
		}
		if visibleBells != 0 {
			t.Fatalf("notifications visible to the other tenant = %d, want 0", visibleBells)
		}
		var visibleReads int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM notification_reads").Scan(&visibleReads); err != nil {
			t.Fatalf("count notification_reads: %v", err)
		}
		if visibleReads != 0 {
			t.Fatalf("notification_reads visible to the other tenant = %d, want 0", visibleReads)
		}

		createdBell, err := conn.ExecContext(ctx,
			"INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key) VALUES ($1, $2, $3, 'comment_approved', 'comment:CMT001')",
			uuid.Must(uuid.NewV7()), tenant.ID, unsaved.ID,
		)
		if err == nil {
			t.Fatalf("file a bell row in another tenant succeeded: %#v", createdBell)
		}
		assertInsufficientPrivilege(t, err, "file a bell row in another tenant")

		// Aimed at the member's unread row, so no read state they already hold
		// can collide with it and the member half of the policy matches.
		createdRead, err := conn.ExecContext(ctx,
			"INSERT INTO notification_reads (notification_id, user_id, tenant_id) VALUES ($1, $2, $3)",
			unread, member.ID, tenant.ID,
		)
		if err == nil {
			t.Fatalf("write read state in another tenant succeeded: %#v", createdRead)
		}
		assertInsufficientPrivilege(t, err, "write read state in another tenant")
	})
}
