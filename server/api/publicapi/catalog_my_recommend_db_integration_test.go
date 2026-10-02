package publicapi

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/testutil"
)

// The reader's own recommendation list is scored out of two feature tables and
// four relation tables. The sqlmock tests hand the scored ids straight to the
// handler, so only these cases show that the SQL weighs the reader's signals
// and pages the way the RPC promises, and that a reader without current
// features gets the tenant-wide list unchanged.

// readerSeriesSignals is one entry of a reader's top_series, as the batch
// writes it.
type readerSeriesSignals struct {
	seriesID  uuid.UUID
	views     int64
	purchases int64
	comments  int64
	favorites int64
	ratingSum int64
}

// seedReaderFeatures files a user_recommend_features row in the shape
// recommendfeatures writes, stamped with the given version.
func (e *publicDBEnv) seedReaderFeatures(t *testing.T, tenantID, userID uuid.UUID, version int, signals ...readerSeriesSignals) {
	t.Helper()

	topSeries := make([]map[string]any, 0, len(signals))
	for _, signal := range signals {
		topSeries = append(topSeries, map[string]any{
			"series_id":      signal.seriesID.String(),
			"event_count":    signal.views + signal.purchases + signal.comments + signal.favorites,
			"view_count":     signal.views,
			"purchase_count": signal.purchases,
			"rating_count":   min(signal.ratingSum, 1),
			"rating_sum":     signal.ratingSum,
			"favorite_count": signal.favorites,
			"comment_count":  signal.comments,
			"last_event_at":  time.Now().UTC().Format(time.RFC3339),
		})
	}
	features, err := json.Marshal(map[string]any{
		"window_days": recommendfeatures.DefaultWindowDays,
		"top_series":  topSeries,
	})
	if err != nil {
		t.Fatalf("marshal reader features: %v", err)
	}
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO user_recommend_features (tenant_id, user_id, features, feature_version)
		VALUES ($1, $2, $3::jsonb, $4)
	`, tenantID, userID, string(features), version); err != nil {
		t.Fatalf("insert user_recommend_features: %v", err)
	}
}

// seedSeriesFeatures files an item_recommend_features row for one series with
// the given view and purchase counts, stamped with the given version.
func (e *publicDBEnv) seedSeriesFeatures(t *testing.T, tenantID, seriesID uuid.UUID, version int, views, purchases int64) {
	t.Helper()

	features, err := json.Marshal(map[string]any{
		"window_days":    recommendfeatures.DefaultWindowDays,
		"view_count":     views,
		"viewer_days":    views,
		"purchase_count": purchases,
		"rating_count":   0,
		"rating_sum":     0,
		"favorite_count": 0,
		"comment_count":  0,
	})
	if err != nil {
		t.Fatalf("marshal series features: %v", err)
	}
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO item_recommend_features (tenant_id, entity_type, entity_id, features, feature_version)
		VALUES ($1, 'series', $2, $3::jsonb, $4)
	`, tenantID, seriesID, string(features), version); err != nil {
		t.Fatalf("insert item_recommend_features: %v", err)
	}
}

func (e *publicDBEnv) listMyRecommendedSeries(
	t *testing.T,
	tenant testutil.Tenant,
	user testutil.TenantUser,
	req *publirav1.ListMyRecommendedSeriesRequest,
) *publirav1.ListMyRecommendedSeriesResponse {
	t.Helper()

	req.Tenant = tenantContext(tenant)
	resp, err := e.catalogClient().ListMyRecommendedSeries(context.Background(), newBearerRequest(req, tokenFor(t, tenant, user)))
	if err != nil {
		t.Fatalf("ListMyRecommendedSeries: %v", err)
	}
	if got := resp.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	return resp.Msg
}

// allMyRecommendedSeries walks every page of the reader's list.
func (e *publicDBEnv) allMyRecommendedSeries(t *testing.T, tenant testutil.Tenant, user testutil.TenantUser, limit int32) []string {
	t.Helper()

	var got []string
	token := ""
	for {
		page := e.listMyRecommendedSeries(t, tenant, user, &publirav1.ListMyRecommendedSeriesRequest{Limit: limit, Token: token})
		got = append(got, seriesPublicIDs(page.Series)...)
		if page.NextToken == "" {
			return got
		}
		token = page.NextToken
	}
}

func TestDBListMyRecommendedSeriesGivesEachReaderTheirOwnFirstPage(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, other := env.seedTwoTenants(t)
	first := env.PG.SeedTenantUser(t, tenant.ID, "READERA00001", "reader-a@example.com", "Reader A", "tenant_member")
	second := env.PG.SeedTenantUser(t, tenant.ID, "READERB00001", "reader-b@example.com", "Reader B", "tenant_member")

	mystery := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORMYS01", Name: "Mystery Writer"})
	romance := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORROM01", Name: "Romance Writer"})

	// Published oldest first, so publication order alone would put them the
	// other way round on every page.
	mysteryRead := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESMYS001", Title: "The Mystery Being Read", Published: true, PublishedAt: time.Now().Add(-96 * time.Hour),
	})
	mysteryNext := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESMYS002", Title: "Another Mystery", Published: true, PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	romanceRead := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESROM001", Title: "The Romance Being Read", Published: true, PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	romanceNext := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESROM002", Title: "Another Romance", Published: true, PublishedAt: time.Now().Add(-24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, mysteryRead.ID, mystery.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, mysteryNext.ID, mystery.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, romanceRead.ID, romance.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, romanceNext.ID, romance.ID, "")

	// The other tenant's newest series must not reach either list.
	env.PG.SeedSeries(t, other.ID, testutil.SeriesSeed{
		PublicID: "SERIESOTH001", Title: "Another Tenant's Series", Published: true, PublishedAt: time.Now().Add(-1 * time.Hour),
	})

	env.seedReaderFeatures(t, tenant.ID, first.ID, recommendfeatures.FeatureVersion, readerSeriesSignals{seriesID: mysteryRead.ID, views: 4})
	env.seedReaderFeatures(t, tenant.ID, second.ID, recommendfeatures.FeatureVersion, readerSeriesSignals{seriesID: romanceRead.ID, views: 4})

	// Tenant-wide engagement breaks the tie among the series a reader has no
	// relation to: the older romance outranks the newer one on it. The row an
	// older build wrote for the newest series is ignored rather than read, so
	// it is no help to it.
	env.seedSeriesFeatures(t, tenant.ID, romanceRead.ID, recommendfeatures.FeatureVersion, 10, 0)
	env.seedSeriesFeatures(t, tenant.ID, romanceNext.ID, recommendfeatures.FeatureVersion-1, 1000, 100)

	firstPage := env.listMyRecommendedSeries(t, tenant, first, &publirav1.ListMyRecommendedSeriesRequest{})
	if firstPage.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_READER_FEATURES {
		t.Fatalf("source = %v, want READER_FEATURES", firstPage.Source)
	}
	// The mystery the first reader is reading leads them to the other one, and
	// goes to the back itself.
	assertSeriesPublicIDs(t, firstPage.Series, "SERIESMYS002", "SERIESROM001", "SERIESROM002", "SERIESMYS001")

	secondPage := env.listMyRecommendedSeries(t, tenant, second, &publirav1.ListMyRecommendedSeriesRequest{})
	assertSeriesPublicIDs(t, secondPage.Series, "SERIESROM002", "SERIESMYS002", "SERIESMYS001", "SERIESROM001")
}

// The score is the worth of what the reader did with a series times what a
// candidate shares with it. A purchase outweighs a handful of views by enough
// that a genre shared with the bought series beats a creator shared with the
// viewed one, and the 3 / 2 / 1 rule orders what the viewed one leads to.
func TestDBListMyRecommendedSeriesWeighsWhatTheReaderDid(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA00001", "reader-a@example.com", "Reader A", "tenant_member")

	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELA000001", Name: "Label A"})
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})
	genre := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Adventure"})
	tag := env.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Time Travel"})

	// Every series is published in the reverse of the order it should come
	// back in, so publication date — the last tie-break — would produce the
	// opposite list.
	seed := func(publicID, title string, age time.Duration, labelID uuid.UUID) testutil.Series {
		return env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID: publicID, Title: title, LabelID: labelID, Published: true, PublishedAt: time.Now().Add(-age),
		})
	}
	bought := seed("SERIESBUY001", "Bought", 90*time.Hour, uuid.Nil)
	viewed := seed("SERIESVIEW01", "Viewed", 80*time.Hour, label.ID)
	sameGenre := seed("SERIESGEN001", "Same Genre As Bought", 70*time.Hour, uuid.Nil)
	sameCreator := seed("SERIESCRE001", "Same Creator As Viewed", 60*time.Hour, uuid.Nil)
	seed("SERIESLAB001", "Same Label As Viewed", 50*time.Hour, label.ID)
	sameTag := seed("SERIESTAG001", "Same Tag As Viewed", 40*time.Hour, uuid.Nil)
	seed("SERIESNON001", "Sharing Nothing", 30*time.Hour, uuid.Nil)

	env.PG.SeedSeriesGenre(t, tenant.ID, bought.ID, genre.ID)
	env.PG.SeedSeriesGenre(t, tenant.ID, sameGenre.ID, genre.ID)
	env.PG.SeedSeriesCreator(t, tenant.ID, viewed.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, sameCreator.ID, creator.ID, "")
	env.PG.SeedSeriesTag(t, tenant.ID, viewed.ID, tag.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, sameTag.ID, tag.ID)

	// One purchase is worth 100; three views are worth 15. So the genre shared
	// with the bought series scores 100, and the viewed series leads to its
	// creator at 45, its label at 30, and its tag at 15.
	env.seedReaderFeatures(t, tenant.ID, reader.ID, recommendfeatures.FeatureVersion,
		readerSeriesSignals{seriesID: bought.ID, purchases: 1},
		readerSeriesSignals{seriesID: viewed.ID, views: 3},
	)

	// Walked one page at a time, so a token built on anything but the keys the
	// scan sorted by would start a page in the wrong place.
	got := env.allMyRecommendedSeries(t, tenant, reader, 1)
	want := []string{"SERIESGEN001", "SERIESCRE001", "SERIESLAB001", "SERIESTAG001", "SERIESNON001", "SERIESVIEW01", "SERIESBUY001"}
	if !slices.Equal(got, want) {
		t.Fatalf("series = %v, want %v", got, want)
	}
}

func TestDBListMyRecommendedSeriesPagesBackOverTheEngagedBoundary(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA00001", "reader-a@example.com", "Reader A", "tenant_member")

	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})
	read := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESREAD01", Title: "Being Read", Published: true, PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	related := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESREL001", Title: "Related", Published: true, PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESNEW001", Title: "Unrelated", Published: true, PublishedAt: time.Now().Add(-24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, read.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, related.ID, creator.ID, "")
	env.seedReaderFeatures(t, tenant.ID, reader.ID, recommendfeatures.FeatureVersion, readerSeriesSignals{seriesID: read.ID, favorites: 1})

	firstPage := env.listMyRecommendedSeries(t, tenant, reader, &publirav1.ListMyRecommendedSeriesRequest{Limit: 2})
	assertSeriesPublicIDs(t, firstPage.Series, "SERIESREL001", "SERIESNEW001")

	last := env.listMyRecommendedSeries(t, tenant, reader, &publirav1.ListMyRecommendedSeriesRequest{Limit: 2, Token: firstPage.NextToken})
	assertSeriesPublicIDs(t, last.Series, "SERIESREAD01")
	if last.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", last.NextToken)
	}

	back := env.listMyRecommendedSeries(t, tenant, reader, &publirav1.ListMyRecommendedSeriesRequest{Limit: 2, Token: last.PreviousToken})
	assertSeriesPublicIDs(t, back.Series, "SERIESREL001", "SERIESNEW001")
	if back.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty back on the first page", back.PreviousToken)
	}
}

// A reader the batch has no current features for is answered with the
// tenant-wide list, page for page, whether there is no row at all or only one
// an older build of the batch wrote.
func TestDBListMyRecommendedSeriesMatchesTheTenantOrderWithoutCurrentFeatures(t *testing.T) {
	cases := map[string]struct {
		ranked   bool
		features func(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, reader testutil.TenantUser, read uuid.UUID)
	}{
		"a reader with no row on a ranked tenant": {
			ranked:   true,
			features: func(*testing.T, *publicDBEnv, testutil.Tenant, testutil.TenantUser, uuid.UUID) {},
		},
		"a reader whose row an older build wrote": {
			ranked: true,
			features: func(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, reader testutil.TenantUser, read uuid.UUID) {
				env.seedReaderFeatures(t, tenant.ID, reader.ID, recommendfeatures.FeatureVersion-1, readerSeriesSignals{seriesID: read, purchases: 5})
			},
		},
		"a tenant the batch has not run for": {
			ranked:   false,
			features: func(*testing.T, *publicDBEnv, testutil.Tenant, testutil.TenantUser, uuid.UUID) {},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			env := newPublicDBEnv(t)
			tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			reader := env.PG.SeedTenantUser(t, tenant.ID, "READERA00001", "reader-a@example.com", "Reader A", "tenant_member")

			creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})
			oldest := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID: "SERIESAOLD01", Title: "Oldest", Published: true, PublishedAt: time.Now().Add(-72 * time.Hour),
			})
			middle := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID: "SERIESAMID01", Title: "Middle", Published: true, PublishedAt: time.Now().Add(-48 * time.Hour),
			})
			env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID: "SERIESANEW01", Title: "Newest", Published: true, PublishedAt: time.Now().Add(-2 * time.Hour),
			})
			// A relation the stale row would score, were it read.
			env.PG.SeedSeriesCreator(t, tenant.ID, oldest.ID, creator.ID, "")
			env.PG.SeedSeriesCreator(t, tenant.ID, middle.ID, creator.ID, "")
			if tc.ranked {
				env.seedRankingSnapshot(t, tenant.ID, oldest.ID)
			}
			tc.features(t, env, tenant, reader, middle.ID)

			for _, limit := range []int32{0, 1} {
				shared := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{Limit: limit, Tenant: tenantContext(tenant)})
				own := env.listMyRecommendedSeries(t, tenant, reader, &publirav1.ListMyRecommendedSeriesRequest{Limit: limit})
				if got, want := seriesPublicIDs(own.Series), seriesPublicIDs(shared.Series); !slices.Equal(got, want) {
					t.Fatalf("limit %d: series = %v, want ListRecommendedSeries's %v", limit, got, want)
				}
				if own.Source != shared.Source {
					t.Fatalf("limit %d: source = %v, want ListRecommendedSeries's %v", limit, own.Source, shared.Source)
				}
			}

			var shared []string
			token := ""
			for {
				page := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{Limit: 1, Tenant: tenantContext(tenant), Token: token})
				shared = append(shared, seriesPublicIDs(page.Series)...)
				if page.NextToken == "" {
					break
				}
				token = page.NextToken
			}
			if got := env.allMyRecommendedSeries(t, tenant, reader, 1); !slices.Equal(got, shared) {
				t.Fatalf("every page = %v, want ListRecommendedSeries's %v", got, shared)
			}
		})
	}
}
