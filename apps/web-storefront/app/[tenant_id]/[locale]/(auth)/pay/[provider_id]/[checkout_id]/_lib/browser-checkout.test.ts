import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetBrowserCheckout } = vi.hoisted(() => ({
  mockGetBrowserCheckout: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: { purchase: { getBrowserCheckout: mockGetBrowserCheckout } },
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const checkoutId = "0123456789abcdef0123456789abcdef";

const read = async () => {
  const { readBrowserCheckout } = await import("./browser-checkout");

  return readBrowserCheckout({
    checkoutId,
    tenantId,
    locale: "en",
    provider: "paidy",
  });
};

const response = {
  cancelUrl: "https://comics.example.com/series/S1/episodes/E1?checkout=cancel",
  credentials: { public_key: "pk_test_0001" },
  payload: JSON.stringify({ amount: 300, currency: "JPY" }),
  successUrl:
    "https://comics.example.com/series/S1/episodes/E1?checkout=success",
};

describe("readBrowserCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers what the script is launched with and where the reader returns", async () => {
    mockGetBrowserCheckout.mockResolvedValueOnce(response);

    await expect(read()).resolves.toStrictEqual({
      checkout: {
        cancelUrl: response.cancelUrl,
        credentials: { public_key: "pk_test_0001" },
        payload: { amount: 300, currency: "JPY" },
        successUrl: response.successUrl,
      },
      kind: "open",
    });
    expect(mockGetBrowserCheckout).toHaveBeenCalledWith({
      checkoutId,
      provider: "paidy",
      tenant: { tenantId },
    });
  });

  it("answers a checkout the server does not hold as missing", async () => {
    mockGetBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("checkout not found", Code.NotFound)
    );

    await expect(read()).resolves.toStrictEqual({ kind: "missing" });
  });

  it("answers a checkout that can no longer be paid as closed", async () => {
    mockGetBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("the checkout is paid already", Code.FailedPrecondition)
    );

    await expect(read()).resolves.toStrictEqual({ kind: "closed" });
  });

  it("answers a read that failed with the message to show", async () => {
    mockGetBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const result = await read();

    expect(result.kind).toBe("failed");
  });

  it("rethrows an error it cannot classify", async () => {
    mockGetBrowserCheckout.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(read()).rejects.toThrow("boom");
  });

  it.each([
    ["a payload that is not JSON", { payload: "{" }],
    ["a payload that is not an object", { payload: "[1]" }],
    [
      "a return URL the page could not navigate to safely",
      { successUrl: "data:text/html,checkout" },
    ],
  ])("refuses %s", async (_name, override) => {
    mockGetBrowserCheckout.mockResolvedValueOnce({ ...response, ...override });

    await expect(read()).resolves.toStrictEqual({
      kind: "failed",
      message: "Could not open the payment. Reload the page and try again.",
    });
  });
});
