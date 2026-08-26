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
  });

  // `/api`, `/theme.css`, `/livez`, `/readyz` never reach this set: they are
  // served outside the locale tree and settled in `lib/locale-path.ts` and
  // `@publira/utils/health` before a pathname is classified here.
  it("ロケール外で処理されるパスは予約に含めない", () => {
    expect(isReservedTopLevelSegment("api")).toBe(false);
    expect(isReservedTopLevelSegment("theme.css")).toBe(false);
    expect(isReservedTopLevelSegment("livez")).toBe(false);
    expect(isReservedTopLevelSegment("readyz")).toBe(false);
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

  it("予約パスとルートはそのまま tenant / locale 配下へ", () => {
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
  it("ロケール名と同じ slug の公開ページも /page へ載る", () => {
    expect(buildTenantRewritePathname("tenant-1", "en", "/ja")).toBe(
      "/tenant-1/en/page/ja"
    );
  });
});
