// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantSales } from "#lib/app-payments";
import type { EpisodeRatingStatusResult } from "#lib/episode-rating";

import { EpisodeTipControl } from "./episode-tip-control";

const { mockGetMyEpisodeRating } = vi.hoisted(() => ({
  mockGetMyEpisodeRating: vi.fn<() => Promise<EpisodeRatingStatusResult>>(),
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

vi.mock("#components/locale-context", () => ({ useLocale: () => "en" }));

vi.mock("#lib/locale", () => ({ getLocale: () => Promise.resolve("en") }));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/episode-rating", () => ({
  getMyEpisodeRating: mockGetMyEpisodeRating,
}));

vi.mock("../_lib/actions", () => ({ startTipCheckoutAction: vi.fn() }));

afterEach(cleanup);

const reader: EpisodeRatingStatusResult = {
  mode: "single",
  ok: true,
  ratingCount: 0n,
  readerCredited: false,
  readerIsStaff: false,
  score: 0,
  signedIn: true,
};

const episode = {
  credits: [
    { name: "Mina Ito", publicId: "A", roleName: "Story" },
    { name: "Mina Ito", publicId: "A", roleName: "Art" },
    { name: "Ken Sato", publicId: "B", roleName: "Art" },
  ],
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  publicId: "EPISODE_001",
};

const sales: TenantSales = {
  app: false,
  currency: "JPY",
  taxIncluded: false,
  web: true,
};

const renderControl = async (
  overrides: Partial<Parameters<typeof EpisodeTipControl>[0]> = {}
) => {
  const { container } = render(
    await EpisodeTipControl({
      amounts: [100, 300, 1000],
      episode,
      returnTo: "/series/SERIES_001/episodes/EPISODE_001",
      sales,
      seriesPublicId: "SERIES_001",
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...overrides,
    })
  );

  return container;
};

const CONTROL = { name: "Tip the Authors" } as const;

describe("EpisodeTipControl", () => {
  beforeEach(() => {
    mockGetMyEpisodeRating.mockReset();
    mockGetMyEpisodeRating.mockResolvedValue(reader);
  });

  it("opens a dialog naming each Author once and offering each amount as a submit button", async () => {
    await renderControl();

    fireEvent.click(screen.getByRole("button", CONTROL));

    const dialog = await screen.findByRole("dialog", CONTROL);

    expect(dialog.textContent).toContain("To Mina Ito and Ken Sato");

    const amounts = ["¥100", "¥300", "¥1,000"].map((name) =>
      screen.getByRole("button", { name })
    );

    expect(amounts.map((button) => button.getAttribute("type"))).toEqual([
      "submit",
      "submit",
      "submit",
    ]);
    expect(amounts.map((button) => button.getAttribute("name"))).toEqual([
      "amount",
      "amount",
      "amount",
    ]);
    expect(amounts.map((button) => button.getAttribute("value"))).toEqual([
      "100",
      "300",
      "1000",
    ]);
  });

  it("leaves the Authors out of a dialog on an episode that credits nobody", async () => {
    await renderControl({ episode: { ...episode, credits: [] } });

    fireEvent.click(screen.getByRole("button", CONTROL));

    const dialog = await screen.findByRole("dialog", CONTROL);

    expect(dialog.textContent).not.toMatch(/\bTo\b/u);
  });

  it("sends a guest to sign in and back to the episode", async () => {
    mockGetMyEpisodeRating.mockResolvedValue({ ...reader, signedIn: false });

    await renderControl();

    expect(screen.getByRole("link", CONTROL).getAttribute("href")).toContain(
      encodeURIComponent("/series/SERIES_001/episodes/EPISODE_001")
    );
    expect(screen.queryByRole("button", CONTROL)).toBeNull();
  });

  it.each([
    ["takes no tips", { amounts: [] }],
    ["has no provider ready", { sales: { ...sales, web: false } }],
    ["could not be read", { sales: { ...sales, currency: null } }],
  ])("offers nothing on a site that %s", async (_, overrides) => {
    const container = await renderControl(overrides);

    expect(container.textContent).toBe("");
    expect(mockGetMyEpisodeRating).not.toHaveBeenCalled();
  });

  it("offers nothing to a reader the episode credits", async () => {
    mockGetMyEpisodeRating.mockResolvedValue({
      ...reader,
      readerCredited: true,
    });

    const container = await renderControl();

    expect(container.textContent).toBe("");
  });

  it("offers nothing to a reader it could not place", async () => {
    mockGetMyEpisodeRating.mockResolvedValue({ message: "failed", ok: false });

    const container = await renderControl();

    expect(container.textContent).toBe("");
  });
});
