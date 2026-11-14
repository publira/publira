import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { PromotionCodeQuote_Refusal } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetTenantSiteInfo,
  mockPreviewPromotionCode,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
  mockStartSeriesRemainderCheckout,
  mockStartVolumeCheckout,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockPreviewPromotionCode: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRedirectToLogin: vi.fn((locale: string, returnTo: string) => {
    throw new Error(`NEXT_REDIRECT:/${locale}/login?returnTo=${returnTo}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockStartSeriesRemainderCheckout: vi.fn(),
  mockStartVolumeCheckout: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    purchase: {
      previewPromotionCode: mockPreviewPromotionCode,
      startSeriesRemainderCheckout: mockStartSeriesRemainderCheckout,
      startVolumeCheckout: mockStartVolumeCheckout,
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

vi.mock("#lib/tenant", () => ({ getTenantSiteInfo: mockGetTenantSiteInfo }));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, path: string) =>
    Promise.resolve(`/${locale}${path}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const seriesId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const volumeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const volumeForm = (): FormData => {
  const data = new FormData();
  data.set("locale", "en");
  data.set("seriesPublicId", "SERIES_001");
  data.set("tenantId", tenantId);
  data.set("volumeId", volumeId);

  return data;
};

const promotionCodeRefusal = (reason: string) =>
  new ConnectError(
    "promotion code refused",
    Code.FailedPrecondition,
    undefined,
    [{ desc: ErrorInfoSchema, value: { domain: "publira", reason } }]
  );

const quoted = (quote: {
  listPrice: number;
  price: number;
  refusal?: PromotionCodeQuote_Refusal;
}) => ({ refusal: PromotionCodeQuote_Refusal.UNSPECIFIED, ...quote });

const volumeCodeForm = (code: string, ...volumeIds: string[]): FormData => {
  const data = new FormData();
  data.set("locale", "en");
  data.set("promotionCode", code);
  data.set("seriesPublicId", "SERIES_001");
  data.set("tenantId", tenantId);

  for (const id of volumeIds) {
    data.append("volumeIds", id);
  }

  return data;
};

const remainderForm = (): FormData => {
  const data = new FormData();
  data.set("locale", "ja");
  data.set("seriesId", seriesId);
  data.set("seriesPublicId", "SERIES_001");
  data.set("tenantId", tenantId);

  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTenantSiteInfo.mockResolvedValue({ acceptsPayments: true });
  mockRequirePublicSession.mockResolvedValue("session-token");
});

describe("startVolumeCheckoutAction", () => {
  it("Send the reader to the provider with the URL the server answered for the volume", async () => {
    mockStartVolumeCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/volume",
    });

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/volume"
    );
    expect(mockStartVolumeCheckout).toHaveBeenCalledWith(
      { promotionCode: "", provider: "", tenant: { tenantId }, volumeId },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("Carry the code the section applied into the checkout", async () => {
    mockStartVolumeCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/volume",
    });

    const form = volumeForm();
    form.set("promotionCode", "SPRING10");

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/volume"
    );
    expect(mockStartVolumeCheckout).toHaveBeenCalledWith(
      {
        promotionCode: "SPRING10",
        provider: "",
        tenant: { tenantId },
        volumeId,
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockUpdateTag).toHaveBeenCalledTimes(2);
  });

  it("Send the volume's checkout to the provider the reader chose", async () => {
    mockStartVolumeCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://pay.jp.test/volume",
    });

    const form = volumeForm();
    form.set("provider", "payjp");

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:https://pay.jp.test/volume"
    );
    expect(mockStartVolumeCheckout.mock.calls[0]?.[0]).toMatchObject({
      provider: "payjp",
    });
  });

  it("Bring a code that stopped applying back to the section to say why", async () => {
    mockStartVolumeCheckout.mockRejectedValueOnce(
      promotionCodeRefusal("PROMOTION_CODE_EXHAUSTED")
    );

    const form = volumeForm();
    form.set("promotionCode", "SPRING10");

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001?promotion_code=SPRING10"
    );
  });

  it("Start no checkout for a volume the form does not name", async () => {
    const form = volumeForm();
    form.set("volumeId", "VOLUME_001");

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockStartVolumeCheckout).not.toHaveBeenCalled();
  });

  it("Leave the reader on the series page while the site takes no payments", async () => {
    mockGetTenantSiteInfo.mockResolvedValueOnce({ acceptsPayments: false });

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001"
    );
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockStartVolumeCheckout).not.toHaveBeenCalled();
  });

  it.each([
    ["a volume already bought", Code.AlreadyExists],
    ["a volume taken off sale", Code.NotFound],
    ["a tenant that cannot take payments right now", Code.FailedPrecondition],
  ])(
    "Return the reader to the series page, which words %s itself",
    async (_, code) => {
      mockStartVolumeCheckout.mockRejectedValueOnce(
        new ConnectError("refused", code)
      );

      const { startVolumeCheckoutAction } = await import("./actions");

      await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
        "NEXT_REDIRECT:/en/series/SERIES_001"
      );
    }
  );

  it("Send a reader whose session was rejected to sign in and come back to the series", async () => {
    mockStartVolumeCheckout.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001"
    );
  });

  it("Report a checkout that could not start", async () => {
    mockStartVolumeCheckout.mockRejectedValueOnce(
      new ConnectError("failed to start checkout", Code.Unavailable)
    );

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001?checkout=error"
    );
  });

  it("Report a checkout the server answered no URL for", async () => {
    mockStartVolumeCheckout.mockResolvedValueOnce({ checkoutUrl: " " });

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001?checkout=error"
    );
  });

  it("Let a failure nothing classifies reach the error boundary", async () => {
    mockStartVolumeCheckout.mockRejectedValueOnce(
      new ConnectError("bug", Code.Internal)
    );

    const { startVolumeCheckoutAction } = await import("./actions");

    await expect(startVolumeCheckoutAction(volumeForm())).rejects.toThrow(
      "bug"
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("startSeriesRemainderCheckoutAction", () => {
  it("Start the checkout of the rest of the series in the reader's language", async () => {
    mockStartSeriesRemainderCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/remainder",
    });

    const { startSeriesRemainderCheckoutAction } = await import("./actions");

    await expect(
      startSeriesRemainderCheckoutAction(remainderForm())
    ).rejects.toThrow("NEXT_REDIRECT:https://checkout.stripe.test/remainder");
    expect(mockStartSeriesRemainderCheckout).toHaveBeenCalledWith(
      { locale: "ja", provider: "", seriesId, tenant: { tenantId } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("Send the rest of the series to the provider the reader chose", async () => {
    mockStartSeriesRemainderCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://pay.jp.test/remainder",
    });

    const form = remainderForm();
    form.set("provider", "payjp");

    const { startSeriesRemainderCheckoutAction } = await import("./actions");

    await expect(startSeriesRemainderCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:https://pay.jp.test/remainder"
    );
    expect(mockStartSeriesRemainderCheckout.mock.calls[0]?.[0]).toMatchObject({
      provider: "payjp",
    });
  });

  it.each([
    ["every episode already held", Code.AlreadyExists],
    ["nothing left that one checkout can sell", Code.FailedPrecondition],
  ])(
    "Return the reader to the series page, which words %s itself",
    async (_, code) => {
      mockStartSeriesRemainderCheckout.mockRejectedValueOnce(
        new ConnectError("refused", code)
      );

      const { startSeriesRemainderCheckoutAction } = await import("./actions");

      await expect(
        startSeriesRemainderCheckoutAction(remainderForm())
      ).rejects.toThrow("NEXT_REDIRECT:/ja/series/SERIES_001");
    }
  );

  it("Report a checkout of an episode the reader is credited on as one that could not start", async () => {
    mockStartSeriesRemainderCheckout.mockRejectedValueOnce(
      new ConnectError("credited", Code.PermissionDenied)
    );

    const { startSeriesRemainderCheckoutAction } = await import("./actions");

    await expect(
      startSeriesRemainderCheckoutAction(remainderForm())
    ).rejects.toThrow("NEXT_REDIRECT:/ja/series/SERIES_001?checkout=error");
  });
});

describe("applyVolumePromotionCodeAction", () => {
  const otherVolumeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("Quote every volume in one call", async () => {
    mockPreviewPromotionCode.mockResolvedValueOnce({
      quotes: [
        quoted({ listPrice: 350, price: 280 }),
        quoted({ listPrice: 500, price: 400 }),
      ],
    });

    const { applyVolumePromotionCodeAction } = await import("./actions");

    await expect(
      applyVolumePromotionCodeAction(
        { kind: "none" },
        volumeCodeForm("spring10", volumeId, otherVolumeId)
      )
    ).resolves.toEqual({
      code: "spring10",
      kind: "applied",
      quotes: {
        [otherVolumeId]: { listPrice: 500, price: 400 },
        [volumeId]: { listPrice: 350, price: 280 },
      },
    });
    expect(mockPreviewPromotionCode).toHaveBeenCalledOnce();
    expect(mockPreviewPromotionCode.mock.calls[0]?.[0]).toEqual({
      code: "spring10",
      sales: [{ volumeId }, { volumeId: otherVolumeId }],
      tenant: { tenantId },
    });
  });

  it("Leave a volume the code does not apply to at its price", async () => {
    mockPreviewPromotionCode.mockResolvedValueOnce({
      quotes: [
        quoted({ listPrice: 350, price: 280 }),
        quoted({
          listPrice: 500,
          price: 500,
          refusal: PromotionCodeQuote_Refusal.NOT_APPLICABLE,
        }),
      ],
    });

    const { applyVolumePromotionCodeAction } = await import("./actions");

    await expect(
      applyVolumePromotionCodeAction(
        { kind: "none" },
        volumeCodeForm("SPRING10", volumeId, otherVolumeId)
      )
    ).resolves.toEqual({
      code: "SPRING10",
      kind: "applied",
      quotes: { [volumeId]: { listPrice: 350, price: 280 } },
    });
  });

  it("Say the code applies to none of the volumes", async () => {
    mockPreviewPromotionCode.mockResolvedValueOnce({
      quotes: [
        quoted({
          listPrice: 350,
          price: 350,
          refusal: PromotionCodeQuote_Refusal.NOT_APPLICABLE,
        }),
      ],
    });

    const { applyVolumePromotionCodeAction } = await import("./actions");

    await expect(
      applyVolumePromotionCodeAction(
        { kind: "none" },
        volumeCodeForm("SPRING10", volumeId)
      )
    ).resolves.toEqual({
      code: "SPRING10",
      kind: "refused",
      reason: "not_applicable",
    });
  });

  it("Word a refusal of the code itself", async () => {
    mockPreviewPromotionCode.mockRejectedValueOnce(
      promotionCodeRefusal("PROMOTION_CODE_EXPIRED")
    );

    const { applyVolumePromotionCodeAction } = await import("./actions");

    await expect(
      applyVolumePromotionCodeAction(
        { kind: "none" },
        volumeCodeForm("SPRING10", volumeId)
      )
    ).resolves.toEqual({
      code: "SPRING10",
      kind: "refused",
      reason: "expired",
    });
  });

  it("Send a reader whose session ended to sign in", async () => {
    mockPreviewPromotionCode.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { applyVolumePromotionCodeAction } = await import("./actions");

    await expect(
      applyVolumePromotionCodeAction(
        { kind: "none" },
        volumeCodeForm("SPRING10", volumeId)
      )
    ).rejects.toThrow("NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001");
  });
});
