import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROMOTION_CODE_MAX_SALES } from "#lib/promotion-code";

import {
  quotableVolumeIds,
  toVolumePromotionCodeOffer,
} from "./volume-promotion-code-offer";

const { mockQuoteVolumePromotionCode } = vi.hoisted(() => ({
  mockQuoteVolumePromotionCode: vi.fn(),
}));

vi.mock("#lib/promotion-code-quote", () => ({
  quoteVolumePromotionCode: mockQuoteVolumePromotionCode,
}));

describe("quotableVolumeIds", () => {
  it("leaves out a volume every episode of which the reader owns", () => {
    expect(
      quotableVolumeIds(
        [
          { episodeIds: ["EP_1", "EP_2"], id: "OWNED" },
          { episodeIds: ["EP_2", "EP_3"], id: "PARTLY_OWNED" },
          { episodeIds: [], id: "EMPTY" },
        ],
        new Set(["EP_1", "EP_2"])
      )
    ).toEqual(["PARTLY_OWNED", "EMPTY"]);
  });

  it("stops at the most one lookup quotes", () => {
    const volumes = Array.from(
      { length: PROMOTION_CODE_MAX_SALES + 1 },
      (_, index) => ({ episodeIds: [`EP_${index}`], id: `VOLUME_${index}` })
    );

    expect(quotableVolumeIds(volumes, new Set())).toHaveLength(
      PROMOTION_CODE_MAX_SALES
    );
  });
});

describe("toVolumePromotionCodeOffer", () => {
  const input = {
    code: "SPRING10",
    sessionId: "session-token",
    tenantId: "TENANT_001",
    volumeIds: ["VOLUME_1"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spends no lookup while the URL carries no code", async () => {
    await expect(
      toVolumePromotionCodeOffer({ ...input, code: "" })
    ).resolves.toEqual({ kind: "none" });
    expect(mockQuoteVolumePromotionCode).not.toHaveBeenCalled();
  });

  it("quotes the code the URL carried", async () => {
    const state = {
      code: "SPRING10",
      kind: "applied",
      quotes: { VOLUME_1: { listPrice: 350, price: 280 } },
    };

    mockQuoteVolumePromotionCode.mockResolvedValueOnce(state);

    await expect(toVolumePromotionCodeOffer(input)).resolves.toEqual(state);
  });

  it("leaves the field empty for a session that expired", async () => {
    mockQuoteVolumePromotionCode.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(toVolumePromotionCodeOffer(input)).resolves.toEqual({
      kind: "none",
    });
  });
});
