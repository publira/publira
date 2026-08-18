import { describe, expect, it } from "vitest";

import {
  buildTenantRewritePathname,
  getPublishedPageSlugFromPathname,
  isReservedTopLevelSegment,
} from "./published-page-path";

describe("isReservedTopLevelSegment", () => {
  it("アプリ固定ルートを予約扱いする", () => {
    expect(isReservedTopLevelSegment("search")).toBe(true);
    expect(isReservedTopLevelSegment("series")).toBe(true);
    expect(isReservedTopLevelSegment("announcements")).toBe(true);
    expect(isReservedTopLevelSegment("notifications")).toBe(true);
    expect(isReservedTopLevelSegment("login")).toBe(true);
    expect(isReservedTopLevelSegment("logout")).toBe(false);
    expect(isReservedTopLevelSegment("page")).toBe(true);
    expect(isReservedTopLevelSegment("api")).toBe(true);
    expect(isReservedTopLevelSegment("theme.css")).toBe(true);
    expect(isReservedTopLevelSegment("livez")).toBe(true);
    expect(isReservedTopLevelSegment("readyz")).toBe(true);
  });

  it("コンテンツ用 slug は予約ではない", () => {
    expect(isReservedTopLevelSegment("privacy")).toBe(false);
    expect(isReservedTopLevelSegment("terms")).toBe(false);
    expect(isReservedTopLevelSegment("about")).toBe(false);
  });
});

describe("getPublishedPageSlugFromPathname", () => {
  it("単一・複数セグメントの公開ページ候補を返す", () => {
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

  it("ルート・予約・不正文字は null", () => {
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
  it("公開ページ候補は /page/[...slug] へ rewrite する", () => {
    expect(buildTenantRewritePathname("tenant-1", "/logout")).toBe(
      "/tenant-1/page/logout"
    );
    expect(buildTenantRewritePathname("tenant-1", "/privacy")).toBe(
      "/tenant-1/page/privacy"
    );
    expect(buildTenantRewritePathname("tenant-1", "/about")).toBe(
      "/tenant-1/page/about"
    );
    expect(buildTenantRewritePathname("tenant-1", "/legal/terms")).toBe(
      "/tenant-1/page/legal/terms"
    );
  });

  it("予約パスとルートはそのまま tenant 配下へ", () => {
    expect(buildTenantRewritePathname("tenant-1", "/")).toBe("/tenant-1");
    expect(buildTenantRewritePathname("tenant-1", "/series")).toBe(
      "/tenant-1/series"
    );
    expect(
      buildTenantRewritePathname("tenant-1", "/series/abc/episodes/ep1")
    ).toBe("/tenant-1/series/abc/episodes/ep1");
    expect(buildTenantRewritePathname("tenant-1", "/search")).toBe(
      "/tenant-1/search"
    );
    expect(buildTenantRewritePathname("tenant-1", "/login")).toBe(
      "/tenant-1/login"
    );
  });
});
