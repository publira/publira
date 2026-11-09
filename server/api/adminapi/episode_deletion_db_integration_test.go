package adminapi

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// episodeDeletionFixture is a tenant with a published series, a reader, and a
// counter for the public IDs the rows a test seeds need.
type episodeDeletionFixture struct {
	env    *adminDBEnv
	admin  adminDBTenant
	reader testutil.TenantUser
	series testutil.Series
	next   int
}

func newEpisodeDeletionFixture(t *testing.T) *episodeDeletionFixture {
	t.Helper()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &episodeDeletionFixture{
		env:    env,
		admin:  admin,
		reader: env.PG.SeedEndUser(t, admin.Tenant.ID, "READER01", "reader@example.com", "Reader"),
		series: env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A", Published: true}),
	}
}

// publicID answers a public ID no other row of the test has.
func (f *episodeDeletionFixture) publicID(prefix string) string {
	f.next++
	return fmt.Sprintf("%s%06d", prefix, f.next)
}

func (f *episodeDeletionFixture) episode(t *testing.T, title string) testutil.Episode {
	t.Helper()
	return f.env.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: f.publicID("EPDEL"),
		Title:    title,
		Price:    120,
		Status:   testutil.EpisodeStatusPublished,
	})
}

func (f *episodeDeletionFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *episodeDeletionFixture) delete(as adminDBTenant, episode testutil.Episode) error {
	_, err := f.env.seriesClient().DeleteEpisode(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.DeleteEpisodeRequest{
		Tenant:    as.tenantContext(),
		EpisodeId: episode.ID.String(),
	})
	return err
}

// purchase seeds a purchase of the episode as the reader and answers its ID.
// columns and values add to the ones every purchase has.
func (f *episodeDeletionFixture) purchase(t *testing.T, episodeID uuid.UUID, columns string, values ...any) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	args := append([]any{id, f.admin.Tenant.ID, f.reader.ID, episodeID, f.env.PG.TenantCurrency(t, f.admin.Tenant.ID)}, values...)
	placeholders := ""
	for i := range values {
		placeholders += fmt.Sprintf(", $%d", i+6)
	}
	f.exec(t, "INSERT INTO purchases (id, tenant_id, user_id, episode_id, currency, price_at_purchase"+columns+") VALUES ($1, $2, $3, $4, $5, 120"+placeholders+")", args...)
	return id
}

// An episode nothing has to be kept for goes with everything that is its alone,
// leaves its series' other episodes, its volumes never on sale, and the rest
// of an expired bundle as they were, and is named in the audit log by its
// title.
func TestDBDeleteEpisodeTakesWhatIsItsOwn(t *testing.T) {
	t.Parallel()

	f := newEpisodeDeletionFixture(t)
	tenantID := f.admin.Tenant.ID
	episode := f.episode(t, "Chapter to delete")
	kept := f.episode(t, "Chapter to keep")
	creator := f.env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "CREATOR01", Name: "Author A"})

	f.env.PG.SeedEpisodeTranslation(t, tenantID, episode.ID, "en", "Chapter in English")
	f.env.PG.SeedEpisodeImage(t, tenantID, episode.ID, 0)
	f.env.PG.SeedEpisodeCreator(t, tenantID, episode.ID, creator.ID, "")
	f.env.PG.SeedEpisodeFreeWindow(t, tenantID, episode.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	f.env.PG.SeedEpisodeCampaignPrice(t, tenantID, episode.ID, 60, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	reviewID := uuid.Must(uuid.NewV7())
	f.exec(t, "INSERT INTO episode_reviews (id, tenant_id, episode_id, decision, decided_at, comment) VALUES ($1, $2, $3, 'returned', now(), 'Fix page 3')", reviewID, tenantID, episode.ID)

	commentID := uuid.Must(uuid.NewV7())
	commentPublicID := f.publicID("CMNT")
	f.exec(t, "INSERT INTO episode_comments (id, tenant_id, public_id, episode_id, user_id, body, status, published_at) VALUES ($1, $2, $3, $4, $5, 'Great chapter', 'published', now())",
		commentID, tenantID, commentPublicID, episode.ID, f.reader.ID)
	f.exec(t, "INSERT INTO episode_comment_reports (id, tenant_id, comment_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4, 'spam')",
		uuid.Must(uuid.NewV7()), tenantID, commentID, f.admin.User.ID)
	f.exec(t, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", tenantID, f.reader.ID, episode.ID)
	f.exec(t, "INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score) VALUES ($1, $2, $3, 5)", tenantID, f.reader.ID, episode.ID)
	f.exec(t, "INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count) VALUES ($1, $2, $3, 2, 10)", tenantID, f.reader.ID, episode.ID)
	f.exec(t, "INSERT INTO episode_reads (id, tenant_id, user_id, episode_id) VALUES ($1, $2, $3, $4)", uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, episode.ID)
	for _, target := range []uuid.UUID{episode.ID, kept.ID} {
		f.exec(t, "INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, episode_id) VALUES ($1, $2, 'episode_complete', $3, $4, $5)",
			uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, f.series.ID, target)
	}

	draft := f.env.PG.SeedVolume(t, tenantID, f.series.ID, testutil.VolumeSeed{PublicID: "VOLUME01", Title: "Volume 1", OrderIndex: 1, Price: 200, EpisodeIDs: []uuid.UUID{episode.ID, kept.ID}})

	bundleID := uuid.Must(uuid.NewV7())
	f.exec(t, "INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, price, expired_provider, expired_provider_checkout_id, expired_at) VALUES ($1, $2, $3, $4, 'bundle-expired', 240, 'stripe', 'cs_expired', now())", bundleID, tenantID, f.series.ID, f.reader.ID)
	for i, target := range []uuid.UUID{episode.ID, kept.ID} {
		f.exec(t, "INSERT INTO series_bundle_episodes (tenant_id, series_bundle_id, episode_id, position, list_price, price) VALUES ($1, $2, $3, $4, 120, 120)", tenantID, bundleID, target, i)
	}
	f.exec(t, "INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id) VALUES ($1, $2, 'CHAPTER10', 'percent', 10, 'episode', $3)",
		uuid.Must(uuid.NewV7()), tenantID, episode.ID)

	syncsBefore := f.env.seriesSyncsQueued(t, f.series.ID.String())
	if err := f.delete(f.admin, episode); err != nil {
		t.Fatalf("DeleteEpisode: %v", err)
	}

	for _, table := range []string{
		"episodes WHERE id = $1",
		"episode_listings WHERE episode_id = $1",
		"episode_translations WHERE episode_id = $1",
		"episode_images WHERE episode_id = $1",
		"episode_creators WHERE episode_id = $1",
		"episode_free_windows WHERE episode_id = $1",
		"episode_campaign_prices WHERE episode_id = $1",
		"episode_reviews WHERE episode_id = $1",
		"episode_comments WHERE episode_id = $1",
		"episode_follows WHERE episode_id = $1",
		"episode_ratings WHERE episode_id = $1",
		"episode_rating_counts WHERE episode_id = $1",
		"episode_reading_positions WHERE episode_id = $1",
		"episode_reads WHERE episode_id = $1",
		"content_events WHERE episode_id = $1",
		"volume_episodes WHERE episode_id = $1",
		"series_bundle_episodes WHERE episode_id = $1",
		"promotion_codes WHERE target_id = $1",
	} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table, episode.ID); got != 0 {
			t.Errorf("rows left in %s = %d, want 0", table, got)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM episode_comment_reports WHERE comment_id = $1", commentID); got != 0 {
		t.Errorf("comment reports left = %d, want 0", got)
	}

	// What else the series had is as it was.
	if got := f.env.countRows(t, "SELECT count(*) FROM episodes WHERE id = $1", kept.ID); got != 1 {
		t.Errorf("the other episode is gone")
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM content_events WHERE episode_id = $1", kept.ID); got != 1 {
		t.Errorf("the other episode's content events = %d, want 1", got)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM volume_episodes WHERE volume_id = $1", draft.ID); got != 1 {
		t.Errorf("episodes left in the volume never on sale = %d, want 1", got)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM series_bundle_episodes WHERE series_bundle_id = $1", bundleID); got != 1 {
		t.Errorf("episodes left in the expired bundle = %d, want 1", got)
	}

	// It leaves the search index as an unpublished one does.
	if got := f.env.seriesSyncsQueued(t, f.series.ID.String()) - syncsBefore; got != 1 {
		t.Errorf("series search syncs queued = %d, want 1", got)
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'episode_deleted' AND target_type = 'episode' AND target_id = $2 AND reason = $3",
		tenantID, episode.PublicID, episode.Title,
	); got != 1 {
		t.Errorf("audit entries naming the deletion = %d, want 1", got)
	}

	// A request delivered again finds nothing to delete.
	if err := f.delete(f.admin, episode); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteEpisode again = %v, want not_found", err)
	}
}

// An episode something that has to be kept refers to stays, and the refusal
// names the first such reference in the order the RPC documents.
func TestDBDeleteEpisodeRefusesWhatHasToBeKept(t *testing.T) {
	t.Parallel()

	f := newEpisodeDeletionFixture(t)
	tenantID := f.admin.Tenant.ID
	statement := func(period string) uuid.UUID {
		id := uuid.Must(uuid.NewV7())
		f.exec(t, `INSERT INTO royalty_statements (id, tenant_id, period, time_zone, total_gross, total_refunded, total_payout, starts_at, ends_at, currency, total_adjustment)
			VALUES ($1, $2, $3::date, 'UTC', 120, 0, 60, $3::date, $3::date + interval '1 month', $4, 0)`,
			id, tenantID, period, f.env.PG.TenantCurrency(t, tenantID))
		return id
	}

	cases := []struct {
		name string
		seed func(t *testing.T, episode testutil.Episode)
		want string
	}{
		{"a purchase", func(t *testing.T, episode testutil.Episode) {
			f.env.PG.SeedPurchase(t, tenantID, f.reader.ID, episode.ID, 120)
		}, rpcerrors.ReasonEpisodePurchased},
		{"a rental", func(t *testing.T, episode testutil.Episode) {
			f.purchase(t, episode.ID, ", kind, expires_at", "rental", time.Now().Add(-time.Hour))
		}, rpcerrors.ReasonEpisodePurchased},
		{"a tip", func(t *testing.T, episode testutil.Episode) {
			f.purchase(t, episode.ID, ", kind", "tip")
		}, rpcerrors.ReasonEpisodePurchased},
		{"a volume bought with it", func(t *testing.T, episode testutil.Episode) {
			volume := f.env.PG.SeedVolume(t, tenantID, f.series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Bought volume", OrderIndex: int32(f.next), Price: 100, Published: true, EpisodeIDs: []uuid.UUID{episode.ID}})
			purchaseID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO purchases (id, tenant_id, user_id, volume_id, price_at_purchase, currency) VALUES ($1, $2, $3, $4, 100, $5)",
				purchaseID, tenantID, f.reader.ID, volume.ID, f.env.PG.TenantCurrency(t, tenantID))
			f.exec(t, "INSERT INTO volume_purchase_episodes (tenant_id, purchase_id, episode_id, position, list_price, price) VALUES ($1, $2, $3, 0, 120, 100)", tenantID, purchaseID, episode.ID)
		}, rpcerrors.ReasonEpisodePurchased},
		{"a bundle bought with it", func(t *testing.T, episode testutil.Episode) {
			bundleID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, price) VALUES ($1, $2, $3, $4, $5, 120)", bundleID, tenantID, f.series.ID, f.reader.ID, f.publicID("bundle-"))
			f.exec(t, "INSERT INTO series_bundle_episodes (tenant_id, series_bundle_id, episode_id, position, list_price, price) VALUES ($1, $2, $3, 0, 120, 120)", tenantID, bundleID, episode.ID)
			f.exec(t, "INSERT INTO purchases (id, tenant_id, user_id, series_bundle_id, price_at_purchase, currency) VALUES ($1, $2, $3, $4, 120, $5)",
				uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, bundleID, f.env.PG.TenantCurrency(t, tenantID))
		}, rpcerrors.ReasonEpisodePurchased},
		{"a store purchase", func(t *testing.T, episode testutil.Episode) {
			f.purchase(t, episode.ID, ", store, store_transaction_id", "app_store", f.publicID("txn-"))
		}, rpcerrors.ReasonEpisodeStorePurchased},
		{"a store payment sheet no transaction used yet", func(t *testing.T, episode testutil.Episode) {
			f.exec(t, "INSERT INTO store_purchase_intents (id, tenant_id, user_id, episode_id, price, product_id, currency) VALUES ($1, $2, $3, $4, 120, 'com.example.episode.120', $5)",
				uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, episode.ID, f.env.PG.TenantCurrency(t, tenantID))
		}, rpcerrors.ReasonEpisodePaymentPending},
		{"a bundle checkout that can still be paid", func(t *testing.T, episode testutil.Episode) {
			bundleID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, price) VALUES ($1, $2, $3, $4, $5, 120)", bundleID, tenantID, f.series.ID, f.reader.ID, f.publicID("bundle-"))
			f.exec(t, "INSERT INTO series_bundle_episodes (tenant_id, series_bundle_id, episode_id, position, list_price, price) VALUES ($1, $2, $3, 0, 120, 120)", tenantID, bundleID, episode.ID)
		}, rpcerrors.ReasonEpisodePaymentPending},
		{"an access ticket", func(t *testing.T, episode testutil.Episode) {
			f.exec(t, "INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, revoked_at) VALUES ($1, $2, $3, $4, $5, now())",
				uuid.Must(uuid.NewV7()), tenantID, f.publicID("TKT"), episode.ID, f.reader.ID)
		}, rpcerrors.ReasonEpisodeAccessTicketIssued},
		{"a royalty statement line", func(t *testing.T, episode testutil.Episode) {
			f.exec(t, `INSERT INTO royalty_statement_lines (tenant_id, statement_id, line_number, creator_name, series_title, episode_id, episode_title, sale_count, gross_amount, refunded_amount, share_bps, payout_amount)
				VALUES ($1, $2, 1, 'Author A', 'Series A', $3, $4, 1, 120, 0, 5000, 60)`, tenantID, statement("2026-01-01"), episode.ID, episode.Title)
		}, rpcerrors.ReasonEpisodeOnRoyaltyStatement},
		{"a part of a statement's subscription revenue", func(t *testing.T, episode testutil.Episode) {
			f.exec(t, "INSERT INTO royalty_statement_subscription_parts (tenant_id, statement_id, subscription_payment_id, episode_id, price) VALUES ($1, $2, $3, $4, 50)",
				tenantID, statement("2026-02-01"), uuid.Must(uuid.NewV7()), episode.ID)
		}, rpcerrors.ReasonEpisodeOnRoyaltyStatement},
		{"a coin payment", func(t *testing.T, episode testutil.Episode) {
			purchaseID := f.purchase(t, episode.ID, "")
			f.exec(t, "INSERT INTO coin_transactions (id, tenant_id, user_id, kind, coins, purchase_id) VALUES ($1, $2, $3, 'spend', 12, $4)",
				uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, purchaseID)
		}, rpcerrors.ReasonEpisodePaidWithCoins},
		{"a redeemed promotion code", func(t *testing.T, episode testutil.Episode) {
			codeID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id, deleted_at) VALUES ($1, $2, $3, 'percent', 10, 'episode', $4, now())",
				codeID, tenantID, f.publicID("CODE"), episode.ID)
			// The redemption is of another episode's purchase, so nothing but
			// the code ties it to this one.
			other := f.episode(t, "Other chapter")
			purchaseID := f.purchase(t, other.ID, "")
			f.exec(t, "INSERT INTO promotion_code_redemptions (id, tenant_id, promotion_code_id, purchase_id, user_id) VALUES ($1, $2, $3, $4, $5)",
				uuid.Must(uuid.NewV7()), tenantID, codeID, purchaseID, f.reader.ID)
		}, rpcerrors.ReasonEpisodePromotionCodeRedeemed},
		{"a published volume", func(t *testing.T, episode testutil.Episode) {
			f.env.PG.SeedVolume(t, tenantID, f.series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Published volume", OrderIndex: int32(f.next), Price: 100, Published: true, EpisodeIDs: []uuid.UUID{episode.ID}})
		}, rpcerrors.ReasonEpisodeInPublishedVolume},
		{"a volume taken off sale", func(t *testing.T, episode testutil.Episode) {
			volume := f.env.PG.SeedVolume(t, tenantID, f.series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Volume taken off sale", OrderIndex: int32(f.next), Price: 100, Published: true, EpisodeIDs: []uuid.UUID{episode.ID}})
			f.exec(t, "UPDATE volumes SET is_published = false WHERE tenant_id = $1 AND id = $2", tenantID, volume.ID)
		}, rpcerrors.ReasonEpisodeInPublishedVolume},
		{"an access ticket and a published volume", func(t *testing.T, episode testutil.Episode) {
			f.env.PG.SeedVolume(t, tenantID, f.series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Published volume", OrderIndex: int32(f.next), Price: 100, Published: true, EpisodeIDs: []uuid.UUID{episode.ID}})
			f.exec(t, "INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id) VALUES ($1, $2, $3, $4, $5)",
				uuid.Must(uuid.NewV7()), tenantID, f.publicID("TKT"), episode.ID, f.reader.ID)
		}, rpcerrors.ReasonEpisodeAccessTicketIssued},
	}
	for _, tc := range cases {
		episode := f.episode(t, "Chapter with "+tc.name)
		tc.seed(t, episode)

		err := f.delete(f.admin, episode)
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != tc.want {
			t.Errorf("DeleteEpisode of an episode with %s = %v (reason %q), want failed_precondition %s", tc.name, err, reason, tc.want)
		}
		if got := f.env.countRows(t, "SELECT count(*) FROM episodes WHERE id = $1", episode.ID); got != 1 {
			t.Errorf("the episode with %s is gone", tc.name)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'episode_deleted'", tenantID); got != 0 {
		t.Errorf("audit entries for refused deletions = %d, want 0", got)
	}

	// An Editor may not delete even an episode nothing refers to.
	editor := f.env.PG.SeedTenantUser(t, tenantID, "TAEDITOR1", "editor@tenant-a.example.com", "Editor", "tenant_editor")
	unsold := f.episode(t, "Unsold chapter")
	if err := f.delete(f.admin.as(editor), unsold); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteEpisode as an Editor = %v, want permission_denied", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM episodes WHERE id = $1", unsold.ID); got != 1 {
		t.Fatalf("an Editor's request deleted the episode")
	}

	// Another tenant's episode is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreignSeries := f.env.PG.SeedSeries(t, other.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB1", Title: "Series B"})
	foreign := f.env.PG.SeedEpisode(t, other.Tenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPFOREIGN01", Title: "Foreign chapter"})
	if err := f.delete(f.admin, foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteEpisode of another tenant's episode = %v, want not_found", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM episodes WHERE id = $1", foreign.ID); got != 1 {
		t.Fatalf("another tenant's episode is gone")
	}
}
