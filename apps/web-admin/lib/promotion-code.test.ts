import {
  PromotionCodeDiscountKind,
  PromotionCodeTargetKind,
} from "@publira/api-client/admin/promotion-code";
import { PurchaseKind } from "@publira/api-client/admin/types";
import type { PromotionCode } from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreatePromotionCode,
  mockGetAccessToken,
  mockGetPromotionCode,
  mockListPromotionCodeRedemptions,
  mockListPromotionCodes,
  mockPausePromotionCode,
  mockResumePromotionCode,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreatePromotionCode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetPromotionCode: vi.fn(),
  mockListPromotionCodeRedemptions: vi.fn(),
  mockListPromotionCodes: vi.fn(),
  mockPausePromotionCode: vi.fn(),
  mockResumePromotionCode: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    promotionCodes: {
      createPromotionCode: mockCreatePromotionCode,
      getPromotionCode: mockGetPromotionCode,
      listPromotionCodeRedemptions: mockListPromotionCodeRedemptions,
      listPromotionCodes: mockListPromotionCodes,
      pausePromotionCode: mockPausePromotionCode,
      resumePromotionCode: mockResumePromotionCode,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

const CODE_ID = "018f0e6a-7000-7000-8000-000000000001";
const SERIES_ID = "018f0e6a-7000-7000-8000-000000000201";

const promotionCode = (
  overrides: Partial<Omit<PromotionCode, "$typeName" | "$unknown">> = {}
) => ({
  code: "Welcome10",
  createdAt: "2026-02-01T00:00:00Z",
  currency: "JPY",
  discountKind: PromotionCodeDiscountKind.PERCENT,
  discountValue: 10,
  id: CODE_ID,
  limits: {
    endsAt: "",
    maxRedemptions: 0,
    maxRedemptionsPerReader: 1,
    startsAt: "",
  },
  pausedAt: "",
  redemptionCount: 3,
  targetId: "",
  targetKind: PromotionCodeTargetKind.CATALOG,
  targetTitle: "",
  ...overrides,
});

const createInput = {
  code: "WELCOME10",
  currency: "JPY",
  discountKind: "amount",
  discountValue: 100,
  limits: {
    endsAt: "",
    maxRedemptions: 0,
    maxRedemptionsPerReader: 0,
    startsAt: "",
  },
  targetId: SERIES_ID,
  targetKind: "series",
  tenantId: "TENANT001",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listPromotionCodes", () => {
  it("carries the codes' tag, is refetched once a minute old, and maps each code", async () => {
    mockListPromotionCodes.mockResolvedValue({
      nextToken: "next-page",
      previousToken: "",
      promotionCodes: [
        promotionCode(),
        promotionCode({
          discountKind: PromotionCodeDiscountKind.AMOUNT,
          discountValue: 100,
          targetId: SERIES_ID,
          targetKind: PromotionCodeTargetKind.SERIES,
          targetTitle: "Series 1",
        }),
      ],
    });

    const { listPromotionCodes } = await import("./promotion-code");

    const result = await listPromotionCodes("TENANT001", "en", {
      token: "this-page",
    });

    expect(mockListPromotionCodes).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "this-page" },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toMatchObject({
      codes: [
        {
          discount: { kind: "percent", percent: 10 },
          maxRedemptionsPerReader: 1,
          redemptionCount: 3,
          target: { kind: "catalog" },
        },
        {
          discount: { amount: 100, currency: "JPY", kind: "amount" },
          target: { id: SERIES_ID, kind: "series", title: "Series 1" },
        },
      ],
      nextToken: "next-page",
      ok: true,
    });
  });

  it("reports a failure the API classifies as a message instead of throwing", async () => {
    mockListPromotionCodes.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { listPromotionCodes } = await import("./promotion-code");
    const result = await listPromotionCodes("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.codes).toEqual([]);
    expect(result.message).toBeTruthy();
  });

  it("asks for a sign-in when there is no session, without calling the API", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPromotionCodes } = await import("./promotion-code");
    const result = await listPromotionCodes("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockListPromotionCodes).not.toHaveBeenCalled();
  });
});

describe("getPromotionCode", () => {
  it("answers a code the tenant does not hold, or deleted, as none", async () => {
    mockGetPromotionCode.mockRejectedValue(
      new ConnectError("promotion code not found", Code.NotFound)
    );

    const { getPromotionCode } = await import("./promotion-code");

    await expect(getPromotionCode("TENANT001", CODE_ID, "en")).resolves.toEqual(
      { code: null, ok: true }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
  });
});

describe("listPromotionCodeRedemptions", () => {
  it("carries the codes' tag and maps each purchase the code discounted", async () => {
    mockListPromotionCodeRedemptions.mockResolvedValue({
      nextToken: "",
      previousToken: "",
      redemptions: [
        {
          currency: "JPY",
          id: "REDEMPTION001",
          kind: PurchaseKind.RENTAL,
          listPrice: 300,
          price: 270,
          purchaseId: "PURCHASE001",
          readerEmail: "reader@example.com",
          readerPublicId: "READER001",
          redeemedAt: "2026-03-02T12:00:00Z",
          title: "Episode 1",
        },
      ],
    });

    const { listPromotionCodeRedemptions } = await import("./promotion-code");

    const result = await listPromotionCodeRedemptions(
      "TENANT001",
      CODE_ID,
      "en"
    );

    expect(mockCacheTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result.redemptions).toEqual([
      {
        currency: "JPY",
        id: "REDEMPTION001",
        listPrice: 300,
        price: 270,
        purchaseId: "PURCHASE001",
        readerEmail: "reader@example.com",
        readerPublicId: "READER001",
        redeemedAt: "2026-03-02T12:00:00Z",
        rental: true,
        title: "Episode 1",
      },
    ]);
  });
});

describe("createPromotionCode", () => {
  it("sends the code with its discount, target, and limits", async () => {
    mockCreatePromotionCode.mockResolvedValue({
      promotionCode: promotionCode(),
    });

    const { createPromotionCode } = await import("./promotion-code");
    const result = await createPromotionCode(createInput, "en");

    expect(mockCreatePromotionCode).toHaveBeenCalledWith(
      {
        code: "WELCOME10",
        currency: "JPY",
        discountKind: PromotionCodeDiscountKind.AMOUNT,
        discountValue: 100,
        limits: createInput.limits,
        targetId: SERIES_ID,
        targetKind: PromotionCodeTargetKind.SERIES,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
  });

  it("words a code already in use on the code's field", async () => {
    mockCreatePromotionCode.mockRejectedValue(
      new ConnectError(
        "a promotion code is already spelled so",
        Code.AlreadyExists
      )
    );

    const { createPromotionCode } = await import("./promotion-code");
    const result = await createPromotionCode(createInput, "en");

    expect(result).toMatchObject({
      fieldErrors: {
        code: "Another promotion code is already spelled this way. Choose another code.",
      },
      ok: false,
    });
  });

  it.each([
    ["discount_value", "discount_value"],
    ["target_id", "target_id"],
    ["limits.ends_at", "ends_at"],
  ])("words a refusal of %s on the %s field", async (violation, field) => {
    mockCreatePromotionCode.mockRejectedValue(
      new ConnectError("refused", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: violation }] },
        },
      ])
    );

    const { createPromotionCode } = await import("./promotion-code");
    const result = await createPromotionCode(createInput, "en");

    expect(result).toMatchObject({
      fieldErrors: { [field]: expect.any(String) },
      ok: false,
    });
  });
});

describe("setPromotionCodePaused", () => {
  it.each([
    [true, mockPausePromotionCode],
    [false, mockResumePromotionCode],
  ])("pauses or resumes the code (paused: %s)", async (paused, rpc) => {
    rpc.mockResolvedValue({ promotionCode: promotionCode() });

    const { setPromotionCodePaused } = await import("./promotion-code");

    const result = await setPromotionCodePaused(
      { id: CODE_ID, paused, tenantId: "TENANT001" },
      "en"
    );

    expect(rpc).toHaveBeenCalledWith(
      { promotionCodeId: CODE_ID, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
  });
});
