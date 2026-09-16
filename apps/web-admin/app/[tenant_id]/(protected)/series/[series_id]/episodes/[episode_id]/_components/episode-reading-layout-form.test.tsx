// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render as renderBase, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EpisodeReadingLayoutForm } from "./episode-reading-layout-form";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

const action = () => Promise.resolve(null);

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
    render(
      <EpisodeReadingLayoutForm
        action={action}
        episodePublicId="EP001"
        initialLayout={{ readingDirection: "" }}
        pageCount={24}
        seriesLayout={{ readingDirection: "ltr", spreadStartIndex: 1 }}
        seriesPublicId="SERIES001"
      />
    );

    expect(posted("reading_direction")).toEqual([""]);
    expect(posted("spread_start_source")).toEqual(["series"]);
    expect(
      await screen.findByText("Follow the series (Left to right)")
    ).toBeDefined();
    expect(await screen.findByText("Follow the series (page 2)")).toBeDefined();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("opens on the overrides the episode states, bounded by its pages", () => {
    render(
      <EpisodeReadingLayoutForm
        action={action}
        episodePublicId="EP001"
        initialLayout={{ readingDirection: "rtl", spreadStartIndex: 0 }}
        pageCount={24}
        seriesLayout={{ readingDirection: "ltr", spreadStartIndex: 1 }}
        seriesPublicId="SERIES001"
      />
    );

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
    render(
      <EpisodeReadingLayoutForm
        action={action}
        episodePublicId="EP001"
        initialLayout={{ readingDirection: "" }}
        pageCount={24}
        seriesPublicId="SERIES001"
      />
    );

    expect(await screen.findAllByText("Follow the series")).toHaveLength(2);
  });

  // The server refuses any index for an episode with no pages, so the form
  // does not offer one.
  it("offers only following the series before any page is added", async () => {
    render(
      <EpisodeReadingLayoutForm
        action={action}
        episodePublicId="EP001"
        initialLayout={{ readingDirection: "" }}
        pageCount={0}
        seriesLayout={{ readingDirection: "rtl", spreadStartIndex: 1 }}
        seriesPublicId="SERIES001"
      />
    );

    expect(
      await screen.findByText(
        "Add page images before setting where this episode's spreads start."
      )
    ).toBeDefined();
    expect(screen.queryByText("Set for this episode")).toBeNull();
  });
});
