import { describe, expect, it } from "vitest";

import {
  buildTenantRewritePathname,
  getPublishedPageSlugFromPathname,
  isReservedTopLevelSegment,
} from "./published-page-path";

describe("isReservedTopLevelSegment", () => {
  it("Treat app-fixed routes as reservations", () => {
    expect(isReservedTopLevelSegment("search")).toBe(true);
    expect(isReservedTopLevelSegment("series")).toBe(true);
    expect(isReservedTopLevelSegment("announcements")).toBe(true);
    expect(isReservedTopLevelSegment("notifications")).toBe(true);
    expect(isReservedTopLevelSegment("login")).toBe(true);
    expect(isReservedTopLevelSegment("logout")).toBe(false);
    expect(isReservedTopLevelSegment("page")).toBe(true);
  });

  // `/api`, `/theme.css`, `/livez`, `/readyz` never reach this set: they are
  // served outside the locale tree and settled in `lib/locale-path.ts` and
  // `@publira/utils/health` before a pathname is classified here.
  it("Do not include paths that are processed outside the locale in the reservation", () => {
    expect(isReservedTopLevelSegment("api")).toBe(false);
    expect(isReservedTopLevelSegment("theme.css")).toBe(false);
    expect(isReservedTopLevelSegment("livez")).toBe(false);
    expect(isReservedTopLevelSegment("readyz")).toBe(false);
  });

  it("Content slug is not reserved", () => {
    expect(isReservedTopLevelSegment("privacy")).toBe(false);
    expect(isReservedTopLevelSegment("terms")).toBe(false);
    expect(isReservedTopLevelSegment("about")).toBe(false);
  });
});

describe("getPublishedPageSlugFromPathname", () => {
  it("Return public page suggestions for single/multiple segments", () => {
    expect(getPublishedPageSlugFromPathname("/logout")).toBe("logout");
    expect(getPublishedPageSlugFromPathname("/privacy")).toBe("privacy");
    expect(getPublishedPageSlugFromPathname("/terms-of-service")).toBe(
      "terms-of-service"
    );
    expect(getPublishedPageSlugFromPathname("about")).toBe("about");
    expect(getPublishedPageSlugFromPathname("/legal/terms")).toBe(
      "legal/terms"
    );
    expect(getPublishedPageSlugFromPathname("//privacy//")).toBe("privacy");
  });

  it("Root/reserved/invalid characters are null", () => {
    expect(getPublishedPageSlugFromPathname("/")).toBeNull();
    expect(getPublishedPageSlugFromPathname("")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/search")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/series")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/series/abc")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/Privacy")).toBe("privacy");
    expect(getPublishedPageSlugFromPathname("/under_score")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/page")).toBeNull();
    expect(getPublishedPageSlugFromPathname("/page/foo")).toBeNull();
  });
});

describe("buildTenantRewritePathname", () => {
  it("Rewrite public page candidates to /page/[...slug]", () => {
    expect(buildTenantRewritePathname("tenant-1", "ja", "/logout")).toBe(
      "/tenant-1/ja/page/logout"
    );
    expect(buildTenantRewritePathname("tenant-1", "ja", "/privacy")).toBe(
      "/tenant-1/ja/page/privacy"
    );
    expect(buildTenantRewritePathname("tenant-1", "en", "/about")).toBe(
      "/tenant-1/en/page/about"
    );
    expect(buildTenantRewritePathname("tenant-1", "ja", "/legal/terms")).toBe(
      "/tenant-1/ja/page/legal/terms"
    );
  });

  it("Keep root and reserved routes under the tenant/locale path", () => {
    expect(buildTenantRewritePathname("tenant-1", "ja", "/")).toBe(
      "/tenant-1/ja"
    );
    expect(buildTenantRewritePathname("tenant-1", "en", "/")).toBe(
      "/tenant-1/en"
    );
    expect(buildTenantRewritePathname("tenant-1", "ja", "/series")).toBe(
      "/tenant-1/ja/series"
    );
    expect(
      buildTenantRewritePathname("tenant-1", "ja", "/series/abc/episodes/ep1")
    ).toBe("/tenant-1/ja/series/abc/episodes/ep1");
    expect(buildTenantRewritePathname("tenant-1", "ja", "/search")).toBe(
      "/tenant-1/ja/search"
    );
    expect(buildTenantRewritePathname("tenant-1", "en", "/login")).toBe(
      "/tenant-1/en/login"
    );
  });

  // The locale is stripped before the reserved-segment check, so a published
  // page whose slug happens to be a locale code still resolves as a page.
  it("Public pages with the same slug as the locale name are also listed on /page.", () => {
    expect(buildTenantRewritePathname("tenant-1", "en", "/ja")).toBe(
      "/tenant-1/en/page/ja"
    );
  });
});
