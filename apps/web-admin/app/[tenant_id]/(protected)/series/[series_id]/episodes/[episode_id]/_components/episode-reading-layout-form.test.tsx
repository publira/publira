// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeReadingLayoutForm } from "./episode-reading-layout-form";

vi.mock("#lib/messages", () => ({
  getMessagesFor: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

const action = () => Promise.resolve(null);

const renderForm = async (
  props: Pick<
    Parameters<typeof EpisodeReadingLayoutForm>[0],
    "initialLayout" | "pageCount" | "seriesLayout"
  >
) =>
  render(
    await EpisodeReadingLayoutForm({
      action,
      episodePublicId: "EP001",
      locale: "en",
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
      ...props,
    })
  );

/** What the form would post under one field name, in document order. */
const posted = (name: string) =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[type="hidden"][name="${name}"]`
    ),
  ].map((input) => input.value);

afterEach(() => {
  cleanup();
});

describe("EpisodeReadingLayoutForm", () => {
  // An operator should not have to open the series to learn what following it
  // means for this episode.
  it("names what the episode inherits where it overrides nothing", async () => {
    await renderForm({
      initialLayout: { readingDirection: "" },
      pageCount: 24,
      seriesLayout: { readingDirection: "ltr", spreadStartIndex: 1 },
    });

    expect(posted("reading_direction")).toEqual([""]);
    expect(posted("spread_start_source")).toEqual(["series"]);
    expect(
      screen.getByRole("combobox", { name: "Reading direction" }).textContent
    ).toBe("Follow the series (Left to right)");
    expect(
      screen.getByRole("combobox", { name: "Spreads start" }).textContent
    ).toBe("Follow the series (page 2)");
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("opens on the overrides the episode states, bounded by its pages", async () => {
    await renderForm({
      initialLayout: { readingDirection: "rtl", spreadStartIndex: 0 },
      pageCount: 24,
      seriesLayout: { readingDirection: "ltr", spreadStartIndex: 1 },
    });

    expect(posted("reading_direction")).toEqual(["rtl"]);
    expect(posted("spread_start_source")).toEqual(["episode"]);
    const page = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: /Spreads start at page/u,
    });
    expect(page.value).toBe("1");
    expect(page.min).toBe("1");
    expect(page.max).toBe("24");
  });

  // A series read that failed must not put a guessed value in its place.
  it("says only that it follows the series when the series could not be read", async () => {
    await renderForm({
      initialLayout: { readingDirection: "" },
      pageCount: 24,
    });

    expect(
      screen.getByRole("combobox", { name: "Reading direction" }).textContent
    ).toBe("Follow the series");
    expect(
      screen.getByRole("combobox", { name: "Spreads start" }).textContent
    ).toBe("Follow the series");
  });

  // The server refuses any index for an episode with no pages.
  it("says pages come first when the episode has none", async () => {
    await renderForm({
      initialLayout: { readingDirection: "" },
      pageCount: 0,
      seriesLayout: { readingDirection: "rtl", spreadStartIndex: 1 },
    });

    expect(
      screen.getByText(
        "Add page images before setting where this episode's spreads start."
      )
    ).toBeDefined();
  });
});
