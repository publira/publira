// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeReactionControl } from "./episode-reaction-control";

const { mockGetMyEpisodeRating } = vi.hoisted(() => ({
  mockGetMyEpisodeRating: vi.fn(),
}));

// `<Message>` and `getLocale()` are async Server Components / root-parameter
// reads that only the Next.js compiler can provide. The catalog is the real
// one, so the assertions stay on the copy a reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/locale", () => ({
  getLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/episode-rating", () => ({
  getMyEpisodeRating: mockGetMyEpisodeRating,
}));

vi.mock("#lib/episode-rating-actions", () => ({
  rateEpisodeAction: vi.fn(),
}));

vi.mock("./locale-context", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("./client-message", () => ({
  useClientMessages: () => bindMessages(sharedCatalog("en"), "en"),
}));

afterEach(cleanup);

const renderControl = async () =>
  render(
    <div>
      {await EpisodeReactionControl({
        episodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        ratingCount: 4,
        returnTo: "/series/SERIES_001/episodes/EP_010",
        seriesPublicId: "SERIES_001",
        tenantId: "TENANT_001",
      })}
    </div>
  );

const signedInRating = {
  mode: "single",
  ok: true,
  ratingCount: 4,
  readerCredited: false,
  readerIsStaff: false,
  score: 0,
  signedIn: true,
} as const;

describe("EpisodeReactionControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the reaction to a reader who is not the episode's author", async () => {
    mockGetMyEpisodeRating.mockResolvedValueOnce(signedInRating);

    await renderControl();

    expect(
      screen.getByRole("button", { name: /React to this episode/u })
    ).toBeTruthy();
  });

  it("withholds the reaction from the episode's author", async () => {
    mockGetMyEpisodeRating.mockResolvedValueOnce({
      ...signedInRating,
      readerCredited: true,
    });

    const { container } = await renderControl();

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("tells a member of staff why there is no reaction in its place", async () => {
    mockGetMyEpisodeRating.mockResolvedValueOnce({
      ...signedInRating,
      readerIsStaff: true,
    });

    await renderControl();

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(
        "You cannot react to episodes while you hold a staff role, so your reading does not count toward the ratings readers see."
      )
    ).toBeTruthy();
  });

  it("withholds the reaction from staff credited on the episode without the notice", async () => {
    mockGetMyEpisodeRating.mockResolvedValueOnce({
      ...signedInRating,
      readerCredited: true,
      readerIsStaff: true,
    });

    const { container } = await renderControl();

    expect(container.textContent).toBe("");
  });
});
