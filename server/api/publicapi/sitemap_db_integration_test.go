package publicapi

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Which rows a sitemap holds is decided by the sitemap_entries view, so these
// cases run against a real PostgreSQL.

// sitemapKey names one entry the way its storefront URL does.
func sitemapKey(entry *publirav1.SitemapEntry) string {
	switch entry.Kind {
	case publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_EPISODE:
		return "episode:" + entry.SeriesPublicId + "/" + entry.PublicId
	case publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_PAGE:
		return "page:" + entry.Slug
	default:
		return entry.Kind.String() + ":" + entry.PublicId
	}
}

func listSitemapEntries(t *testing.T, env *publicDBEnv, req *publirav1.ListSitemapEntriesRequest) *publirav1.ListSitemapEntriesResponse {
	t.Helper()

	resp, err := env.catalogClient().ListSitemapEntries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListSitemapEntries: %v", err)
	}
	return resp
}

// seedSitemapCatalog seeds one tenant with an entry of every kind the web
// storefront shows, beside rows of each kind it does not, and a second tenant
// whose rows must never appear.
func seedSitemapCatalog(t *testing.T, env *publicDBEnv) testutil.Tenant {
	t.Helper()

	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	other := env.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")

	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELSHOWN01", Name: "Shown Label"})
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSHOWN1", Title: "Shown Series", Published: true, LabelID: label.ID})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESHOW1", Title: "Shown Episode", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEDRAF1", Title: "Draft Episode"})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFUTU1", Title: "Future Episode", Status: testutil.EpisodeStatusPublished, PublishedAt: time.Now().Add(time.Hour)})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEAPPO1", Title: "App Episode", Status: testutil.EpisodeStatusPublished, Availability: "app"})
	shown := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORSHOW1", Name: "Shown Creator"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, shown.ID, "")

	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Series"})
	env.PG.SeedEpisode(t, tenant.ID, draft.ID, testutil.EpisodeSeed{PublicID: "EPISODEUNDE1", Title: "Episode Of A Draft", Status: testutil.EpisodeStatusPublished})
	hidden := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORHIDE1", Name: "Hidden Creator"})
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, hidden.ID, "")
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESAPPON1", Title: "App Series", Published: true, Availability: "app"})

	env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREEMPTY01", Name: "Empty Genre"})
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "draft", Title: "Draft Page"})
	// Published, but at paths the site answers before it looks for a page: rows
	// the admin API refuses today and a tenant may have stored before it did.
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "settings/help", Title: "Reserved Page", Published: true})
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "sitemap/help", Title: "Unreachable Page", Published: true})

	env.PG.SeedSeries(t, other.ID, testutil.SeriesSeed{PublicID: "SERIESOTHER1", Title: "Other Series", Published: true})
	env.PG.SeedGenre(t, other.ID, testutil.GenreSeed{PublicID: "GENREOTHER01", Name: "Other Genre"})

	return tenant
}

func TestDBListSitemapEntriesListsWhatTheWebStorefrontShows(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := seedSitemapCatalog(t, env)

	resp := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant)})

	got := make([]string, 0, len(resp.Entries))
	for _, entry := range resp.Entries {
		got = append(got, sitemapKey(entry))
	}
	want := []string{
		"SITEMAP_ENTRY_KIND_SERIES:SERIESSHOWN1",
		"episode:SERIESSHOWN1/EPISODESHOW1",
		"SITEMAP_ENTRY_KIND_LABEL:LABELSHOWN01",
		"SITEMAP_ENTRY_KIND_CREATOR:CREATORSHOW1",
		"SITEMAP_ENTRY_KIND_GENRE:GENREEMPTY01",
		"page:/privacy",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("entries = %v, want %v", got, want)
	}
	if resp.PreviousToken != "" || resp.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty on the only page", resp.PreviousToken, resp.NextToken)
	}

	for _, entry := range resp.Entries {
		switch entry.Kind {
		case publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_SERIES,
			publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_EPISODE,
			publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_PAGE:
			if _, err := time.Parse(time.RFC3339, entry.LastModifiedAt); err != nil {
				t.Fatalf("%s last_modified_at = %q, want an RFC 3339 time: %v", sitemapKey(entry), entry.LastModifiedAt, err)
			}
		default:
			if entry.LastModifiedAt != "" {
				t.Fatalf("%s last_modified_at = %q, want empty for a row that keeps no time", sitemapKey(entry), entry.LastModifiedAt)
			}
		}
	}
}

func TestDBListSitemapEntriesWalksEveryEntryOnceAcrossKinds(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := seedSitemapCatalog(t, env)

	var pages [][]string
	var tokens []string
	token := ""
	for {
		resp := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant), Limit: 4, Token: token})
		keys := make([]string, 0, len(resp.Entries))
		for _, entry := range resp.Entries {
			keys = append(keys, sitemapKey(entry))
		}
		pages = append(pages, keys)
		tokens = append(tokens, resp.PreviousToken)
		if resp.NextToken == "" {
			break
		}
		token = resp.NextToken
	}

	if len(pages) != 2 || len(pages[0]) != 4 || len(pages[1]) != 2 {
		t.Fatalf("pages = %v, want four entries and then two", pages)
	}
	if tokens[0] != "" {
		t.Fatalf("first page previous_token = %q, want empty", tokens[0])
	}

	back := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant), Limit: 4, Token: tokens[1]})
	backKeys := make([]string, 0, len(back.Entries))
	for _, entry := range back.Entries {
		backKeys = append(backKeys, sitemapKey(entry))
	}
	if !slices.Equal(backKeys, pages[0]) {
		t.Fatalf("previous page = %v, want %v", backKeys, pages[0])
	}
	if back.PreviousToken != "" {
		t.Fatalf("previous page previous_token = %q, want empty on the first page", back.PreviousToken)
	}
}

func TestDBListSitemapEntriesRefusesATokenNamingNoKind(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := seedSitemapCatalog(t, env)

	token := pagination.Encode(pagination.Forward, "7", "019d008d-184d-7d31-a78a-89728a746e38")
	_, err := env.catalogClient().ListSitemapEntries(context.Background(), &publirav1.ListSitemapEntriesRequest{
		Tenant: tenantContext(tenant),
		Token:  token,
	})
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("err = %v, want invalid_argument", err)
	}
}

// Each entry names the locales its page names as language alternates, which
// are the ones its read answers in published_locales, and names them in
// registry order whatever order the tenant's row holds its locales in.
func TestDBListSitemapEntriesNamesTheLocalesEachEntryIsTranslatedInto(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELSHOWN01", Name: "Shown Label"})
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSHOWN1", Title: "Hoshi no Toshokan", Published: true, LabelID: label.ID})
	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "zh-Hant", "Xingguang Tushuguan", "")
	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "en", "Starlit Library", "")
	// Kept, but in a locale the tenant has switched off.
	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "ko", "Byeorui Doseogwan", "")
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESHOW1", Title: "Daiichiya", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedEpisodeTranslation(t, tenant.ID, episode.ID, "zh-Hant", "Diyiye")
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORSHOW1", Name: "Shown Creator"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENRESHOWN01", Name: "Shown Genre"})
	page := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy (ja)", Published: true})
	env.PG.SeedPageTranslation(t, tenant.ID, page.ID, testutil.PageTranslationSeed{Locale: "zh-Hant", Title: "Privacy Policy (zh-Hant)", Published: true})
	// A draft is no translation a reader can be served yet.
	env.PG.SeedPageTranslation(t, tenant.ID, page.ID, testutil.PageTranslationSeed{Locale: "en", Title: "Privacy Policy (draft)"})
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = '{zh-Hant,en,ja}' WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}

	resp := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant)})
	got := make(map[string][]string, len(resp.Entries))
	for _, entry := range resp.Entries {
		got[sitemapKey(entry)] = entry.PublishedLocales
	}
	want := map[string][]string{
		"SITEMAP_ENTRY_KIND_SERIES:SERIESSHOWN1":  {"ja", "en", "zh-Hant"},
		"episode:SERIESSHOWN1/EPISODESHOW1":       {"ja", "zh-Hant"},
		"SITEMAP_ENTRY_KIND_LABEL:LABELSHOWN01":   nil,
		"SITEMAP_ENTRY_KIND_CREATOR:CREATORSHOW1": nil,
		"SITEMAP_ENTRY_KIND_GENRE:GENRESHOWN01":   nil,
		"page:/privacy":                           {"ja", "zh-Hant"},
	}
	if len(got) != len(want) {
		t.Fatalf("entries = %v, want %v", got, want)
	}
	for key, locales := range want {
		if entry, ok := got[key]; !ok || !slices.Equal(entry, locales) {
			t.Fatalf("%s published_locales = %v, want %v", key, entry, locales)
		}
	}

	// The same set as each page's own read names, whatever order that read
	// answers it in.
	sameSet := func(a, b []string) bool {
		a, b = slices.Clone(a), slices.Clone(b)
		slices.Sort(a)
		slices.Sort(b)
		return slices.Equal(a, b)
	}
	detail, err := env.catalogClient().GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{Tenant: tenantContext(tenant), PublicId: series.PublicID})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if !sameSet(detail.PublishedLocales, want["SITEMAP_ENTRY_KIND_SERIES:SERIESSHOWN1"]) {
		t.Fatalf("GetSeriesDetail published_locales = %v, want the sitemap's set", detail.PublishedLocales)
	}
	episodeDetail, err := env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if !sameSet(episodeDetail.PublishedLocales, want["episode:SERIESSHOWN1/EPISODESHOW1"]) {
		t.Fatalf("GetEpisodeDetail published_locales = %v, want the sitemap's set", episodeDetail.PublishedLocales)
	}
	published, err := env.pagesClient().GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{Tenant: tenantContext(tenant), Slug: "privacy"})
	if err != nil {
		t.Fatalf("GetPublishedPage: %v", err)
	}
	if !sameSet(published.PublishedLocales, want["page:/privacy"]) {
		t.Fatalf("GetPublishedPage published_locales = %v, want the sitemap's set", published.PublishedLocales)
	}
}

// An episode's page shows its title, so translating it, retitling it, and
// deleting one of its translations each move the time the sitemap dates the
// episode by.
func TestDBListSitemapEntriesDatesAnEpisodeByItsTranslations(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSHOWN1", Title: "Hoshi no Toshokan", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESHOW1", Title: "Daiichiya", Status: testutil.EpisodeStatusPublished})
	ctx := context.Background()
	queries := dbmodels.New(env.PG.DB)

	// Everything the episode keeps is moved three days back, so the episode is
	// dated by its publication until a translation is written.
	backdate := func() time.Time {
		t.Helper()
		var publishedAt time.Time
		if err := env.PG.DB.QueryRowContext(ctx, `
			UPDATE episode_listings SET published_at = date_trunc('second', now()) - interval '3 days'
			WHERE episode_id = $1
			RETURNING published_at
		`, episode.ID).Scan(&publishedAt); err != nil {
			t.Fatalf("backdate the publication: %v", err)
		}
		if _, err := env.PG.DB.ExecContext(ctx, `
			UPDATE episode_translations SET updated_at = $2 WHERE episode_id = $1
		`, episode.ID, publishedAt.Add(-time.Hour)); err != nil {
			t.Fatalf("backdate the translations: %v", err)
		}
		return publishedAt
	}
	lastModified := func() time.Time {
		t.Helper()
		resp := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant)})
		for _, entry := range resp.Entries {
			if entry.Kind == publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_EPISODE {
				at, err := time.Parse(time.RFC3339, entry.LastModifiedAt)
				if err != nil {
					t.Fatalf("episode last_modified_at = %q: %v", entry.LastModifiedAt, err)
				}
				return at
			}
		}
		t.Fatalf("entries = %v, want the episode among them", resp.Entries)
		return time.Time{}
	}

	publishedAt := backdate()
	if got := lastModified(); !got.Equal(publishedAt) {
		t.Fatalf("last_modified_at = %v, want the publication %v", got, publishedAt)
	}

	if _, err := queries.UpsertEpisodeTranslation(ctx, dbmodels.UpsertEpisodeTranslationParams{
		ID: uuid.Must(uuid.NewV7()), EpisodeID: episode.ID, TenantID: tenant.ID, Locale: "en", Title: "The First Night",
	}); err != nil {
		t.Fatalf("UpsertEpisodeTranslation en: %v", err)
	}
	if got := lastModified(); !got.After(publishedAt) {
		t.Fatalf("last_modified_at after a translation = %v, want later than %v", got, publishedAt)
	}

	publishedAt = backdate()
	if _, err := queries.UpsertEpisodeTranslation(ctx, dbmodels.UpsertEpisodeTranslationParams{
		ID: uuid.Must(uuid.NewV7()), EpisodeID: episode.ID, TenantID: tenant.ID, Locale: "ja", Title: "Daiichiya (kaitei)",
	}); err != nil {
		t.Fatalf("UpsertEpisodeTranslation ja: %v", err)
	}
	if got := lastModified(); !got.After(publishedAt) {
		t.Fatalf("last_modified_at after a retitle = %v, want later than %v", got, publishedAt)
	}

	publishedAt = backdate()
	if _, err := queries.DeleteEpisodeTranslation(ctx, dbmodels.DeleteEpisodeTranslationParams{TenantID: tenant.ID, EpisodeID: episode.ID, Locale: "en"}); err != nil {
		t.Fatalf("DeleteEpisodeTranslation en: %v", err)
	}
	if err := queries.TouchEpisodeTranslationDeletedAt(ctx, dbmodels.TouchEpisodeTranslationDeletedAtParams{TenantID: tenant.ID, ID: episode.ID}); err != nil {
		t.Fatalf("TouchEpisodeTranslationDeletedAt: %v", err)
	}
	if got := lastModified(); !got.After(publishedAt) {
		t.Fatalf("last_modified_at after a deletion = %v, want later than %v", got, publishedAt)
	}
}
