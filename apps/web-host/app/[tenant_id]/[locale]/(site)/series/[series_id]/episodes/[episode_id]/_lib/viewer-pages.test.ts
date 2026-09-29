import { describe, expect, it } from "vitest";

import type { EpisodeImageItem } from "#lib/catalog";

import { toViewerPages } from "./viewer-pages";

/** Stands in for the caller's catalog entry (`host.episode.viewer.page_title`). */
const formatPageTitle = ({ page, title }: { page: number; title: string }) =>
  `${title}, page ${page}`;

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
  it("Assign sequential page names to the distribution order", () => {
    const pages = toViewerPages(
      "Episode 1",
      [image({ id: "IMG_001" }), image({ displayOrder: 2, id: "IMG_002" })],
      formatPageTitle
    );

    expect(pages.map((page) => page.id)).toEqual(["IMG_001", "IMG_002"]);
    expect(pages.map((page) => page.title)).toEqual([
      "Episode 1, page 1",
      "Episode 1, page 2",
    ]);
  });

  it("Pass the URL and dimensions of the body image as is", () => {
    const [page] = toViewerPages("Episode 1", [image()], formatPageTitle);

    expect(page?.src).toBe("/images/episodes/IMG_001?token=abc");
    expect(page?.mimeType).toBe("image/jpeg");
    expect(page?.width).toBe(1200);
    expect(page?.height).toBe(1800);
  });

  it("Does not have placeholders", () => {
    const [page] = toViewerPages("Episode 1", [image()], formatPageTitle);

    expect(page?.placeholder).toBeUndefined();
  });

  it("For images that do not have dimensions recorded, hide the dimensions.", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ height: 0, width: 0 })],
      formatPageTitle
    );

    expect(page?.width).toBeUndefined();
    expect(page?.height).toBeUndefined();
  });

  it("Images with empty Content-Type hide mimeType", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ contentType: "" })],
      formatPageTitle
    );

    expect(page?.mimeType).toBeUndefined();
  });
});
