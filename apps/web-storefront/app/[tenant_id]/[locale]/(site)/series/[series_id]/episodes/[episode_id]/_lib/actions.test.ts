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
  mockPreviewPromotionCode,
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
  mockPreviewPromotionCode: vi.fn(),
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
    purchase: {
      previewPromotionCode: mockPreviewPromotionCode,
      startEpisodeCheckout: mockStartEpisodeCheckout,
    },
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

const promotionCodeRefusal = (reason: string) =>
  new ConnectError(
    "promotion code refused",
    Code.FailedPrecondition,
    undefined,
    [{ desc: ErrorInfoSchema, value: { domain: "publira", reason } }]
  );

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
      promotionCode: "",
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

  it("Carry the applied promotion code into the checkout", async () => {
    mockStartEpisodeCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/session",
    });
    const form = checkoutForm();
    form.set("promotionCode", " SPRING10 ");

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/session"
    );
    expect(mockStartEpisodeCheckout.mock.calls[0]?.[0]).toMatchObject({
      promotionCode: "SPRING10",
    });
    // A code that takes the whole price off records the purchase at once.
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:reader-access`
    );
  });

  it("Return a code that stopped applying to the gate, which words why", async () => {
    mockStartEpisodeCheckout.mockRejectedValueOnce(
      promotionCodeRefusal("PROMOTION_CODE_EXHAUSTED")
    );
    const form = checkoutForm();
    form.set("promotionCode", "SPRING10");

    const { startEpisodeCheckoutAction } = await import("./actions");

    await expect(startEpisodeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?promotion_code=SPRING10"
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

const promotionCodeForm = (code: string, kinds = ["purchase"]): FormData => {
  const data = checkoutForm();
  data.set("promotionCode", code);

  for (const kind of kinds) {
    data.append("kinds", kind);
  }

  return data;
};

describe("applyEpisodePromotionCodeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Quote the code against each sale the gate offers", async () => {
    mockPreviewPromotionCode
      .mockResolvedValueOnce({ listPrice: 300, price: 240 })
      .mockResolvedValueOnce({ listPrice: 100, price: 80 });

    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("spring10", ["purchase", "rental"])
      )
    ).resolves.toEqual({
      code: "spring10",
      kind: "applied",
      quotes: {
        purchase: { listPrice: 300, price: 240 },
        rental: { listPrice: 100, price: 80 },
      },
    });
    expect(
      mockPreviewPromotionCode.mock.calls.map(([request]) => request)
    ).toEqual([
      {
        code: "spring10",
        episodeId,
        kind: PurchaseKind.PURCHASE,
        tenant: { tenantId },
      },
      {
        code: "spring10",
        episodeId,
        kind: PurchaseKind.RENTAL,
        tenant: { tenantId },
      },
    ]);
  });

  it("Leave a sale the code does not apply to at its price", async () => {
    mockPreviewPromotionCode
      .mockResolvedValueOnce({ listPrice: 300, price: 240 })
      .mockRejectedValueOnce(
        promotionCodeRefusal("PROMOTION_CODE_NOT_APPLICABLE")
      );

    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("SPRING10", ["purchase", "rental"])
      )
    ).resolves.toEqual({
      code: "SPRING10",
      kind: "applied",
      quotes: { purchase: { listPrice: 300, price: 240 } },
    });
  });

  it.each([
    ["PROMOTION_CODE_INVALID", "invalid"],
    ["PROMOTION_CODE_EXPIRED", "expired"],
    ["PROMOTION_CODE_EXHAUSTED", "exhausted"],
    ["PROMOTION_CODE_ALREADY_REDEEMED", "already_redeemed"],
    ["PROMOTION_CODE_NOT_APPLICABLE", "not_applicable"],
  ])("Word the refusal %s as %s", async (reason, refusal) => {
    mockPreviewPromotionCode.mockRejectedValueOnce(
      promotionCodeRefusal(reason)
    );

    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("SPRING10")
      )
    ).resolves.toEqual({ code: "SPRING10", kind: "refused", reason: refusal });
  });

  it("Ask a reader past their allowance to wait", async () => {
    mockPreviewPromotionCode.mockRejectedValueOnce(
      new ConnectError("too many attempts", Code.ResourceExhausted)
    );

    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("SPRING10")
      )
    ).resolves.toEqual({
      code: "SPRING10",
      kind: "refused",
      reason: "rate_limited",
    });
  });

  it("Refuse a code no tenant could hold without spending a lookup", async () => {
    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("SPRING-10")
      )
    ).resolves.toEqual({
      code: "SPRING-10",
      kind: "refused",
      reason: "invalid",
    });
    expect(mockPreviewPromotionCode).not.toHaveBeenCalled();
  });

  it("Take the code off when the field is emptied", async () => {
    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { code: "SPRING10", kind: "refused", reason: "invalid" },
        promotionCodeForm("  ")
      )
    ).resolves.toEqual({ kind: "none" });
    expect(mockPreviewPromotionCode).not.toHaveBeenCalled();
  });

  it("Send a reader whose session ended to sign in", async () => {
    mockPreviewPromotionCode.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { applyEpisodePromotionCodeAction } = await import("./actions");

    await expect(
      applyEpisodePromotionCodeAction(
        { kind: "none" },
        promotionCodeForm("SPRING10")
      )
    ).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001/episodes/EP_001"
    );
  });
});
