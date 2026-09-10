// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SeriesListItem } from "#lib/catalog";

import { RelatedSeries } from "./related-series";

const { mockListRelatedSeries } = vi.hoisted(() => ({
  mockListRelatedSeries: vi.fn(),
}));

vi.mock("#lib/catalog", () => ({
  listRelatedSeries: mockListRelatedSeries,
}));

// `<Message>` and `getLocale()` are an async Server Component and a
// root-parameter read that only the Next.js compiler can provide. The catalog
// is the real one, so the assertions stay on the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => getMessage(sharedCatalog("en"), message, values),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
  loadHostMessages: () => Promise.resolve(sharedCatalog("en")),
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

afterEach(cleanup);

beforeEach(() => {
  mockListRelatedSeries.mockReset();
});

const series = (overrides: Partial<SeriesListItem> = {}): SeriesListItem => ({
  creatorNames: ["Jane Doe"],
  creators: [],
  freeEpisodeCount: 0,
  labelName: "",
  publicId: "SERIES02",
  synopsis: "A synopsis.",
  title: "Neighbouring Series",
  ...overrides,
});

const renderSection = async (limit = 4) =>
  render(
    await RelatedSeries({
      limit,
      seriesPublicId: "SERIES01",
      tenantId: "TENANT01",
    })
  );

describe("RelatedSeries", () => {
  it("shows the neighbours the server returned, as links to each series", async () => {
    mockListRelatedSeries.mockResolvedValueOnce({
      ok: true,
      value: {
        nextToken: "",
        previousToken: "",
        series: [series(), series({ publicId: "SERIES03", title: "Another" })],
      },
    });

    await renderSection();

    expect(
      screen
        .getByRole("link", { name: /Neighbouring Series/u })
        .getAttribute("href")
    ).toBe("/series/SERIES02");
    expect(screen.getByRole("link", { name: /Another/u })).not.toBeNull();
  });

  it("asks for as many covers as the caller has room for", async () => {
    mockListRelatedSeries.mockResolvedValueOnce({
      ok: true,
      value: { nextToken: "", previousToken: "", series: [series()] },
    });

    await renderSection(3);

    expect(mockListRelatedSeries).toHaveBeenCalledWith("TENANT01", {
      limit: 3,
      locale: "en",
      seriesPublicId: "SERIES01",
    });
  });

  it("says why the section is missing when the read failed", async () => {
    mockListRelatedSeries.mockResolvedValueOnce({
      message: "Could not load the related series. Please try again later.",
      ok: false,
    });

    await renderSection();

    expect(
      screen.getByText("Could not show the related series")
    ).not.toBeNull();
    expect(
      screen.getByText(
        "Could not load the related series. Please try again later."
      )
    ).not.toBeNull();
  });

  it("names the empty catalogue rather than leaving a bare heading", async () => {
    mockListRelatedSeries.mockResolvedValueOnce({
      ok: true,
      value: { nextToken: "", previousToken: "", series: [] },
    });

    await renderSection();

    expect(
      screen.getByText("There are no other series to suggest yet.")
    ).not.toBeNull();
  });
});
