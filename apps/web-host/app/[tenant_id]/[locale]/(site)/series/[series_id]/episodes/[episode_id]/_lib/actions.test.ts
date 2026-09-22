import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetTenantSiteInfo,
  mockRedirect,
  mockRequirePublicSession,
  mockStartEpisodeCheckout,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockStartEpisodeCheckout: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/api-client", () => ({
  apiClient: { purchase: { startEpisodeCheckout: mockStartEpisodeCheckout } },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLogin: vi.fn(),
  requirePublicSession: mockRequirePublicSession,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({ getTenantSiteInfo: mockGetTenantSiteInfo }));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, path: string) =>
    Promise.resolve(`/${locale}${path}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const checkoutForm = (): FormData => {
  const data = new FormData();
  data.set("episodePublicId", "EP_001");
  data.set("locale", "en");
  data.set("seriesPublicId", "SERIES_001");
  data.set("tenantId", tenantId);
  return data;
};

describe("startEpisodeCheckoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantSiteInfo.mockResolvedValue({ acceptsPayments: true });
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Send the reader to Stripe with the URL the server answered", async () => {
    mockStartEpisodeCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/session",
    });

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/session"
    );
  });

  it("Return the reader to the episode when the web may not sell it", async () => {
    mockStartEpisodeCheckout.mockRejectedValueOnce(
      new ConnectError(
        "episode is not sold on this surface",
        Code.FailedPrecondition
      )
    );

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
    );
  });

  it("Report a checkout that could not start", async () => {
    mockStartEpisodeCheckout.mockRejectedValueOnce(
      new ConnectError("failed to start checkout", Code.Unavailable)
    );

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?checkout=error"
    );
  });
});
