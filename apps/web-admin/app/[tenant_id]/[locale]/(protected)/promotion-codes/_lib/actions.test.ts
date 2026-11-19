import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AuthSessionModule from "#lib/auth-session";

const {
  mockAssertSameOrigin,
  mockCreatePromotionCode,
  mockDeletePromotionCode,
  mockGetAccessToken,
  mockGetTenantCurrency,
  mockListAllEpisodesForTenant,
  mockListVolumes,
  mockRedirect,
  mockSetPromotionCodePaused,
  mockUpdatePromotionCode,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePromotionCode: vi.fn(),
  mockDeletePromotionCode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCurrency: vi.fn(),
  mockListAllEpisodesForTenant: vi.fn(),
  mockListVolumes: vi.fn(),
  // `redirect()` ends the Action by throwing, which the tests stand in for.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  mockSetPromotionCodePaused: vi.fn(),
  mockUpdatePromotionCode: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockVerifyAdminSession: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/public-api", () => ({
  getTenantCurrency: mockGetTenantCurrency,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: () => Promise.resolve("Asia/Tokyo"),
}));

vi.mock("#lib/episode", () => ({
  listAllEpisodesForTenant: mockListAllEpisodesForTenant,
}));

vi.mock("#lib/volume", () => ({
  listVolumes: mockListVolumes,
}));

vi.mock("#lib/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthSessionModule>()),
  verifyAdminSession: mockVerifyAdminSession,
}));

vi.mock("#lib/promotion-code", () => ({
  createPromotionCode: mockCreatePromotionCode,
  deletePromotionCode: mockDeletePromotionCode,
  promotionCodesCacheTag: (tenantId: string) => `promotion-codes-${tenantId}`,
  setPromotionCodePaused: mockSetPromotionCodePaused,
  updatePromotionCode: mockUpdatePromotionCode,
}));

const CODE_ID = "018f0e6a-7000-7000-8000-000000000001";
const SERIES_ID = "018f0e6a-7000-7000-8000-000000000201";

/** What the create form posts, a percentage off the whole catalog. */
const createFormData = (fields: Record<string, string | null> = {}) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("discount_currency", "JPY");
  formData.set("code", " welcome10 ");
  formData.set("discount_kind", "percent");
  formData.set("discount_value", "10");
  formData.set("target_kind", "catalog");
  formData.set("target_id", "");
  formData.set("starts_at", "");
  formData.set("ends_at", "");
  formData.set("max_redemptions", "");
  formData.set("max_redemptions_per_reader", "1");

  for (const [name, value] of Object.entries(fields)) {
    formData.delete(name);

    if (value !== null) {
      formData.set(name, value);
    }
  }

  return formData;
};

const savedCode = { code: "WELCOME10", id: CODE_ID };

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // `withAdminSessionReauth` resolves the session before the mutation runs;
  // without a token every Action under test would redirect to /login.
  mockGetAccessToken.mockResolvedValue("session-token");
  mockGetTenantCurrency.mockResolvedValue("JPY");
});

describe("createPromotionCodeAction", () => {
  it("creates the code in capitals and opens it in the drawer", async () => {
    mockCreatePromotionCode.mockResolvedValueOnce({
      code: savedCode,
      ok: true,
    });

    const { createPromotionCodeAction } = await import("./actions");

    await expect(
      createPromotionCodeAction(null, createFormData())
    ).rejects.toThrow(`redirect:/promotion-codes?code=${CODE_ID}&created=1`);
    expect(mockCreatePromotionCode).toHaveBeenCalledWith(
      {
        code: "WELCOME10",
        currency: "",
        discountKind: "percent",
        discountValue: 10,
        // A blank bound is no bound, and a blank limit no limit.
        limits: {
          endsAt: "",
          maxRedemptions: 0,
          maxRedemptionsPerReader: 1,
          startsAt: "",
        },
        targetId: "",
        targetKind: "catalog",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
  });

  it("reads an amount in the tenant's currency and the window in its zone", async () => {
    mockCreatePromotionCode.mockResolvedValueOnce({
      code: savedCode,
      ok: true,
    });

    const { createPromotionCodeAction } = await import("./actions");

    await expect(
      createPromotionCodeAction(
        null,
        createFormData({
          discount_kind: "amount",
          discount_value: "100",
          ends_at: "",
          ends_at_local: null,
          starts_at: "2026-12-01T00:00",
          target_id: SERIES_ID,
          target_kind: "series",
        })
      )
    ).rejects.toThrow("redirect:");
    expect(mockCreatePromotionCode).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "JPY",
        discountKind: "amount",
        discountValue: 100,
        limits: expect.objectContaining({
          startsAt: "2026-11-30T15:00:00Z",
        }),
        targetId: SERIES_ID,
        targetKind: "series",
      }),
      "en"
    );
  });

  it.each([
    ["code", { code: "WELCOME 10" }],
    ["discount_value", { discount_value: "101" }],
    ["discount_value", { discount_kind: "amount", discount_value: "0" }],
    ["target_id", { target_kind: "label" }],
    ["max_redemptions", { max_redemptions: "-1" }],
    [
      "ends_at",
      {
        ends_at: "2026-12-01T00:00:00Z",
        starts_at: "2026-12-02T00:00:00Z",
      },
    ],
    ["starts_at", { starts_at: "not-a-date" }],
    ["ends_at", { ends_at: "2026-13-01T00:00" }],
  ])(
    "refuses a bad %s beside the field, sending nothing",
    async (field, fields) => {
      const { createPromotionCodeAction } = await import("./actions");

      const state = await createPromotionCodeAction(
        null,
        createFormData(fields)
      );

      expect(state?.ok).toBe(false);
      expect(state?.fieldErrors?.[field]).toBeTruthy();
      expect(mockCreatePromotionCode).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("answers what the API refused, on the field it named", async () => {
    mockCreatePromotionCode.mockResolvedValueOnce({
      fieldErrors: { code: "Another promotion code is already spelled so." },
      message: "Check the highlighted fields.",
      ok: false,
    });

    const { createPromotionCodeAction } = await import("./actions");

    const state = await createPromotionCodeAction(null, createFormData());

    expect(state).toMatchObject({
      fieldErrors: { code: "Another promotion code is already spelled so." },
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updatePromotionCodeAction", () => {
  it("saves the limits and goes back to the code on the same page of the list", async () => {
    mockUpdatePromotionCode.mockResolvedValueOnce({
      code: savedCode,
      ok: true,
    });

    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("promotion_code_id", CODE_ID);
    formData.set("list_token", "page-2");
    formData.set("starts_at", "");
    formData.set("ends_at", "2027-01-01T00:00:00Z");
    formData.set("max_redemptions", "50");
    formData.set("max_redemptions_per_reader", "");

    const { updatePromotionCodeAction } = await import("./actions");

    await expect(updatePromotionCodeAction(null, formData)).rejects.toThrow(
      `redirect:/promotion-codes?code=${CODE_ID}&token=page-2&saved=1`
    );
    expect(mockUpdatePromotionCode).toHaveBeenCalledWith(
      {
        id: CODE_ID,
        limits: {
          endsAt: "2027-01-01T00:00:00Z",
          maxRedemptions: 50,
          maxRedemptionsPerReader: 0,
          startsAt: "",
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
  });

  it("refuses an end that names no instant rather than dropping the end", async () => {
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("promotion_code_id", CODE_ID);
    formData.set("list_token", "");
    formData.set("starts_at", "");
    formData.set("ends_at", "not-a-date");
    formData.set("max_redemptions", "");
    formData.set("max_redemptions_per_reader", "");

    const { updatePromotionCodeAction } = await import("./actions");

    const state = await updatePromotionCodeAction(null, formData);

    expect(state).toMatchObject({
      fieldErrors: { ends_at: "Enter a valid end date and time." },
      ok: false,
    });
    expect(mockUpdatePromotionCode).not.toHaveBeenCalled();
  });
});

describe("setPromotionCodePausedAction", () => {
  it.each([
    ["1", true, "WELCOME10 was paused."],
    ["0", false, "WELCOME10 was resumed."],
  ])("posts paused=%s and says so", async (paused, expected, message) => {
    mockSetPromotionCodePaused.mockResolvedValueOnce({
      code: savedCode,
      ok: true,
    });

    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("promotion_code_id", CODE_ID);
    formData.set("paused", paused);

    const { setPromotionCodePausedAction } = await import("./actions");

    const state = await setPromotionCodePausedAction(null, formData);

    expect(mockSetPromotionCodePaused).toHaveBeenCalledWith(
      { id: CODE_ID, paused: expected, tenantId: "TENANT001" },
      "en"
    );
    expect(state?.ok).toBe(true);
    expect(state?.message).toContain(message);
    expect(mockUpdateTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
  });
});

describe("deletePromotionCodeAction", () => {
  it.each([
    ["", "redirect:/promotion-codes?deleted=1"],
    ["page-2", "redirect:/promotion-codes?token=page-2&deleted=1"],
  ])(
    "deletes the code and closes the drawer on the list (token %j)",
    async (token, url) => {
      mockDeletePromotionCode.mockResolvedValueOnce({ ok: true });

      const formData = new FormData();
      formData.set("tenant_id", "TENANT001");
      formData.set("promotion_code_id", CODE_ID);
      formData.set("list_token", token);

      const { deletePromotionCodeAction } = await import("./actions");

      await expect(deletePromotionCodeAction(null, formData)).rejects.toThrow(
        url
      );
      expect(mockDeletePromotionCode).toHaveBeenCalledWith(
        { id: CODE_ID, listToken: token, tenantId: "TENANT001" },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
    }
  );
});

describe("listPromotionCodeTargetOptionsAction", () => {
  it("offers a series' volumes by their UUID", async () => {
    mockListVolumes.mockResolvedValueOnce({
      ok: true,
      volumes: [{ id: "VOLUME-UUID", publicId: "VOLUME001", title: "Vol. 1" }],
    });

    const { listPromotionCodeTargetOptionsAction } = await import("./actions");

    await expect(
      listPromotionCodeTargetOptionsAction(
        { kind: "volume", seriesId: SERIES_ID, tenantId: "TENANT001" },
        "en"
      )
    ).resolves.toEqual({
      ok: true,
      options: [{ id: "VOLUME-UUID", label: "Vol. 1" }],
    });
    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
  });

  it("offers a series' episodes with their public IDs", async () => {
    mockListAllEpisodesForTenant.mockResolvedValueOnce({
      episodes: [
        { id: "EPISODE-UUID", publicId: "EPISODE001", title: "Episode 1" },
      ],
      ok: true,
    });

    const { listPromotionCodeTargetOptionsAction } = await import("./actions");

    await expect(
      listPromotionCodeTargetOptionsAction(
        { kind: "episode", seriesId: SERIES_ID, tenantId: "TENANT001" },
        "en"
      )
    ).resolves.toEqual({
      ok: true,
      options: [{ id: "EPISODE-UUID", label: "Episode 1 (EPISODE001)" }],
    });
  });
});
