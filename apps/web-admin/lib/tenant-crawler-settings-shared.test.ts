import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  crawlerPathMessage,
  MAX_CRAWLER_EXCLUDED_PATHS,
  parseCrawlerPaths,
} from "./tenant-crawler-settings-shared";

// The cases mirror server/internal/crawlersettings: a path the card accepts
// has to be one the server stores, and one it refuses one the server refuses.
describe("parseCrawlerPaths", () => {
  it("takes each path trimmed, and skips blank ones", () => {
    expect(
      parseCrawlerPaths([
        " /series/SERIESA00001/ ",
        "",
        "  ",
        "/drafts",
        "/",
        "//",
        "/sitemapping",
        "/en/sitemap.xml",
      ])
    ).toEqual({
      ok: true,
      paths: [
        "/series/SERIESA00001/",
        "/drafts",
        "/",
        "//",
        "/sitemapping",
        "/en/sitemap.xml",
      ],
    });
  });

  it("accepts an empty list", () => {
    expect(parseCrawlerPaths([])).toEqual({ ok: true, paths: [] });
  });

  it.each([
    ["drafts", "invalid"],
    ["/my drafts", "invalid"],
    ["/drafts\tx", "invalid"],
    ["/drafts\u3000x", "invalid"],
    ["/drafts\u0000", "invalid"],
    ["/drafts/*", "invalid"],
    ["/drafts$", "invalid"],
    ["/search?q=x", "invalid"],
    ["/drafts#top", "invalid"],
    // Go's TrimSpace keeps a byte order mark, which then fails the leading /.
    ["\uFEFF/drafts", "invalid"],
    [`/${"a".repeat(512)}`, "too_long"],
    // Counted in UTF-8 bytes, as the server counts.
    [`/${"あ".repeat(171)}`, "too_long"],
    ["/robots.txt", "reserved"],
    ["/sitemap.xml", "reserved"],
    ["/sitemap", "reserved"],
    ["/sitemap/", "reserved"],
    ["/sitemap/series-1.xml", "reserved"],
  ])("refuses %j as %s", (path, reason) => {
    expect(parseCrawlerPaths(["/drafts", path])).toEqual({
      ok: false,
      path,
      reason,
    });
  });

  it("accepts a path at the length limit", () => {
    const path = `/${"a".repeat(511)}`;

    expect(parseCrawlerPaths([path])).toEqual({ ok: true, paths: [path] });
  });

  it("counts the list after duplicates are dropped", () => {
    const paths = Array.from(
      { length: MAX_CRAWLER_EXCLUDED_PATHS },
      (_, index) => `/drafts/${index}`
    );

    expect(parseCrawlerPaths([...paths, "/drafts/0/"]).ok).toBe(true);
    expect(parseCrawlerPaths([...paths, "/drafts/100"])).toEqual({
      ok: false,
      reason: "too_many",
    });
  });
});

describe("crawlerPathMessage", () => {
  const t = bindMessages(sharedCatalog("en"), "en");

  it.each([
    [
      "invalid",
      '"drafts" is not a path. Start it with / and leave out spaces, *, $, ?, and #.',
    ],
    [
      "reserved",
      '"drafts" cannot be excluded, since crawlers need robots.txt and the sitemap to read the site.',
    ],
    ["too_long", '"drafts" is too long. A path can be at most 512 bytes.'],
  ] as const)("words a path refused as %s", (reason, message) => {
    expect(crawlerPathMessage(t, { path: "drafts", reason })).toBe(message);
  });
});
