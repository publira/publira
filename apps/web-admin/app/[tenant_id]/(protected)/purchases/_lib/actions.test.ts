import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockRefundPurchase,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockRefundPurchase: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/purchase", () => ({
  purchasesCacheTag: (tenantId: string) => `purchases-${tenantId}`,
  refundPurchase: mockRefundPurchase,
}));

const PURCHASE_ID = "018f0e6a-5000-7000-8000-000000000001";

const refundFormData = (reason: string): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("purchase_id", PURCHASE_ID);
  formData.set("reason", reason);
  return formData;
};

describe("refundPurchaseAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("refunds with the trimmed reason and clears the purchases' tag", async () => {
    mockRefundPurchase.mockResolvedValue({ ok: true, purchase: {} });

    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(
      null,
      refundFormData("  Bought twice by mistake.  ")
    );

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockRefundPurchase).toHaveBeenCalledWith(
      {
        purchaseId: PURCHASE_ID,
        reason: "Bought twice by mistake.",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("purchases-TENANT001");
    expect(state).toEqual({
      message: "The refund was requested.",
      ok: true,
    });
  });

  it("refuses a blank reason without asking the API", async () => {
    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(null, refundFormData("   "));

    expect(mockRefundPurchase).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(state).toEqual({
      message: "Enter the reason for the refund.",
      ok: false,
    });
  });

  it("refuses a reason longer than the API records", async () => {
    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(
      null,
      refundFormData("x".repeat(1001))
    );

    expect(mockRefundPurchase).not.toHaveBeenCalled();
    expect(state).toEqual({
      message: "Keep the reason to 1,000 characters or fewer.",
      ok: false,
    });
  });

  it("passes on what the API refused and leaves the cache alone", async () => {
    mockRefundPurchase.mockResolvedValue({
      message: "This purchase cannot be refunded.",
      ok: false,
    });

    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(
      null,
      refundFormData("Bought twice by mistake.")
    );

    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(state).toEqual({
      message: "This purchase cannot be refunded.",
      ok: false,
    });
  });
});
