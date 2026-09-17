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
	// The catalog reads a credit through its role, so the role list is on the
	// storefront's read path as much as the genre list is.
	{name: "creator_roles", count: "SELECT count(*) FROM creator_roles"},
	// Every episode carries its own credits, which the episode detail reads.
	{name: "episode_creators", count: "SELECT count(*) FROM episode_creators"},
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
	{name: "purchases", count: "SELECT count(*) FROM purchases"},
	// Written by the Stripe webhook rather than read by a page, and on the same
	// connection: a row names one tenant's payment intent and the money behind
	// it, so it needs the isolation purchases has.
	{name: "unapplied_stripe_refunds", count: "SELECT count(*) FROM unapplied_stripe_refunds"},
	{name: "pages", count: "SELECT count(*) FROM pages"},
	{name: "page_versions", count: "SELECT count(*) FROM page_versions"},
	// The tenant's own notices and one reader's state over them. The inbox is
	// answered on the storefront's connection, so a missing policy here would
	// put one tenant's notices — and one reader's read state — in another's.
	{name: "announcements", count: "SELECT count(*) FROM announcements"},
	{name: "announcement_reads", count: "SELECT count(*) FROM announcement_reads"},
	// Whether one reader takes mail. Nobody but that reader may read it, and
	// the settings screen writes it on this connection.
	{name: "user_notification_settings", count: "SELECT count(*) FROM user_notification_settings"},
	// The stored object keys of a tenant's episode pages. The viewer resolves a
	// page through these rows, so they are as much the tenant's as the episode
	// they decorate.
	{name: "episode_image_variants", count: "SELECT count(*) FROM episode_image_variants"},
	// What a reader wrote to the tenant through the contact form, which the
	// storefront's connection is what stores. A missing policy here would put
	// one tenant's messages, and the addresses on them, in another's inbox.
	{name: "contact_messages", count: "SELECT count(*) FROM contact_messages"},
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
	creator := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Aoi Sakura"})
	env.PG.SeedEpisodeCreator(t, first.ID, episode.ID, creator.ID, "")
	genre := env.PG.SeedGenre(t, first.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Fantasy"})
	env.PG.SeedSeriesGenre(t, first.ID, series.ID, genre.ID)
	tag := env.PG.SeedTag(t, first.ID, testutil.TagSeed{Name: "Swordplay"})
	env.PG.SeedSeriesTag(t, first.ID, series.ID, tag.ID)
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedPurchase(t, first.ID, member.ID, episode.ID, episode.Price)
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO unapplied_stripe_refunds (tenant_id, stripe_payment_intent_id, refunded_amount) VALUES ($1, $2, $3)", first.ID, "pi_rls_held", 500); err != nil {
		t.Fatalf("seed held refund: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)", uuid.Must(uuid.NewV7()), first.ID, member.ID, episode.ID); err != nil {
		t.Fatalf("seed episode read: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count) VALUES ($1, $2, $3, 1, 10)", first.ID, member.ID, episode.ID); err != nil {
		t.Fatalf("seed reading position: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO user_viewer_preferences (tenant_id, user_id, wide_viewer_enabled) VALUES ($1, $2, true)", first.ID, member.ID); err != nil {
		t.Fatalf("seed viewer preferences: %v", err)
	}
	// The rating carries its own count rows: the triggers on episode_ratings
	// write the episode's tally and the series' one, so three tables are seeded
	// by this single insert.
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score) VALUES ($1, $2, $3, 5)", first.ID, member.ID, episode.ID); err != nil {
		t.Fatalf("seed episode rating: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, complete_count, rating_count, rating_sum) VALUES ($1, $2, CURRENT_DATE, 'series', $3, 1, 1, 5)", uuid.Must(uuid.NewV7()), first.ID, series.ID); err != nil {
		t.Fatalf("seed content daily stats: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO tenant_rating_totals (tenant_id, points, completed_reads) VALUES ($1, 5, 1)", first.ID); err != nil {
		t.Fatalf("seed tenant rating totals: %v", err)
	}
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	env.PG.SeedEpisodeImage(t, first.ID, episode.ID, 1)
	announcementID := insertAnnouncement(t, env, first.ID, uuid.NullUUID{}, "/series/SERIESA00001", "Tenant A Announcement")
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO announcement_reads (announcement_id, tenant_id, user_id) VALUES ($1, $2, $3)", announcementID, first.ID, member.ID); err != nil {
		t.Fatalf("seed announcement read: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO user_notification_settings (tenant_id, user_id, email_notifications_enabled) VALUES ($1, $2, false)", first.ID, member.ID); err != nil {
		t.Fatalf("seed notification settings: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO contact_messages (id, tenant_id, public_id, reply_to_email, body) VALUES ($1, $2, $3, $4, $5)", uuid.Must(uuid.NewV7()), first.ID, "CONTACTRLS01", "reader@example.test", "A question for Tenant A."); err != nil {
		t.Fatalf("seed contact message: %v", err)
	}

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
