// @vitest-environment jsdom

import { getMessage } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeriesListItem } from "#lib/catalog";

import { SeriesShelf } from "./series-shelf";

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
  }) => getMessage(sharedCatalog("en"), message, values),
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

const series = (overrides: Partial<SeriesListItem> = {}): SeriesListItem => ({
  creatorNames: ["Jane Doe"],
  creators: [],
  freeEpisodeCount: 0,
  labelName: "",
  publicId: "SERIES01",
  synopsis: "A synopsis.",
  title: "Published Series",
  ...overrides,
});

describe("SeriesShelf", () => {
  it("Says how many episodes of a series can be read without paying", () => {
    render(
      <SeriesShelf
        locale="en"
        series={[series({ freeEpisodeCount: 3, title: "Free Series" })]}
      />
    );

    expect(screen.getByText("3 free episodes")).not.toBeNull();
  });

  it("Leaves a series with no free episode without a badge", () => {
    render(<SeriesShelf locale="en" series={[series()]} />);

    expect(screen.queryByText(/free episodes/u)).toBeNull();
  });

  it("Keeps the count inside the link to the series", () => {
    render(
      <SeriesShelf
        locale="en"
        series={[series({ freeEpisodeCount: 2, publicId: "SERIES02" })]}
      />
    );

    expect(
      screen
        .getByRole("link", { name: /2 free episodes/u })
        .getAttribute("href")
    ).toBe("/series/SERIES02");
  });

  it("Marks a rated series with its age rating inside the link", () => {
    render(
      <SeriesShelf
        locale="en"
        series={[series({ ageRating: "r18", publicId: "SERIES18" })]}
      />
    );

    expect(
      screen.getByRole("link", { name: /R18/u }).getAttribute("href")
    ).toBe("/series/SERIES18");
  });
});
