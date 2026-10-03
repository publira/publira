import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformDashboardSummary,
  platformDashboardCacheTag,
} from "./dashboard";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetDashboardSummary,
  mockGetPlatformLocale,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetDashboardSummary: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
  apiClient: {
    dashboard: {
      getDashboardSummary: mockGetDashboardSummary,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPlatformDashboardSummary", () => {
  it("formats and returns the dashboard summary", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      activeTenants: 10,
      pendingEndUsers: 4,
      recentEvents: [
        {
          action: "Tenant Created",
          actor: "system",
          at: "2026-03-24T10:00:00Z",
          eventType: "tenant_created",
          target: "tenant_hoshikawa",
        },
      ],
      suspendedTenants: 2,
      totalTenants: 12,
    });

    await expect(
      getPlatformDashboardSummary({ recentEventsLimit: 6 })
    ).resolves.toEqual({
      ok: true,
      summary: {
        activeTenants: 10,
        pendingEndUsers: 4,
        recentEvents: [
          {
            action: "Tenant Created",
            actor: "system",
            at: "2026-03-24T10:00:00Z",
            eventType: "tenant_created",
            target: "tenant_hoshikawa",
          },
        ],
        suspendedTenants: 2,
        totalTenants: 12,
      },
    });

    expect(mockGetDashboardSummary).toHaveBeenCalledWith(
      { recentEventsLimit: 6 },
      { headers: { Authorization: "Bearer service-token" } }
    );
  });

  it("clamps recentEventsLimit outside the allowed range", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      activeTenants: 0,
      pendingEndUsers: 0,
      recentEvents: [],
      suspendedTenants: 0,
      totalTenants: 0,
    });

    await getPlatformDashboardSummary({ recentEventsLimit: 999 });

    expect(mockGetDashboardSummary).toHaveBeenCalledWith(
      { recentEventsLimit: 50 },
      { headers: { Authorization: "Bearer service-token" } }
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformDashboardSummary()).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetDashboardSummary).not.toHaveBeenCalled();
  });

  it("words a failure in the operator's locale, so ja is Japanese", async () => {
    mockGetPlatformLocale.mockResolvedValueOnce("ja");
    mockGetDashboardSummary.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformDashboardSummary()).resolves.toEqual({
      message: expect.stringMatching(/サーバー/u),
      ok: false,
    });
  });

  it("returns a shared message for unavailable errors", async () => {
    mockGetDashboardSummary.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformDashboardSummary()).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });

  it("returns an unclassified failure as a value instead of throwing inside the cache scope", async () => {
    mockGetDashboardSummary.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformDashboardSummary()).resolves.toMatchObject({
      ok: false,
    });
    // Dropped, so the dashboard comes back as soon as the API does.
    expect(mockCacheLife).toHaveBeenLastCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("dashboard cache tag", () => {
  it("files the dashboard under the dashboard tag", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({ recentEvents: [] });

    await getPlatformDashboardSummary();

    expect(platformDashboardCacheTag).toBe("platform:dashboard");
    expect(mockCacheTag).toHaveBeenCalledWith(platformDashboardCacheTag);
    // Refreshed after a minute: sign-ups and tenant consoles change it
    // without clearing the tag.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });
});
