import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantPurchasesTag, tenantReaderAccessTag } from "#lib/cache-tags";

const { mockAssertSameOrigin, mockCompleteBrowserCheckout, mockUpdateTag } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockCompleteBrowserCheckout: vi.fn(),
    mockUpdateTag: vi.fn(),
  }));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    purchase: { completeBrowserCheckout: mockCompleteBrowserCheckout },
  },
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const checkoutId = "0123456789abcdef0123456789abcdef";

const formData = (values: Record<string, string> = {}): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    checkoutId,
    familyName: "Yamada",
    locale: "en",
    paymentId: "pay_0001",
    provider: "paidy",
    tenantId,
    ...values,
  })) {
    data.set(name, value);
  }

  return data;
};

describe("completeBrowserCheckoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the server the payment and clears what the purchase changes", async () => {
    mockCompleteBrowserCheckout.mockResolvedValueOnce({});

    const { completeBrowserCheckoutAction } = await import("./actions");
    const result = await completeBrowserCheckoutAction(formData());

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockCompleteBrowserCheckout).toHaveBeenCalledWith({
      checkoutId,
      paymentId: "pay_0001",
      provider: "paidy",
      tenant: { tenantId },
    });
    expect(result).toStrictEqual({ message: "", ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith(tenantReaderAccessTag(tenantId));
    expect(mockUpdateTag).toHaveBeenCalledWith(tenantPurchasesTag(tenantId));
  });

  it("says a payment the server refuses was not taken", async () => {
    mockCompleteBrowserCheckout.mockRejectedValueOnce(
      new ConnectError(
        "the payment does not match its checkout",
        Code.InvalidArgument
      )
    );

    const { completeBrowserCheckoutAction } = await import("./actions");
    const result = await completeBrowserCheckoutAction(formData());

    expect(result).toStrictEqual({
      message:
        "The payment could not be applied to this purchase, so it was not taken. Start the purchase again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("asks for the payment to be confirmed again when the server cannot complete it", async () => {
    mockCompleteBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("failed to complete checkout", Code.FailedPrecondition)
    );

    const { completeBrowserCheckoutAction } = await import("./actions");
    const result = await completeBrowserCheckoutAction(formData());

    expect(result).toStrictEqual({
      message:
        "Your payment could not be confirmed yet. Press the button to confirm it again.",
      ok: false,
    });
  });

  it("refuses a form that names no payment without calling the server", async () => {
    const { completeBrowserCheckoutAction } = await import("./actions");

    const result = await completeBrowserCheckoutAction(
      formData({ paymentId: " " })
    );

    expect(result.ok).toBe(false);
    expect(mockCompleteBrowserCheckout).not.toHaveBeenCalled();
  });

  it("rethrows an error it cannot classify", async () => {
    mockCompleteBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { completeBrowserCheckoutAction } = await import("./actions");

    await expect(completeBrowserCheckoutAction(formData())).rejects.toThrow(
      "boom"
    );
  });
});
