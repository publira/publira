// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RankedSeriesItem, RankedSeriesPage } from "#lib/catalog";

import { GenreRanking } from "./genre-ranking";

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
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#components/locale-context", () => ({
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

const GENRE_ID = "GENRE0000001";

const ranked = (rank: number): RankedSeriesItem => ({
  rank,
  series: {
    credits: [],
    freeEpisodeCount: 0,
    labelName: "",
    publicId: `SERIES0${rank}`,
    synopsis: "A synopsis.",
    title: `Series ${rank}`,
  },
});

const page = (rankedSeries: RankedSeriesItem[]): RankedSeriesPage => ({
  computedAt: rankedSeries.length > 0 ? "2026-10-02T21:00:00Z" : "",
  nextToken: "",
  periodEnd: "2026-10-02",
  periodStart: "2026-09-26",
  previousToken: "",
  rankedSeries,
});

describe("GenreRanking", () => {
  it("Opens on the genre's leaders in the order the chart holds them", () => {
    render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{ ok: true, value: page([ranked(1), ranked(2), ranked(3)]) }}
      />
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Popular this week" })
    ).not.toBeNull();
    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector("a")?.getAttribute("href"))
    ).toEqual(["/series/SERIES01", "/series/SERIES02", "/series/SERIES03"]);
    expect(screen.getByText("No. 1")).not.toBeNull();
  });

  it("Puts each series' position inside the link to it", () => {
    render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{ ok: true, value: page([ranked(1), ranked(2)]) }}
      />
    );

    expect(
      screen.getByRole("link", { name: /No\. 2/u }).getAttribute("href")
    ).toBe("/series/SERIES02");
  });

  it("Shows the position the snapshot recorded, leaving the gap an unpublished series left", () => {
    render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{ ok: true, value: page([ranked(1), ranked(3)]) }}
      />
    );

    expect(screen.getByText("No. 3")).not.toBeNull();
    expect(screen.queryByText("No. 2")).toBeNull();
  });

  it("Leads to the weekly ranking narrowed to the genre", () => {
    render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{ ok: true, value: page([ranked(1)]) }}
      />
    );

    expect(
      screen.getByRole("link", { name: "See the ranking" }).getAttribute("href")
    ).toBe(`/ranking?genre=${GENRE_ID}&period=weekly`);
  });

  it("Draws nothing, heading included, for a genre the batch has not ranked", () => {
    const { container } = render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{ ok: true, value: page([]) }}
      />
    );

    expect(container.childElementCount).toBe(0);
  });

  it("Says the chart could not be read instead of hiding the section", () => {
    render(
      <GenreRanking
        genreId={GENRE_ID}
        locale="en"
        result={{
          message: "Could not connect to the server. Please try again later.",
          ok: false,
        }}
      />
    );

    expect(
      screen.getByText("Could not show this genre's ranking")
    ).not.toBeNull();
    expect(
      screen.getByText(
        "Could not connect to the server. Please try again later."
      )
    ).not.toBeNull();
  });
});
