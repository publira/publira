import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateBillingPortalSession,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateBillingPortalSession: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRedirectToLogin: vi.fn((locale: string, returnTo: string) => {
    throw new Error(`NEXT_REDIRECT:/${locale}/login?returnTo=${returnTo}`);
  }),
  mockRequirePublicSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    subscription: {
      createBillingPortalSession: mockCreateBillingPortalSession,
    },
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

const billingForm = (): FormData => {
  const data = new FormData();
  data.set("locale", "en");
  data.set("tenantId", tenantId);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePublicSession.mockResolvedValue("session-token");
});

describe("openBillingPortalAction", () => {
  it("sends the reader to Stripe's billing portal", async () => {
    mockCreateBillingPortalSession.mockResolvedValueOnce({
      url: "https://billing.stripe.test/session",
    });

    const { openBillingPortalAction } = await import("./actions");

    await expect(openBillingPortalAction(billingForm())).rejects.toThrow(
      "NEXT_REDIRECT:https://billing.stripe.test/session"
    );
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/my",
      tenantId
    );
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      { tenant: { tenantId } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("opens nothing for a form that names no tenant", async () => {
    const form = billingForm();
    form.delete("tenantId");

    const { openBillingPortalAction } = await import("./actions");

    await expect(openBillingPortalAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled();
  });

  it("tells the reader billing cannot be managed here", async () => {
    mockCreateBillingPortalSession.mockRejectedValueOnce(
      new ConnectError("no stripe", Code.FailedPrecondition)
    );

    const { openBillingPortalAction } = await import("./actions");

    await expect(openBillingPortalAction(billingForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/my?billing=unavailable"
    );
  });

  it("reports a portal that could not be opened", async () => {
    mockCreateBillingPortalSession.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { openBillingPortalAction } = await import("./actions");

    await expect(openBillingPortalAction(billingForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/my?billing=error"
    );
  });

  it("sends a reader whose session the API rejects to sign in again", async () => {
    mockCreateBillingPortalSession.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { openBillingPortalAction } = await import("./actions");

    await expect(openBillingPortalAction(billingForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/my"
    );
  });
});
