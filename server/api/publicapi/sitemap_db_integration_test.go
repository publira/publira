package publicapi

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

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

	resp, err := env.catalogClient().ListSitemapEntries(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ListSitemapEntries: %v", err)
	}
	return resp.Msg
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
	env := newPublicDBEnv(t)
	tenant := seedSitemapCatalog(t, env)

	token := pagination.Encode(pagination.Forward, "7", "019d008d-184d-7d31-a78a-89728a746e38")
	_, err := env.catalogClient().ListSitemapEntries(context.Background(), connect.NewRequest(&publirav1.ListSitemapEntriesRequest{
		Tenant: tenantContext(tenant),
		Token:  token,
	}))
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("err = %v, want invalid_argument", err)
	}
}
