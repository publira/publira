package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Static pages are published through a version row rather than a flag, so what
// the storefront may serve is decided by the join between pages and
// page_versions. Only a real database exercises that join.

func TestDBListPublishedPagesReturnsOnlyPublishedFooterPages(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy",
		ContentMarkdown: "# Privacy",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:      "about",
		Title:     "About Us",
		Published: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "terms",
		Title:           "Terms (draft)",
		DisplayInFooter: true,
	})
	env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Tenant B Privacy Policy",
		Published:       true,
		DisplayInFooter: true,
	})

	resp, err := env.pagesClient().ListPublishedPages(context.Background(), connect.NewRequest(&publirav1.ListPublishedPagesRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedPages: %v", err)
	}
	if len(resp.Msg.Pages) != 1 {
		titles := make([]string, 0, len(resp.Msg.Pages))
		for _, page := range resp.Msg.Pages {
			titles = append(titles, page.Title)
		}
		t.Fatalf("pages = %v, want only the published footer page of tenant A", titles)
	}
	if resp.Msg.Pages[0].Title != "Privacy Policy" {
		t.Fatalf("page title = %q, want Privacy Policy", resp.Msg.Pages[0].Title)
	}
}

func TestDBGetPublishedPageServesTheStoredVersion(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{
		Slug:            "legal/terms",
		Title:           "Terms Of Service",
		ContentMarkdown: "# Terms\n\nThe stored body.",
		Published:       true,
	})

	client := env.pagesClient()
	// The storefront may ask with or without the leading slash, and with the
	// duplicated slashes a path join can produce.
	for _, slug := range []string{"legal/terms", "/legal/terms", "//legal//terms//"} {
		resp, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(tenant),
			Slug:   slug,
		}))
		if err != nil {
			t.Fatalf("GetPublishedPage %q: %v", slug, err)
		}
		if resp.Msg.Page.Slug != "/legal/terms" {
			t.Fatalf("GetPublishedPage %q slug = %q, want /legal/terms", slug, resp.Msg.Page.Slug)
		}
		if resp.Msg.Version.ContentMarkdown != "# Terms\n\nThe stored body." {
			t.Fatalf("GetPublishedPage %q content = %q, want the stored body", slug, resp.Msg.Version.ContentMarkdown)
		}
	}
}

func TestDBGetPublishedPageHidesPagesThatAreNotPublishedYet(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	draft := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "terms", Title: "Terms (draft)"})
	embargoed := env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:        "notice",
		Title:       "Notice",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	theirs := env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:      "privacy",
		Title:     "Tenant B Privacy Policy",
		Published: true,
	})

	client := env.pagesClient()
	for _, slug := range []string{draft.Slug, embargoed.Slug, theirs.Slug} {
		_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(first),
			Slug:   slug,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetPublishedPage %q code = %v, want not_found (err=%v)", slug, connect.CodeOf(err), err)
		}
	}
}
