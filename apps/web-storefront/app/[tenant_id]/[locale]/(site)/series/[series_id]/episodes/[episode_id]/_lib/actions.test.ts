import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetTenantSiteInfo,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
  mockStartEpisodeCheckout,
  mockUpdateTag,
  mockUseTicket,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRedirectToLogin: vi.fn((locale: string, returnTo: string) => {
    throw new Error(`NEXT_REDIRECT:/${locale}/login?returnTo=${returnTo}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockStartEpisodeCheckout: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUseTicket: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    purchase: { startEpisodeCheckout: mockStartEpisodeCheckout },
    waitFree: { useTicket: mockUseTicket },
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

vi.mock("#lib/tenant", () => ({ getTenantSiteInfo: mockGetTenantSiteInfo }));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, path: string) =>
    Promise.resolve(`/${locale}${path}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const episodeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const checkoutForm = (): FormData => {
  const data = new FormData();
  data.set("episodeId", episodeId);
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
    expect(mockStartEpisodeCheckout.mock.calls[0]?.[0]).toEqual({
      episodeId,
      tenant: { tenantId },
    });
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

describe("openWithWaitFreeTicketAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Spend the ticket and bring the reader back to the episode it opened", async () => {
    mockUseTicket.mockResolvedValueOnce({
      nextAvailableAt: "2026-10-06T11:00:00Z",
      ticket: { episodeId, expiresAt: "2026-10-08T12:00:00Z" },
    });

    const { openWithWaitFreeTicketAction } = await import("./actions");

    await expect(openWithWaitFreeTicketAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
    );
    expect(mockUseTicket).toHaveBeenCalledWith(
      {
        episodeId,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:reader-access`
    );
  });

  it.each([
    ["an episode already open", Code.AlreadyExists],
    ["a ticket that is not ready", Code.FailedPrecondition],
    ["an age the reader has not proved", Code.PermissionDenied],
  ])("Return to the episode, which words %s itself", async (_, code) => {
    mockUseTicket.mockRejectedValueOnce(new ConnectError("refused", code));

    const { openWithWaitFreeTicketAction } = await import("./actions");

    await expect(openWithWaitFreeTicketAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:reader-access`
    );
  });

  it.each([
    ["too many attempts", Code.ResourceExhausted],
    ["an API out of reach", Code.Unavailable],
  ])("Report a ticket that could not be used for %s", async (_, code) => {
    mockUseTicket.mockRejectedValueOnce(new ConnectError("failed", code));

    const { openWithWaitFreeTicketAction } = await import("./actions");

    await expect(openWithWaitFreeTicketAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?wait_free=error"
    );
  });

  it("Send a reader whose session was rejected to sign in again", async () => {
    mockUseTicket.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { openWithWaitFreeTicketAction } = await import("./actions");

    await expect(openWithWaitFreeTicketAction(checkoutForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001/episodes/EP_001"
    );
  });

  it("Let a failure nothing classifies reach the error boundary", async () => {
    mockUseTicket.mockRejectedValueOnce(new ConnectError("bug", Code.Internal));

    const { openWithWaitFreeTicketAction } = await import("./actions");

    await expect(openWithWaitFreeTicketAction(checkoutForm())).rejects.toThrow(
      "bug"
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
