// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreatorCreditItem } from "#lib/creator";

import { CreatorCredits } from "./creator-credits";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const seriesCredit: CreatorCreditItem = {
  roleId: "ROLE-WRITER",
  roleName: "Writer",
  series: { id: "SERIES-A", publicId: "SERIESA", title: "Alpha" },
};

const episodeCredit: CreatorCreditItem = {
  episode: { id: "EPISODE-1", publicId: "EPISODE1", title: "Episode One" },
  roleId: "ROLE-ARTIST",
  roleName: "Artist",
  series: { id: "SERIES-A", publicId: "SERIESA", title: "Alpha" },
};

const renderCredits = async (
  props: Partial<Parameters<typeof CreatorCredits>[0]> = {}
) =>
  render(
    await CreatorCredits({
      credits: [],
      locale: "en",
      pageSize: 20,
      ...props,
    })
  );

describe("CreatorCredits", () => {
  it("links a series credit to the series and an episode credit to the episode", async () => {
    await renderCredits({ credits: [seriesCredit, episodeCredit] });

    const [, seriesRow, episodeRow] = screen.getAllByRole("row");

    expect(seriesRow).toBeDefined();
    expect(episodeRow).toBeDefined();

    if (!(seriesRow && episodeRow)) {
      return;
    }

    expect(within(seriesRow).getByText("The series itself")).toBeDefined();
    expect(within(seriesRow).getByText("Writer")).toBeDefined();
    expect(
      within(seriesRow)
        .getByRole("link", { name: "Open series" })
        .getAttribute("href")
    ).toBe("/series/SERIESA");

    expect(within(episodeRow).getByText("Episode One")).toBeDefined();
    expect(within(episodeRow).getByText("Artist")).toBeDefined();
    expect(
      within(episodeRow)
        .getByRole("link", { name: "Open episode" })
        .getAttribute("href")
    ).toBe("/series/SERIESA/episodes/EPISODE1");
  });

  it("says so for a credit with no role and a title with no translation", async () => {
    await renderCredits({
      credits: [
        {
          episode: { id: "EPISODE-2", publicId: "EPISODE2", title: "" },
          roleId: "",
          roleName: "",
          series: { id: "SERIES-B", publicId: "SERIESB", title: "" },
        },
      ],
    });

    expect(screen.getAllByText("Untitled")).toHaveLength(2);
    expect(screen.getByText("No role")).toBeDefined();
  });

  it("keeps a page link on the section rather than the top of the screen", async () => {
    await renderCredits({
      credits: [seriesCredit],
      nextHref: "?token=next",
    });

    expect(
      screen.getByRole("link", { name: "Next" }).getAttribute("href")
    ).toBe("?token=next#creator-credits");
  });

  it("says nothing credits the author when the list is empty", async () => {
    await renderCredits();

    expect(
      screen.getByText("No series or episode credits this author.")
    ).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  // An empty list next to the error would read as "nothing credits this
  // author", which is what decides whether they can be deleted.
  it("shows a failed read as an error, not as an empty list", async () => {
    await renderCredits({ listErrorMessage: "The API is unavailable." });

    expect(screen.getByText("Could not display the credits")).toBeDefined();
    expect(screen.getByText("The API is unavailable.")).toBeDefined();
    expect(
      screen.queryByText("No series or episode credits this author.")
    ).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
