// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenreFeaturedSeriesItem, PublishedGenreItem } from "#lib/catalog";

import { GenreTiles } from "./genre-tiles";

// `<Message>` is an async Server Component, which the client renderer cannot
// mount. It resolves through the real catalog here, so the assertions stay on
// the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

const cover = (publicId: string): GenreFeaturedSeriesItem => ({
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 800,
      label: "600",
      url: `/images/series/${publicId}/portrait/600`,
      variantType: "portrait",
      width: 600,
    },
  ],
  publicId,
});

const genre = (
  overrides: Partial<PublishedGenreItem> = {}
): PublishedGenreItem => ({
  featuredSeries: [],
  name: "Fantasy",
  publicId: "GENRE01",
  publishedSeriesCount: 12,
  slug: "fantasy",
  ...overrides,
});

const tileLink = (name: RegExp) => screen.getByRole("link", { name });

describe("GenreTiles", () => {
  it("Links each tile to its genre by the name and the count", () => {
    render(<GenreTiles genres={[genre()]} />);

    expect(
      tileLink(/Fantasy\s*12 published series/u).getAttribute("href")
    ).toBe("/genres/GENRE01");
  });

  it("Keeps the tenant's own order", () => {
    render(
      <GenreTiles
        genres={[
          genre({ name: "Romance", publicId: "GENRE02" }),
          genre({ name: "Action", publicId: "GENRE03" }),
        ]}
      />
    );

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href"))
    ).toStrictEqual(["/genres/GENRE02", "/genres/GENRE03"]);
  });

  it("Draws four covers in the order they came, hidden from the link's name", () => {
    render(
      <GenreTiles
        genres={[
          genre({
            featuredSeries: [
              cover("SERIES01"),
              cover("SERIES02"),
              cover("SERIES03"),
              cover("SERIES04"),
            ],
          }),
        ]}
      />
    );

    const images = [...tileLink(/Fantasy/u).querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toStrictEqual([
      "/images/series/SERIES01/portrait/600",
      "/images/series/SERIES02/portrait/600",
      "/images/series/SERIES03/portrait/600",
      "/images/series/SERIES04/portrait/600",
    ]);
    expect(images.every((image) => image.getAttribute("alt") === "")).toBe(
      true
    );
  });

  it("Leaves the cells a genre cannot fill as flat frames", () => {
    render(
      <GenreTiles
        genres={[
          genre({ featuredSeries: [cover("SERIES01"), cover("SERIES02")] }),
        ]}
      />
    );

    const link = tileLink(/Fantasy/u);
    expect(link.querySelectorAll("img")).toHaveLength(2);
    // The two frames standing in for the missing covers carry nothing.
    const flat = [...link.querySelectorAll('[aria-hidden="true"]')];
    expect(flat).toHaveLength(2);
    expect(flat.every((frame) => frame.textContent === "")).toBe(true);
  });

  it("Draws a series without artwork as a flat cell in its place", () => {
    render(
      <GenreTiles
        genres={[
          genre({
            featuredSeries: [
              { eyeCatchImageVariants: undefined, publicId: "SERIES01" },
              cover("SERIES02"),
            ],
          }),
        ]}
      />
    );

    const link = tileLink(/Fantasy/u);
    expect(link.querySelectorAll("img")).toHaveLength(1);
    expect(link.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it("Puts the genre's name in one flat frame when none of its series has artwork", () => {
    render(
      <GenreTiles
        genres={[
          genre({
            featuredSeries: [
              { eyeCatchImageVariants: undefined, publicId: "SERIES01" },
              { eyeCatchImageVariants: undefined, publicId: "SERIES02" },
            ],
          }),
        ]}
      />
    );

    const flat = [
      ...tileLink(/Fantasy/u).querySelectorAll('[aria-hidden="true"]'),
    ];
    expect(flat).toHaveLength(1);
    expect(flat[0]?.textContent).toBe("Fantasy");
  });

  it("Puts the genre's name in one flat frame when it has no cover", () => {
    render(<GenreTiles genres={[genre({ publishedSeriesCount: 0 })]} />);

    const link = tileLink(/Fantasy\s*0 published series/u);
    expect(link.querySelectorAll("img")).toHaveLength(0);
    const flat = [...link.querySelectorAll('[aria-hidden="true"]')];
    expect(flat).toHaveLength(1);
    expect(flat[0]?.textContent).toBe("Fantasy");
  });
});
