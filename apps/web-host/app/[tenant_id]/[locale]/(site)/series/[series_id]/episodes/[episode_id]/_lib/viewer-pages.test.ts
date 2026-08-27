import { describe, expect, it } from "vitest";

import type { EpisodeImageItem } from "#lib/catalog";

import { toViewerPages } from "./viewer-pages";

/** Stands in for the caller's catalog entry (`host.episode.viewer.page_title`). */
const formatPageTitle = ({ page, title }: { page: number; title: string }) =>
  `${title} ${page}ページ`;

const image = (
  overrides: Partial<EpisodeImageItem> = {}
): EpisodeImageItem => ({
  contentType: "image/jpeg",
  displayOrder: 1,
  fileSizeBytes: 1024,
  height: 1800,
  id: "IMG_001",
  imageUrl: "/images/episodes/IMG_001?token=abc",
  width: 1200,
  ...overrides,
});

describe("toViewerPages", () => {
  it("配信順のまま連番のページ名を付ける", () => {
    const pages = toViewerPages(
      "第1話",
      [image({ id: "IMG_001" }), image({ displayOrder: 2, id: "IMG_002" })],
      formatPageTitle
    );

    expect(pages.map((page) => page.id)).toEqual(["IMG_001", "IMG_002"]);
    expect(pages.map((page) => page.title)).toEqual([
      "第1話 1ページ",
      "第1話 2ページ",
    ]);
  });

  it("本文画像の URL と寸法をそのまま渡す", () => {
    const [page] = toViewerPages("第1話", [image()], formatPageTitle);

    expect(page?.src).toBe("/images/episodes/IMG_001?token=abc");
    expect(page?.mimeType).toBe("image/jpeg");
    expect(page?.width).toBe(1200);
    expect(page?.height).toBe(1800);
  });

  it("プレースホルダーは持たせない", () => {
    const [page] = toViewerPages("第1話", [image()], formatPageTitle);

    expect(page?.placeholder).toBeUndefined();
  });

  it("寸法が記録されていない画像は寸法を伏せる", () => {
    const [page] = toViewerPages(
      "第1話",
      [image({ height: 0, width: 0 })],
      formatPageTitle
    );

    expect(page?.width).toBeUndefined();
    expect(page?.height).toBeUndefined();
  });

  it("Content-Type が空の画像は mimeType を伏せる", () => {
    const [page] = toViewerPages(
      "第1話",
      [image({ contentType: "" })],
      formatPageTitle
    );

    expect(page?.mimeType).toBeUndefined();
  });
});
