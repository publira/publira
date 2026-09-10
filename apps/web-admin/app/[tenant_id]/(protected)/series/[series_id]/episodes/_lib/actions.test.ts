import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateEpisode,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockRedirect,
  mockReorderEpisodePage,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockRedirect: vi.fn(),
  mockReorderEpisodePage: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(sharedCatalog("en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/dashboard", () => ({
  tenantDashboardCacheTag: (tenantId: string) => `tenant:${tenantId}:dashboard`,
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/episode", () => ({
  createEpisode: mockCreateEpisode,
  reorderEpisodePage: mockReorderEpisodePage,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

const createEpisodeFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("series_public_id", "SERIES001");
  formData.set("title", "Episode title");
  formData.set("price", "0");
  formData.set("reading_period_hours", "24");
  return formData;
};

describe("episode create actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetTenantDisplayTimeZone.mockResolvedValue("Asia/Tokyo");
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("creating an episode clears the dashboard tag so the new draft is counted at once", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      episode: { publicId: "EP001" },
      ok: true,
    });

    const { createEpisodeAction } = await import("./actions");

    await createEpisodeAction(null, createEpisodeFormData());

    // The dashboard counts drafts and lists them in its publishing queue, so a
    // new episode changes what it shows.
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:dashboard");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/series/SERIES001/episodes/EP001?created=1"
    );
  });

  it("leaves the cache alone when the episode cannot be created", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      message: "Could not create the episode.",
      ok: false,
    });

    const { createEpisodeAction } = await import("./actions");

    const result = await createEpisodeAction(null, createEpisodeFormData());

    expect(result).toEqual({
      message: "Could not create the episode.",
      mode: "create",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
