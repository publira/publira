import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
  mockStartSubscriptionCheckout,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRedirectToLogin: vi.fn((locale: string, returnTo: string) => {
    throw new Error(`NEXT_REDIRECT:/${locale}/login?returnTo=${returnTo}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockStartSubscriptionCheckout: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    subscription: { startSubscriptionCheckout: mockStartSubscriptionCheckout },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLogin: mockRedirectToLogin,
  requirePublicSession: mockRequirePublicSession,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, path: string) =>
    Promise.resolve(`/${locale}${path}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const planId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const subscribeForm = (): FormData => {
  const data = new FormData();
  data.set("locale", "en");
  data.set("planId", planId);
  data.set("tenantId", tenantId);

  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePublicSession.mockResolvedValue("session-token");
});

describe("startSubscriptionCheckoutAction", () => {
  it("sends the reader to Stripe's checkout of the plan they chose", async () => {
    mockStartSubscriptionCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/plan",
    });

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(
      startSubscriptionCheckoutAction(subscribeForm())
    ).rejects.toThrow("NEXT_REDIRECT:https://checkout.stripe.test/plan");
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/plans",
      tenantId
    );
    expect(mockStartSubscriptionCheckout).toHaveBeenCalledWith(
      { planId, tenant: { tenantId } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("starts no checkout for a plan the form does not name", async () => {
    const form = subscribeForm();
    form.set("planId", "PLAN_001");

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(startSubscriptionCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockStartSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it("sends a reader who already holds a plan to My Page", async () => {
    mockStartSubscriptionCheckout.mockRejectedValueOnce(
      new ConnectError("held", Code.AlreadyExists)
    );

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(
      startSubscriptionCheckoutAction(subscribeForm())
    ).rejects.toThrow("NEXT_REDIRECT:/en/my");
  });

  it.each([Code.FailedPrecondition, Code.NotFound])(
    "tells the reader the plan cannot be subscribed to on %s",
    async (code) => {
      mockStartSubscriptionCheckout.mockRejectedValueOnce(
        new ConnectError("refused", code)
      );

      const { startSubscriptionCheckoutAction } = await import("./actions");

      await expect(
        startSubscriptionCheckoutAction(subscribeForm())
      ).rejects.toThrow("NEXT_REDIRECT:/en/plans?subscription=unavailable");
    }
  );

  it("reports a checkout that could not be started", async () => {
    mockStartSubscriptionCheckout.mockRejectedValueOnce(
      new ConnectError("too many", Code.ResourceExhausted)
    );

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(
      startSubscriptionCheckoutAction(subscribeForm())
    ).rejects.toThrow("NEXT_REDIRECT:/en/plans?subscription=error");
  });

  it("sends a reader whose session the API rejects to sign in again", async () => {
    mockStartSubscriptionCheckout.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(
      startSubscriptionCheckoutAction(subscribeForm())
    ).rejects.toThrow("NEXT_REDIRECT:/en/login?returnTo=/plans");
  });

  it("rethrows a failure it cannot classify", async () => {
    mockStartSubscriptionCheckout.mockRejectedValueOnce(
      new ConnectError("bug", Code.Internal)
    );

    const { startSubscriptionCheckoutAction } = await import("./actions");

    await expect(
      startSubscriptionCheckoutAction(subscribeForm())
    ).rejects.toThrow("bug");
  });
});
