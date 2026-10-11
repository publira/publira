import { describe, expect, it } from "vitest";

import {
  buildTenantRewritePathname,
  getPublishedPageSlugFromPathname,
} from "./published-page-path";

const publishedSlugs = new Set([
  "/about",
  "/ja",
  "/legal/terms",
  "/logout",
  "/privacy",
  "/series",
]);

describe("getPublishedPageSlugFromPathname", () => {
  it("names the published page a path matches", () => {
    expect(getPublishedPageSlugFromPathname("/privacy", publishedSlugs)).toBe(
      "privacy"
    );
    expect(
      getPublishedPageSlugFromPathname("/legal/terms", publishedSlugs)
    ).toBe("legal/terms");
    expect(
      getPublishedPageSlugFromPathname("//privacy//", publishedSlugs)
    ).toBe("privacy");
    expect(getPublishedPageSlugFromPathname("/Privacy", publishedSlugs)).toBe(
      "privacy"
    );
  });

  it("names a page whose slug is also one of the site's own routes", () => {
    expect(getPublishedPageSlugFromPathname("/series", publishedSlugs)).toBe(
      "series"
    );
  });

  it("returns null for a path no published page has", () => {
    expect(getPublishedPageSlugFromPathname("/", publishedSlugs)).toBeNull();
    expect(getPublishedPageSlugFromPathname("", publishedSlugs)).toBeNull();
    expect(
      getPublishedPageSlugFromPathname("/search", publishedSlugs)
    ).toBeNull();
    expect(
      getPublishedPageSlugFromPathname("/series/abc", publishedSlugs)
    ).toBeNull();
    expect(
      getPublishedPageSlugFromPathname("/legal", publishedSlugs)
    ).toBeNull();
    expect(
      getPublishedPageSlugFromPathname("/page/privacy", publishedSlugs)
    ).toBeNull();
  });

  it("returns null when the slugs could not be read", () => {
    expect(getPublishedPageSlugFromPathname("/privacy", null)).toBeNull();
  });
});

describe("buildTenantRewritePathname", () => {
  it("rewrites a published page's path to /page/[...slug]", () => {
    expect(
      buildTenantRewritePathname("tenant-1", "ja", "/logout", publishedSlugs)
    ).toBe("/tenant-1/ja/page/logout");
    expect(
      buildTenantRewritePathname("tenant-1", "en", "/about", publishedSlugs)
    ).toBe("/tenant-1/en/page/about");
    expect(
      buildTenantRewritePathname(
        "tenant-1",
        "ja",
        "/legal/terms",
        publishedSlugs
      )
    ).toBe("/tenant-1/ja/page/legal/terms");
  });

  it("serves the page where it shares a path with one of the site's routes", () => {
    expect(
      buildTenantRewritePathname("tenant-1", "ja", "/series", publishedSlugs)
    ).toBe("/tenant-1/ja/page/series");
  });

  it("keeps every other path under the tenant/locale route tree", () => {
    expect(
      buildTenantRewritePathname("tenant-1", "ja", "/", publishedSlugs)
    ).toBe("/tenant-1/ja");
    expect(
      buildTenantRewritePathname("tenant-1", "en", "/", publishedSlugs)
    ).toBe("/tenant-1/en");
    expect(
      buildTenantRewritePathname(
        "tenant-1",
        "ja",
        "/series/abc/episodes/ep1",
        publishedSlugs
      )
    ).toBe("/tenant-1/ja/series/abc/episodes/ep1");
    expect(
      buildTenantRewritePathname("tenant-1", "ja", "/search", publishedSlugs)
    ).toBe("/tenant-1/ja/search");
    // A route added later needs no list to be served.
    expect(
      buildTenantRewritePathname(
        "tenant-1",
        "ja",
        "/new-feature",
        publishedSlugs
      )
    ).toBe("/tenant-1/ja/new-feature");
  });

  it("sends every path to the app's routes when the slugs could not be read", () => {
    expect(buildTenantRewritePathname("tenant-1", "ja", "/privacy", null)).toBe(
      "/tenant-1/ja/privacy"
    );
  });

  // The locale is stripped before the path is matched, so a published page
  // whose slug happens to be a locale code still resolves as a page.
  it("serves a page whose slug is a locale code under another locale", () => {
    expect(
      buildTenantRewritePathname("tenant-1", "en", "/ja", publishedSlugs)
    ).toBe("/tenant-1/en/page/ja");
  });
});
