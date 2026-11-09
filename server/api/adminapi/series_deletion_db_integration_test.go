package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// seriesDeletionFixture is a tenant with an admin, a reader, a label, and a
// counter for the public IDs the rows a test seeds need.
type seriesDeletionFixture struct {
	env    *adminDBEnv
	admin  adminDBTenant
	reader testutil.TenantUser
	label  testutil.Label
	next   int
}

func newSeriesDeletionFixture(t *testing.T, env *adminDBEnv) *seriesDeletionFixture {
	t.Helper()

	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &seriesDeletionFixture{
		env:    env,
		admin:  admin,
		reader: env.PG.SeedEndUser(t, admin.Tenant.ID, "READER01", "reader@example.com", "Reader"),
		label:  env.PG.SeedLabel(t, admin.Tenant.ID, testutil.LabelSeed{PublicID: "LABEL01", Name: "Label A"}),
	}
}

// publicID answers a public ID no other row of the test has.
func (f *seriesDeletionFixture) publicID(prefix string) string {
	f.next++
	return fmt.Sprintf("%s%06d", prefix, f.next)
}

func (f *seriesDeletionFixture) series(t *testing.T, title string) testutil.Series {
	t.Helper()
	return f.env.PG.SeedSeries(t, f.admin.Tenant.ID, testutil.SeriesSeed{PublicID: f.publicID("SRDEL"), Title: title, LabelID: f.label.ID, Published: true})
}

func (f *seriesDeletionFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *seriesDeletionFixture) delete(as adminDBTenant, series testutil.Series) error {
	_, err := f.env.seriesClient().DeleteSeries(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.DeleteSeriesRequest{
		Tenant:   as.tenantContext(),
		SeriesId: series.ID.String(),
	})
	return err
}

// promotionCode seeds a 10% code for the series, deleted when deleted is set,
// and answers its ID.
func (f *seriesDeletionFixture) promotionCode(t *testing.T, seriesID uuid.UUID, deleted bool) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	var deletedAt any
	if deleted {
		deletedAt = time.Now()
	}
	f.exec(t, "INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id, deleted_at) VALUES ($1, $2, $3, 'percent', 10, 'series', $4, $5)",
		id, f.admin.Tenant.ID, f.publicID("CODE"), seriesID, deletedAt)
	return id
}

// indexSyncsQueued counts the catalog index syncs queued for one row.
func (f *seriesDeletionFixture) indexSyncsQueued(t *testing.T, kind string, id uuid.UUID) int {
	t.Helper()
	return f.env.countRows(t,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'kind' = $2 AND payload->>'id' = $3",
		outbox.EventTypeCatalogIndexSync, kind, id.String())
}

// A series that holds nothing goes with everything that is its alone, leaves
// the search index, the label and the Authors it published through, and the
// storefront's cached pages owing a refresh, and is named in the audit log by
// its title. Another series and the deleted series' label stay as they were.
func TestDBDeleteSeriesTakesWhatIsItsOwn(t *testing.T) {
	f := newSeriesDeletionFixture(t, newReaderIconDBEnv(t))
	tenantID := f.admin.Tenant.ID
	series := f.series(t, "Series to delete")
	kept := f.series(t, "Series to keep")
	creator := f.env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "CREATOR01", Name: "Author A"})
	genre := f.env.PG.SeedGenre(t, tenantID, testutil.GenreSeed{PublicID: "GENRE01", Name: "Fantasy", Slug: "fantasy"})
	tag := f.env.PG.SeedTag(t, tenantID, testutil.TagSeed{Name: "Dragons", Slug: "dragons"})

	f.env.PG.SeedSeriesTranslation(t, tenantID, series.ID, "en", "Series in English", "")
	f.env.PG.SeedSeriesCreator(t, tenantID, series.ID, creator.ID, "")
	f.env.PG.SeedSeriesGenre(t, tenantID, series.ID, genre.ID)
	f.env.PG.SeedSeriesTag(t, tenantID, series.ID, tag.ID)
	imageID := uuid.Must(uuid.NewV7())
	f.exec(t, "INSERT INTO series_images (id, tenant_id, series_id) VALUES ($1, $2, $3)", imageID, tenantID, series.ID)
	f.exec(t, `INSERT INTO series_image_variants (id, tenant_id, series_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'portrait-1x', 'portrait', 's3', 'tenants/x/series/cover.webp', 'image/webp', 10, 1, 1)`, uuid.Must(uuid.NewV7()), tenantID, imageID)
	f.exec(t, "UPDATE series SET eye_catch_image_id = $1 WHERE id = $2", imageID, series.ID)
	f.exec(t, "INSERT INTO series_wait_free_settings (tenant_id, series_id, enabled) VALUES ($1, $2, true)", tenantID, series.ID)
	f.exec(t, "INSERT INTO series_free_after_settings (tenant_id, series_id, enabled) VALUES ($1, $2, true)", tenantID, series.ID)
	f.exec(t, "INSERT INTO wait_free_ticket_states (tenant_id, user_id, series_id, next_available_at) VALUES ($1, $2, $3, now())", tenantID, f.reader.ID, series.ID)
	f.exec(t, "INSERT INTO reader_daily_activity (tenant_id, stat_date, user_id, series_id) VALUES ($1, current_date, $2, $3)", tenantID, f.reader.ID, series.ID)
	for _, target := range []uuid.UUID{series.ID, kept.ID} {
		f.exec(t, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenantID, f.reader.ID, target)
		f.exec(t, "INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, debounce_bucket) VALUES ($1, $2, 'series_view', $3, $4, 1)",
			uuid.Must(uuid.NewV7()), tenantID, f.reader.ID, target)
	}
	f.exec(t, "INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, price, expired_provider, expired_provider_checkout_id, expired_at) VALUES ($1, $2, $3, $4, 'bundle-expired', 240, 'stripe', 'cs_expired', now())",
		uuid.Must(uuid.NewV7()), tenantID, series.ID, f.reader.ID)
	f.promotionCode(t, series.ID, true)

	if err := f.delete(f.admin, series); err != nil {
		t.Fatalf("DeleteSeries: %v", err)
	}

	for _, table := range []string{
		"series WHERE id = $1",
		"series_translations WHERE series_id = $1",
		"series_listings WHERE series_id = $1",
		"series_creators WHERE series_id = $1",
		"series_genres WHERE series_id = $1",
		"series_tags WHERE series_id = $1",
		"series_images WHERE series_id = $1",
		"series_wait_free_settings WHERE series_id = $1",
		"series_free_after_settings WHERE series_id = $1",
		"wait_free_ticket_states WHERE series_id = $1",
		"reader_daily_activity WHERE series_id = $1",
		"series_follows WHERE series_id = $1",
		"series_follower_counts WHERE series_id = $1",
		"series_follow_changes WHERE series_id = $1",
		"series_rating_counts WHERE series_id = $1",
		"content_events WHERE series_id = $1",
		"series_bundles WHERE series_id = $1",
		"promotion_codes WHERE target_id = $1",
		"sitemap_entries WHERE id = $1",
	} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table, series.ID); got != 0 {
			t.Errorf("rows left in %s = %d, want 0", table, got)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM series_image_variants WHERE series_image_id = $1", imageID); got != 0 {
		t.Errorf("image variants left = %d, want 0", got)
	}

	// What else the tenant had is as it was.
	if got := f.env.countRows(t, "SELECT count(*) FROM series WHERE id = $1", kept.ID); got != 1 {
		t.Errorf("the other series is gone")
	}
	for _, table := range []string{"series_follows", "content_events"} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table+" WHERE series_id = $1", kept.ID); got != 1 {
			t.Errorf("the other series' %s = %d, want 1", table, got)
		}
	}
	for _, table := range []string{"labels", "creators", "genres", "tags"} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table+" WHERE tenant_id = $1", tenantID); got != 1 {
			t.Errorf("%s left = %d, want 1", table, got)
		}
	}

	// The search index loses the series and rereads what it published.
	for _, ref := range []struct {
		kind string
		id   uuid.UUID
	}{{"series", series.ID}, {"label", f.label.ID}, {"creator", creator.ID}} {
		if got := f.indexSyncsQueued(t, ref.kind, ref.id); got != 1 {
			t.Errorf("%s search syncs queued = %d, want 1", ref.kind, got)
		}
	}
	tags := f.env.revalidatedTags(t, f.admin.Tenant)
	for _, want := range []string{
		fmt.Sprintf("tenant:%s:series:%s", tenantID, series.PublicID),
		fmt.Sprintf("tenant:%s:series:list", tenantID),
		fmt.Sprintf("tenant:%s:series:detail", tenantID),
		fmt.Sprintf("tenant:%s:labels", tenantID),
		fmt.Sprintf("tenant:%s:creators", tenantID),
	} {
		if !slices.Contains(tags, want) {
			t.Errorf("cache tags recorded = %v, want %s among them", tags, want)
		}
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'series_deleted' AND target_type = 'series' AND target_id = $2 AND reason = $3",
		tenantID, series.PublicID, series.Title,
	); got != 1 {
		t.Errorf("audit entries naming the deletion = %d, want 1", got)
	}

	// A request delivered again finds nothing to delete.
	if err := f.delete(f.admin, series); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteSeries again = %v, want not_found", err)
	}
}

// A series something refers to stays, and the refusal names the first such
// reference in the order the RPC documents.
func TestDBDeleteSeriesRefusesWhatRefersToIt(t *testing.T) {
	t.Parallel()

	f := newSeriesDeletionFixture(t, newAdminDBEnv(t))
	tenantID := f.admin.Tenant.ID

	cases := []struct {
		name string
		seed func(t *testing.T, series testutil.Series)
		want string
	}{
		{"a draft episode", func(t *testing.T, series testutil.Series) {
			f.env.PG.SeedEpisode(t, tenantID, series.ID, testutil.EpisodeSeed{PublicID: f.publicID("EP"), Title: "Draft chapter", Status: testutil.EpisodeStatusDraft})
		}, rpcerrors.ReasonSeriesHasEpisodes},
		{"a volume never on sale", func(t *testing.T, series testutil.Series) {
			f.env.PG.SeedVolume(t, tenantID, series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Volume 1", OrderIndex: 1, Price: 100})
		}, rpcerrors.ReasonSeriesHasVolumes},
		{"a subscription plan scoped to it", func(t *testing.T, series testutil.Series) {
			f.env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{Name: "Series pass", StripePriceID: f.publicID("price_"), PriceAmount: 500, Scope: "series", SeriesIDs: []uuid.UUID{series.ID}})
		}, rpcerrors.ReasonSeriesInSubscriptionPlan},
		{"a live promotion code", func(t *testing.T, series testutil.Series) {
			f.promotionCode(t, series.ID, false)
		}, rpcerrors.ReasonSeriesInPromotionCode},
		{"a deleted promotion code someone redeemed", func(t *testing.T, series testutil.Series) {
			codeID := f.promotionCode(t, series.ID, true)
			// The redemption is of another series' purchase, so nothing but
			// the code ties it to this one.
			other := f.series(t, "Other series")
			episode := f.env.PG.SeedEpisode(t, tenantID, other.ID, testutil.EpisodeSeed{PublicID: f.publicID("EP"), Title: "Other chapter", Price: 120, Status: testutil.EpisodeStatusPublished})
			purchaseID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO purchases (id, tenant_id, user_id, episode_id, currency, price_at_purchase) VALUES ($1, $2, $3, $4, $5, 120)",
				purchaseID, tenantID, f.reader.ID, episode.ID, f.env.PG.TenantCurrency(t, tenantID))
			f.exec(t, "INSERT INTO promotion_code_redemptions (id, tenant_id, promotion_code_id, purchase_id, user_id) VALUES ($1, $2, $3, $4, $5)",
				uuid.Must(uuid.NewV7()), tenantID, codeID, purchaseID, f.reader.ID)
		}, rpcerrors.ReasonSeriesInPromotionCode},
		{"a plan scoped to it and a live promotion code", func(t *testing.T, series testutil.Series) {
			f.promotionCode(t, series.ID, false)
			f.env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{Name: "Series pass", StripePriceID: f.publicID("price_"), PriceAmount: 500, Scope: "series", SeriesIDs: []uuid.UUID{series.ID}})
		}, rpcerrors.ReasonSeriesInSubscriptionPlan},
		{"a volume and an episode", func(t *testing.T, series testutil.Series) {
			f.env.PG.SeedVolume(t, tenantID, series.ID, testutil.VolumeSeed{PublicID: f.publicID("VOL"), Title: "Volume 1", OrderIndex: 1, Price: 100})
			f.env.PG.SeedEpisode(t, tenantID, series.ID, testutil.EpisodeSeed{PublicID: f.publicID("EP"), Title: "Chapter", Status: testutil.EpisodeStatusDraft})
		}, rpcerrors.ReasonSeriesHasEpisodes},
	}
	for _, tc := range cases {
		series := f.series(t, "Series with "+tc.name)
		tc.seed(t, series)

		err := f.delete(f.admin, series)
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != tc.want {
			t.Errorf("DeleteSeries of a series with %s = %v (reason %q), want failed_precondition %s", tc.name, err, reason, tc.want)
		}
		if got := f.env.countRows(t, "SELECT count(*) FROM series WHERE id = $1", series.ID); got != 1 {
			t.Errorf("the series with %s is gone", tc.name)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'series_deleted'", tenantID); got != 0 {
		t.Errorf("audit entries for refused deletions = %d, want 0", got)
	}

	// An Editor may not delete even a series nothing refers to.
	editor := f.env.PG.SeedTenantUser(t, tenantID, "TAEDITOR1", "editor@tenant-a.example.com", "Editor", "tenant_editor")
	empty := f.series(t, "Empty series")
	if err := f.delete(f.admin.as(editor), empty); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteSeries as an Editor = %v, want permission_denied", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM series WHERE id = $1", empty.ID); got != 1 {
		t.Fatalf("an Editor's request deleted the series")
	}

	// Another tenant's series is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreign := f.env.PG.SeedSeries(t, other.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB1", Title: "Series B"})
	if err := f.delete(f.admin, foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteSeries of another tenant's series = %v, want not_found", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM series WHERE id = $1", foreign.ID); got != 1 {
		t.Fatalf("another tenant's series is gone")
	}
}

// A promotion code created for a series while the series is being deleted
// either lands first and refuses the deletion, or finds the series gone: it is
// never left naming a series that no longer exists.
func TestDBDeleteSeriesHoldsOffANewPromotionCode(t *testing.T) {
	t.Parallel()

	f := newSeriesDeletionFixture(t, newAdminDBEnv(t))
	series := f.series(t, "Series raced by a code")

	ctx := context.Background()
	tx, err := f.env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, "SELECT 1 FROM series WHERE id = $1 FOR UPDATE", series.ID); err != nil {
		t.Fatalf("lock the series as a deletion does: %v", err)
	}

	created := make(chan error, 1)
	go func() {
		_, err := f.env.promotionCodeClient().CreatePromotionCode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.CreatePromotionCodeRequest{
			Tenant:        f.admin.tenantContext(),
			Code:          "RACE10",
			DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
			DiscountValue: 10,
			TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_SERIES,
			TargetId:      series.ID.String(),
		})
		created <- err
	}()

	select {
	case err := <-created:
		t.Fatalf("CreatePromotionCode did not wait for the series lock: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM series WHERE id = $1", series.ID); err != nil {
		t.Fatalf("delete the series: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if err := <-created; connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePromotionCode for a series deleted meanwhile = %v, want invalid_argument", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM promotion_codes WHERE target_id = $1", series.ID); got != 0 {
		t.Fatalf("codes naming the deleted series = %d, want 0", got)
	}
}
