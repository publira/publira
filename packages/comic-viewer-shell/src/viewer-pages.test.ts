import { describe, expect, it } from "vitest";

import { toViewerPages } from "./viewer-pages";
import type { ViewerPageImage } from "./viewer-pages";

/** Stands in for the caller's catalog entry. */
const formatPageTitle = ({ page, title }: { page: number; title: string }) =>
  `${title}, page ${page}`;

const image = (overrides: Partial<ViewerPageImage> = {}): ViewerPageImage => ({
  contentType: "image/jpeg",
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
      [image({ id: "IMG_001" }), image({ id: "IMG_002" })],
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

  it("offers image-server's renditions up to the stored width, which is the widest", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ imageUrl: "/images/episodes/IMG_001?t=abc", width: 1200 })],
      formatPageTitle
    );

    expect(page?.srcset?.split(", ")).toEqual([
      "/images/episodes/IMG_001?t=abc&w=480&fit=scale-down 480w",
      "/images/episodes/IMG_001?t=abc&w=720&fit=scale-down 720w",
      "/images/episodes/IMG_001?t=abc&w=1080&fit=scale-down 1080w",
      "/images/episodes/IMG_001?t=abc&w=1200&fit=scale-down 1200w",
    ]);
  });

  it("offers the renditions of a page on a tenant's image host", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [
        image({
          imageUrl: "https://images.example.com/images/episodes/IMG_001?t=abc",
          width: 720,
        }),
      ],
      formatPageTitle
    );

    expect(page?.srcset?.split(", ")).toEqual([
      "https://images.example.com/images/episodes/IMG_001?t=abc&w=480&fit=scale-down 480w",
      "https://images.example.com/images/episodes/IMG_001?t=abc&w=720&fit=scale-down 720w",
    ]);
  });

  it("offers a page stored wider than every step of the ladder at its stored width too", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ imageUrl: "/images/episodes/IMG_001", width: 4000 })],
      formatPageTitle
    );

    expect(
      page?.srcset?.split(", ").map((entry) => entry.split(" ")[1])
    ).toEqual([
      "480w",
      "720w",
      "1080w",
      "1440w",
      "2160w",
      "2880w",
      "3840w",
      "4000w",
    ]);
  });

  it("offers a page with no stored width the whole ladder", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ height: 0, imageUrl: "/images/episodes/IMG_001", width: 0 })],
      formatPageTitle
    );

    expect(
      page?.srcset?.split(", ").map((entry) => entry.split(" ")[1])
    ).toEqual(["480w", "720w", "1080w", "1440w", "2160w", "2880w", "3840w"]);
  });

  it("offers no renditions of an image image-server does not serve", () => {
    const [page] = toViewerPages(
      "Episode 1",
      [image({ imageUrl: "blob:https://example.test/IMG_001" })],
      formatPageTitle
    );

    expect(page?.srcset).toBeUndefined();
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
