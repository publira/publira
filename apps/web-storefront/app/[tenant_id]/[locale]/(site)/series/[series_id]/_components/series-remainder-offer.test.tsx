// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantSales } from "#lib/app-payments";

import { SeriesRemainderOffer } from "./series-remainder-offer";

const { mockGetMySeriesPurchaseState } = vi.hoisted(() => ({
  mockGetMySeriesPurchaseState: vi.fn(),
}));

// `<Message>` is an async Server Component only the Next.js compiler can
// provide. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#components/locale-field", () => ({
  LocaleField: () => <input name="locale" type="hidden" value="en" />,
}));

vi.mock("#lib/series-purchases", () => ({
  getMySeriesPurchaseState: mockGetMySeriesPurchaseState,
}));

vi.mock("../_lib/actions", () => ({
  startSeriesRemainderCheckoutAction: vi.fn(),
}));

afterEach(cleanup);

/** A site that takes payments in yen. */
const SELLING: TenantSales = { app: false, currency: "JPY", web: true };

const renderOffer = async (sales = SELLING) =>
  render(
    <div>
      {await SeriesRemainderOffer({
        locale: "en",
        sales,
        seriesId: "SERIES_ID",
        seriesPublicId: "SERIES_001",
        tenantId: "TENANT_001",
      })}
    </div>
  );

describe("SeriesRemainderOffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the remaining episodes at the discounted price, and says what the discount takes off", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce({
      entitledEpisodeIds: new Set(),
      ok: true,
      remainder: {
        discountPercent: 10,
        episodeCount: 4,
        listPrice: 900,
        price: 810,
      },
    });

    await renderOffer();

    expect(
      screen.getByRole("button", {
        name: "Buy remaining episodes (4) for ¥810",
      })
    ).toBeTruthy();
    expect(
      screen.getByText("10% off the ¥900 they cost one by one")
    ).toBeTruthy();
    expect(mockGetMySeriesPurchaseState).toHaveBeenCalledWith(
      "TENANT_001",
      "SERIES_ID",
      "en"
    );
  });

  it("says nothing about a discount the series does not take", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce({
      entitledEpisodeIds: new Set(),
      ok: true,
      remainder: {
        discountPercent: 0,
        episodeCount: 2,
        listPrice: 600,
        price: 600,
      },
    });

    await renderOffer();

    expect(
      screen.getByRole("button", {
        name: "Buy remaining episodes (2) for ¥600",
      })
    ).toBeTruthy();
    expect(screen.queryByText(/one by one/u)).toBeNull();
  });

  it("offers nothing when there is nothing left to sell", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce({
      entitledEpisodeIds: new Set(["EPISODE_ID_1"]),
      ok: true,
      remainder: null,
    });

    await renderOffer();

    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["takes no payments", { app: false, currency: "JPY", web: false }],
    ["could not be read", { app: false, currency: null, web: true }],
  ] satisfies [string, TenantSales][])(
    "offers nothing, and asks nothing, on a site that %s",
    async (_, sales) => {
      await renderOffer(sales);

      expect(screen.queryByRole("button")).toBeNull();
      expect(mockGetMySeriesPurchaseState).not.toHaveBeenCalled();
    }
  );

  it("says the price could not be quoted when the read failed", async () => {
    mockGetMySeriesPurchaseState.mockResolvedValueOnce({
      message: "Could not check which episodes you already own.",
      ok: false,
    });

    await renderOffer();

    expect(
      screen.getByText("Could not show the price of the remaining episodes")
    ).toBeTruthy();
    expect(
      screen.getByText("Could not check which episodes you already own.")
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
