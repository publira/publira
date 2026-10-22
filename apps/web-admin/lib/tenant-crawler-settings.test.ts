import { CrawlerPurpose } from "@publira/api-client/admin/tenant";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantCrawlerSettingsApi,
  mockUpdateTenantCrawlerSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCrawlerSettingsApi: vi.fn(),
  mockUpdateTenantCrawlerSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantCrawlerSettings: mockGetTenantCrawlerSettingsApi,
      updateTenantCrawlerSettings: mockUpdateTenantCrawlerSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SETTINGS = {
  excludedPaths: ["/drafts"],
  excludedUserAgents: ["GPTBot", "Googlebot-Image"],
};

const KNOWN_CRAWLERS = [
  {
    operator: "OpenAI",
    purpose: CrawlerPurpose.AI_TRAINING,
    userAgent: "GPTBot",
  },
  {
    operator: "Perplexity",
    purpose: CrawlerPurpose.AI_ASSISTANT,
    userAgent: "PerplexityBot",
  },
  {
    operator: "Google",
    purpose: CrawlerPurpose.IMAGE_SEARCH,
    userAgent: "Googlebot-Image",
  },
];

const fieldViolation = (field: string) =>
  new ConnectError("rejected", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

describe("tenant-crawler-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the setting and the crawlers it may name under the tenant's tag", async () => {
    mockGetTenantCrawlerSettingsApi.mockResolvedValueOnce({
      knownCrawlers: KNOWN_CRAWLERS,
      settings: SETTINGS,
    });

    const { getTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");
    const result = await getTenantCrawlerSettings(" TENANT001 ", "en");

    expect(result).toEqual({
      knownCrawlers: [
        { operator: "OpenAI", purpose: "ai_training", userAgent: "GPTBot" },
        {
          operator: "Perplexity",
          purpose: "ai_assistant",
          userAgent: "PerplexityBot",
        },
        {
          operator: "Google",
          purpose: "image_search",
          userAgent: "Googlebot-Image",
        },
      ],
      ok: true,
      settings: SETTINGS,
    });
    expect(mockGetTenantCrawlerSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:crawler-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // Dropping it would make the next save lift the tenant's exclusion of it.
  it("keeps a crawler of a purpose this console does not know, as another crawler", async () => {
    mockGetTenantCrawlerSettingsApi.mockResolvedValueOnce({
      knownCrawlers: [
        { operator: "Example", purpose: 99, userAgent: "ExampleBot" },
      ],
    });

    const { getTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");

    await expect(getTenantCrawlerSettings("TENANT001", "en")).resolves.toEqual({
      knownCrawlers: [
        { operator: "Example", purpose: "other", userAgent: "ExampleBot" },
      ],
      ok: true,
      settings: { excludedPaths: [], excludedUserAgents: [] },
    });
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");

    await expect(getTenantCrawlerSettings("TENANT001", "en")).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantCrawlerSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming a setting and drops the cache entry", async () => {
    mockGetTenantCrawlerSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");
    const result = await getTenantCrawlerSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("settings");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantCrawlerSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");

    await expect(getTenantCrawlerSettings("TENANT001", "en")).rejects.toThrow(
      Error
    );
  });

  it("saves the whole setting and answers it as the server stored it", async () => {
    mockUpdateTenantCrawlerSettingsApi.mockResolvedValueOnce({
      settings: { excludedPaths: ["/drafts"], excludedUserAgents: ["GPTBot"] },
    });

    const { updateTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");
    const result = await updateTenantCrawlerSettings(
      {
        excludedPaths: ["/drafts/", "/drafts"],
        excludedUserAgents: ["GPTBot"],
        tenantId: " TENANT001 ",
      },
      "en"
    );

    expect(result).toEqual({
      ok: true,
      settings: { excludedPaths: ["/drafts"], excludedUserAgents: ["GPTBot"] },
    });
    expect(mockUpdateTenantCrawlerSettingsApi).toHaveBeenCalledWith(
      {
        settings: {
          excludedPaths: ["/drafts/", "/drafts"],
          excludedUserAgents: ["GPTBot"],
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    [
      "settings.excluded_paths[1]",
      {
        excludedPaths:
          '"/members" cannot be excluded. Check the path and save again.',
      },
    ],
    ["settings.excluded_paths", { excludedPaths: "List at most 100 paths." }],
    [
      "settings.excluded_user_agents[0]",
      {
        excludedUserAgents:
          "Applebot can no longer be excluded. Reload the page and choose again.",
      },
    ],
  ])(
    "words the server's refusal of %s for the part it belongs to",
    async (field, fieldErrors) => {
      mockUpdateTenantCrawlerSettingsApi.mockRejectedValueOnce(
        fieldViolation(field)
      );

      const { updateTenantCrawlerSettings } =
        await import("./tenant-crawler-settings");
      const result = await updateTenantCrawlerSettings(
        {
          excludedPaths: ["/drafts", "/members"],
          excludedUserAgents: ["Applebot"],
          tenantId: "T",
        },
        "en"
      );

      expect(result).toEqual({
        fieldErrors,
        message: Object.values(fieldErrors)[0],
        ok: false,
      });
    }
  );

  it("leaves an ended session to the caller's sign-in redirect", async () => {
    mockUpdateTenantCrawlerSettingsApi.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { updateTenantCrawlerSettings } =
      await import("./tenant-crawler-settings");

    await expect(
      updateTenantCrawlerSettings(
        { excludedPaths: [], excludedUserAgents: [], tenantId: "T" },
        "en"
      )
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
