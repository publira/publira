import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockRefundPurchase,
  mockRefundPurchaseInPart,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockRefundPurchase: vi.fn(),
  mockRefundPurchaseInPart: vi.fn(),
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
  refundPurchaseInPart: mockRefundPurchaseInPart,
}));

const PURCHASE_ID = "018f0e6a-5000-7000-8000-000000000001";

const refundFormData = (reason: string): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("purchase_id", PURCHASE_ID);
  formData.set("reason", reason);

  return formData;
};

/** The form of a purchase a refund in part is possible on, `left` being 500 yen. */
const amountFormData = (amount: string, currency = "JPY"): FormData => {
  const formData = refundFormData("Half of the pages would not load.");
  formData.set("amount", amount);
  formData.set("currency", currency);
  formData.set("left", "500");

  return formData;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

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

  it("refunds an amount below what is left in part", async () => {
    mockRefundPurchaseInPart.mockResolvedValue({ ok: true, purchase: {} });

    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(null, amountFormData("200"));

    expect(mockRefundPurchaseInPart).toHaveBeenCalledWith(
      {
        amount: 200,
        purchaseId: PURCHASE_ID,
        reason: "Half of the pages would not load.",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRefundPurchase).not.toHaveBeenCalled();
    expect(mockUpdateTag).toHaveBeenCalledWith("purchases-TENANT001");
    expect(state).toEqual({
      message: "A refund of ¥200 was requested.",
      ok: true,
    });
  });

  it("refunds all that is left as a whole refund, which a server of any release takes", async () => {
    mockRefundPurchase.mockResolvedValue({ ok: true, purchase: {} });

    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(null, amountFormData("500"));

    expect(mockRefundPurchase).toHaveBeenCalledWith(
      {
        purchaseId: PURCHASE_ID,
        reason: "Half of the pages would not load.",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockRefundPurchaseInPart).not.toHaveBeenCalled();
    expect(state).toEqual({
      message: "A refund of ¥500 was requested.",
      ok: true,
    });
  });

  it("reads an amount in the currency's minor unit", async () => {
    mockRefundPurchaseInPart.mockResolvedValue({ ok: true, purchase: {} });

    const { refundPurchaseAction } = await import("./actions");
    await refundPurchaseAction(null, amountFormData("1.99", "USD"));

    expect(mockRefundPurchaseInPart).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 199 }),
      "en"
    );
  });

  it.each([
    ["nothing", ""],
    ["zero", "0"],
    ["more than is left", "501"],
    ["a fraction of a yen", "1.5"],
    ["a negative amount", "-1"],
  ])("refuses %s without asking the API", async (_label, amount) => {
    const { refundPurchaseAction } = await import("./actions");
    const state = await refundPurchaseAction(null, amountFormData(amount));

    expect(mockRefundPurchase).not.toHaveBeenCalled();
    expect(mockRefundPurchaseInPart).not.toHaveBeenCalled();
    expect(state).toEqual({
      message:
        "Enter an amount above zero and no more than what is left to refund.",
      ok: false,
    });
  });
});
