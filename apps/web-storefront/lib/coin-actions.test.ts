import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRedirect,
  mockRedirectToLogin,
  mockRequirePublicSession,
  mockStartCoinPackCheckout,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockRedirectToLogin: vi.fn((locale: string, returnTo: string) => {
    throw new Error(`NEXT_REDIRECT:/${locale}/login?returnTo=${returnTo}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockStartCoinPackCheckout: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("./api-client", () => ({
  apiClient: { coin: { startCoinPackCheckout: mockStartCoinPackCheckout } },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("./auth-session", () => ({
  redirectToLogin: mockRedirectToLogin,
  requirePublicSession: mockRequirePublicSession,
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("./tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, path: string) =>
    Promise.resolve(`/${locale}${path}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const coinPackId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const episodeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const packForm = (): FormData => {
  const data = new FormData();
  data.set("coinPackId", coinPackId);
  data.set("locale", "en");
  data.set("tenantId", tenantId);

  return data;
};

const gatePackForm = (): FormData => {
  const data = packForm();
  data.set("episodeId", episodeId);
  data.set("episodePublicId", "EP_001");
  data.set("seriesPublicId", "SERIES_001");

  return data;
};

describe("startCoinPackCheckoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Send the reader from their coins to the checkout of the pack", async () => {
    mockStartCoinPackCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/pack",
    });

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(packForm())).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/pack"
    );
    expect(mockStartCoinPackCheckout).toHaveBeenCalledWith(
      {
        coinPackId,
        locale: "en",
        returnEpisodeId: "",
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/my/coins",
      tenantId
    );
  });

  it("Have the checkout send a reader from an episode's gate back to it", async () => {
    mockStartCoinPackCheckout.mockResolvedValueOnce({
      checkoutUrl: "https://checkout.stripe.test/pack",
    });

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(gatePackForm())).rejects.toThrow(
      "NEXT_REDIRECT:https://checkout.stripe.test/pack"
    );
    expect(mockStartCoinPackCheckout.mock.calls[0]?.[0]).toMatchObject({
      returnEpisodeId: episodeId,
    });
  });

  it("Start nothing for a gate form that names half an episode", async () => {
    const form = packForm();
    form.set("episodeId", episodeId);

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/"
    );
    expect(mockStartCoinPackCheckout).not.toHaveBeenCalled();
  });

  it("Tell a reader on their coins that the pack is no longer on sale", async () => {
    mockStartCoinPackCheckout.mockRejectedValueOnce(
      new ConnectError("pack not found", Code.NotFound)
    );

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(packForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/my/coins?checkout=unavailable"
    );
  });

  it("Tell a reader at the gate that the checkout could not be started", async () => {
    mockStartCoinPackCheckout.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(gatePackForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/series/SERIES_001/episodes/EP_001?coins=pack_error"
    );
  });

  it("Send a reader whose session was rejected to sign in again", async () => {
    mockStartCoinPackCheckout.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { startCoinPackCheckoutAction } = await import("./coin-actions");

    await expect(startCoinPackCheckoutAction(gatePackForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?returnTo=/series/SERIES_001/episodes/EP_001"
    );
  });
});
