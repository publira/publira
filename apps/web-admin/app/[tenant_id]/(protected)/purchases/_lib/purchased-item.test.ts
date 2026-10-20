import { describe, expect, it } from "vitest";

import { getMessagesFor } from "#lib/messages";
import type { PurchaseItem, PurchasedItem } from "#lib/purchase";

import { purchasedItemHref, purchasedItemLabel } from "./purchased-item";

const purchase = (item: PurchasedItem): PurchaseItem => ({
  currency: "JPY",
  expiresAt: "",
  id: "018f0e6a-5000-7000-8000-000000000001",
  item,
  price: 500,
  provider: "stripe",
  purchasedAt: "2026-03-01T12:00:00Z",
  readerEmail: "reader@example.com",
  readerName: "Reader",
  readerPublicId: "READER001",
  refundable: true,
  refundedAmount: 0,
  refundedAt: "",
  revocationReason: "",
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series 1",
  store: "",
  test: false,
});

describe("purchasedItemLabel", () => {
  it("names an episode or a volume by its title", async () => {
    const t = await getMessagesFor("en");

    expect(
      purchasedItemLabel(
        purchase({
          kind: "episode",
          publicId: "EPISODE001",
          title: "Episode 1",
        }),
        t
      )
    ).toBe("Episode 1");
    expect(
      purchasedItemLabel(
        purchase({ kind: "volume", publicId: "VOLUME001", title: "Volume 1" }),
        t
      )
    ).toBe("Volume 1");
  });

  it("falls back to the public ID when the title is empty", async () => {
    const t = await getMessagesFor("en");

    expect(
      purchasedItemLabel(
        purchase({ kind: "volume", publicId: "VOLUME001", title: "" }),
        t
      )
    ).toBe("VOLUME001");
  });

  it("says how many episodes the rest of a series came to", async () => {
    const t = await getMessagesFor("en");

    expect(
      purchasedItemLabel(
        purchase({ episodeCount: 12, kind: "series_bundle" }),
        t
      )
    ).toBe("Remaining episodes (12)");
  });
});

describe("purchasedItemHref", () => {
  it("opens the episode, the volume, or the series of the rest of it", () => {
    expect(
      purchasedItemHref(
        purchase({ kind: "episode", publicId: "EPISODE001", title: "" })
      )
    ).toBe("/series/SERIES001/episodes/EPISODE001");
    expect(
      purchasedItemHref(
        purchase({ kind: "volume", publicId: "VOLUME001", title: "" })
      )
    ).toBe("/series/SERIES001/volumes/VOLUME001");
    expect(
      purchasedItemHref(purchase({ episodeCount: 3, kind: "series_bundle" }))
    ).toBe("/series/SERIES001");
  });
});
