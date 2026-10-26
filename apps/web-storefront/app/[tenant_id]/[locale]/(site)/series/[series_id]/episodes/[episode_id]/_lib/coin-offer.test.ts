import { describe, expect, it } from "vitest";

import type { CoinSettingsItem } from "#lib/coins";

import {
  coinsCarryShu,
  episodeOffersCoins,
  offersCoinPayment,
  toCoinOffer,
} from "./coin-offer";

const settings: CoinSettingsItem = {
  coinName: "Points",
  disclosures: {
    contact: "support@example.com",
    issuerName: "Example Inc.",
    notice: "",
    termsUrl: "https://example.com/terms",
  },
  expiryDays: 180,
  packs: [
    {
      bonusCoins: 0,
      coins: 100,
      currency: "JPY",
      id: "pack-100",
      price: 100,
      publicId: "PACK100",
    },
    {
      bonusCoins: 100,
      coins: 500,
      currency: "JPY",
      id: "pack-600",
      price: 500,
      publicId: "PACK600",
    },
  ],
  selling: true,
};

const episode = { coinName: "Points", coinPrice: 300, coinRentalPrice: 0 };

const balance = (coins: number, owedCoins = 0) =>
  ({
    ok: true,
    value: {
      coinName: "Points",
      coins,
      nearestExpiryAt: "",
      nearestExpiryCoins: 0,
      owedCoins,
    },
  }) as const;

describe("episodeOffersCoins", () => {
  it("asks about coins on an episode priced in them that the site sells", () => {
    expect(
      episodeOffersCoins({
        coinPrice: 300,
        coinRentalPrice: 0,
        purchaseSurface: "all",
      })
    ).toBe(true);
  });

  it("asks nothing while the tenant offers no coins", () => {
    expect(
      episodeOffersCoins({
        coinPrice: 0,
        coinRentalPrice: 0,
        purchaseSurface: "all",
      })
    ).toBe(false);
  });

  it("asks nothing for an episode the app alone sells", () => {
    expect(
      episodeOffersCoins({
        coinPrice: 300,
        coinRentalPrice: 0,
        purchaseSurface: "app",
      })
    ).toBe(false);
  });
});

describe("toCoinOffer", () => {
  it("offers the payment, and no pack, to a reader whose coins cover it", () => {
    const offer = toCoinOffer({
      acceptsPayments: true,
      balance: balance(300),
      episode,
      idempotencyKey: "key",
      settings,
    });

    expect(offer).toMatchObject({ kind: "offer", needed: 0, price: 300 });
    expect(offer?.kind === "offer" && offer.pack).toBeUndefined();
    expect(coinsCarryShu(offer)).toBe(true);
  });

  it("offers the smallest pack that covers what the reader is short of", () => {
    const offer = toCoinOffer({
      acceptsPayments: true,
      balance: balance(150),
      episode,
      idempotencyKey: "key",
      settings,
    });

    expect(offer).toMatchObject({
      kind: "offer",
      needed: 150,
      pack: { id: "pack-600" },
      packsOnSale: true,
    });
    expect(coinsCarryShu(offer)).toBe(false);
  });

  it("counts what the next pack pays back of a refunded one", () => {
    const offer = toCoinOffer({
      acceptsPayments: true,
      balance: balance(250, 80),
      episode,
      idempotencyKey: "key",
      settings,
    });

    expect(offer).toMatchObject({ needed: 130, pack: { id: "pack-600" } });
  });

  it("sells no pack on a site that takes no payments, and offers no way in to a reader short of coins there", () => {
    const offer = toCoinOffer({
      acceptsPayments: false,
      balance: balance(0),
      episode,
      idempotencyKey: "key",
      settings,
    });

    expect(offer).toMatchObject({ pack: undefined, packsOnSale: false });
    expect(offersCoinPayment(offer)).toBe(false);
  });

  it("offers a rental the coins cover even when the permanent copy is short", () => {
    const offer = toCoinOffer({
      acceptsPayments: true,
      balance: balance(120),
      episode: { ...episode, coinRentalPrice: 100 },
      idempotencyKey: "key",
      settings,
    });

    expect(coinsCarryShu(offer)).toBe(true);
  });

  it("offers nothing once the API answers no balance", () => {
    expect(
      toCoinOffer({
        acceptsPayments: true,
        balance: { ok: true, value: null },
        episode,
        idempotencyKey: "key",
        settings,
      })
    ).toBeUndefined();
  });

  it("words a balance that could not be read", () => {
    expect(
      toCoinOffer({
        acceptsPayments: true,
        balance: { message: "Could not load your balance.", ok: false },
        episode,
        idempotencyKey: "key",
        settings,
      })
    ).toEqual({ kind: "failed", message: "Could not load your balance." });
  });
});
