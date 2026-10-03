import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformPolicy,
  getPlatformRetentionDefaults,
  platformPolicyCacheTag,
  platformRetentionDefaultsCacheTag,
} from "./platform-policy";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetPlatformLocale,
  mockGetPlatformPolicy,
  mockGetPlatformRetentionDefaults,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformPolicy: vi.fn(),
  mockGetPlatformRetentionDefaults: vi.fn(),
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
    policy: {
      getPlatformPolicy: mockGetPlatformPolicy,
      getPlatformRetentionDefaults: mockGetPlatformRetentionDefaults,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: vi.fn(),
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

const serviceHeaders = { headers: { Authorization: "Bearer service-token" } };

/** What `dropFailedCacheEntry` sets: the entry is never stored. */
const droppedEntry = { expire: 0, revalidate: 0, stale: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
});

describe("getPlatformPolicy", () => {
  it("reads the policy with the service credential under the policy tag", async () => {
    mockGetPlatformPolicy.mockResolvedValueOnce({
      policy: { mfaRequiredForTenantAdmin: true },
      revision: 7n,
    });

    await expect(getPlatformPolicy()).resolves.toMatchObject({
      ok: true,
      revision: "7",
      values: { security: { mfaRequiredForTenantAdmin: true } },
    });
    expect(mockGetPlatformPolicy).toHaveBeenCalledWith({}, serviceHeaders);
    expect(platformPolicyCacheTag).toBe("platform:policy");
    expect(mockCacheTag).toHaveBeenCalledWith(platformPolicyCacheTag);
    // Refreshed after a minute: `publiractl policy` writes the row straight
    // to Postgres, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformPolicy()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockGetPlatformPolicy).not.toHaveBeenCalled();
  });

  it("returns a failure as a value and keeps it out of the cache", async () => {
    mockGetPlatformPolicy.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformPolicy()).resolves.toMatchObject({ ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith(droppedEntry);
  });

  it("words a failure in the operator's locale", async () => {
    mockGetPlatformPolicy.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformPolicy()).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});

describe("getPlatformRetentionDefaults", () => {
  it("reads the defaults with the service credential under their own tag", async () => {
    mockGetPlatformRetentionDefaults.mockResolvedValueOnce({
      defaults: { contentEventDays: 90 },
      revision: 2n,
    });

    await expect(getPlatformRetentionDefaults()).resolves.toMatchObject({
      ok: true,
      revision: "2",
      values: { contentEventDays: 90 },
    });
    expect(mockGetPlatformRetentionDefaults).toHaveBeenCalledWith(
      {},
      serviceHeaders
    );
    expect(platformRetentionDefaultsCacheTag).toBe(
      "platform:retention-defaults"
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      platformRetentionDefaultsCacheTag
    );
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformRetentionDefaults()).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetPlatformRetentionDefaults).not.toHaveBeenCalled();
  });

  it("returns a failure as a value and keeps it out of the cache", async () => {
    mockGetPlatformRetentionDefaults.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformRetentionDefaults()).resolves.toMatchObject({
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith(droppedEntry);
  });
});
