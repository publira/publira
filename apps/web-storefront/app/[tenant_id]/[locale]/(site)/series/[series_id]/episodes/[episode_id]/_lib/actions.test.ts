import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { ClientSurface, PurchaseKind } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetTenantSiteInfo,
  mockPayEpisodeWithCoins,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
  mockStartEpisodeCheckout,
  mockUpdateTag,
  mockUseTicket,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockPayEpisodeWithCoins: vi.fn(),
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
    coin: { payEpisodeWithCoins: mockPayEpisodeWithCoins },
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
      kind: PurchaseKind.PURCHASE,
      locale: "en",
      tenant: { tenantId },
    });
  });

  it("Start the checkout for the sale the reader chose", async () => {
    mockStartEpisodeCheckout.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.test/session",
    });
    const rental = checkoutForm();
    rental.set("kind", "rental");
    const purchase = checkoutForm();
    purchase.set("kind", "purchase");

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(rental)).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/session"
    );
    await expect(startEpisodeCheckoutAction(purchase)).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/session"
    );
    expect(mockStartEpisodeCheckout.mock.calls[0]?.[0]).toMatchObject({
      kind: PurchaseKind.RENTAL,
    });
    expect(mockStartEpisodeCheckout.mock.calls[1]?.[0]).toMatchObject({
      kind: PurchaseKind.PURCHASE,
    });
  });

  it("Start no checkout for a sale the episode does not have", async () => {
    const form = checkoutForm();
    form.set("kind", "volume");

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockStartEpisodeCheckout).not.toHaveBeenCalled();
  });

  it("Return the reader to the episode when they still hold the rental", async () => {
    mockStartEpisodeCheckout.mockRejectedValueOnce(
      new ConnectError("rental is still active", Code.AlreadyExists)
    );
    const form = checkoutForm();
    form.set("kind", "rental");

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
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

const coinPaymentForm = (): FormData => {
  const data = checkoutForm();
  data.set("coins", "300");
  data.set("idempotencyKey", "payment-key");
  return data;
};

const coinPriceChanged = () =>
  new ConnectError("price changed", Code.FailedPrecondition, undefined, [
    {
      desc: ErrorInfoSchema,
      value: {
        domain: "publira",
        metadata: { coin_price: "320" },
        reason: "COIN_PRICE_CHANGED",
      },
    },
  ]);

describe("payEpisodeWithCoinsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Spend the coins the gate showed and bring the reader back to the episode", async () => {
    mockPayEpisodeWithCoins.mockResolvedValueOnce({});

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
    );
    expect(mockPayEpisodeWithCoins).toHaveBeenCalledWith(
      {
        coins: 300,
        episodeId,
        idempotencyKey: "payment-key",
        kind: PurchaseKind.PURCHASE,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:reader-access`
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:purchases`);
  });

  it("Pay for a rental with the rental's coin price", async () => {
    mockPayEpisodeWithCoins.mockResolvedValueOnce({});
    const form = coinPaymentForm();
    form.set("kind", "rental");

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:"
    );
    expect(mockPayEpisodeWithCoins.mock.calls[0]?.[0]).toMatchObject({
      kind: PurchaseKind.RENTAL,
    });
  });

  it("Spend nothing on a form without a price", async () => {
    const form = coinPaymentForm();
    form.delete("coins");

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockPayEpisodeWithCoins).not.toHaveBeenCalled();
  });

  it("Say so when the price changed after the gate showed it", async () => {
    mockPayEpisodeWithCoins.mockRejectedValueOnce(coinPriceChanged());

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?coins=price_changed"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:series:detail`
    );
  });

  it("Return the reader to the episode when the balance fell short", async () => {
    mockPayEpisodeWithCoins.mockRejectedValueOnce(
      new ConnectError("short", Code.FailedPrecondition)
    );

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001"
    );
    expect(mockRedirect).toHaveBeenLastCalledWith(
      "/en/series/SERIES_001/episodes/EP_001"
    );
  });

  it("Report a payment that could not be made", async () => {
    mockPayEpisodeWithCoins.mockRejectedValueOnce(
      new ConnectError("too many", Code.ResourceExhausted)
    );

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?coins=pay_error"
    );
  });

  it("Send a reader whose session was rejected to sign in again", async () => {
    mockPayEpisodeWithCoins.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001/episodes/EP_001"
    );
  });

  it("Let a failure nothing classifies reach the error boundary", async () => {
    mockPayEpisodeWithCoins.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { payEpisodeWithCoinsAction } = await import("./actions");

    await expect(payEpisodeWithCoinsAction(coinPaymentForm())).rejects.toThrow(
      "boom"
    );
  });
});
