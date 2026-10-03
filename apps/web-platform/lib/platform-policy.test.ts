import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformPolicy,
  getPlatformRetentionDefaults,
  platformPolicyCacheTag,
  platformRetentionDefaultsCacheTag,
  updatePlatformCommunityLimits,
  updatePlatformSecurityPolicy,
} from "./platform-policy";
import type { PlatformCommunityLimits } from "./platform-policy";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetPlatformLocale,
  mockGetPlatformPolicy,
  mockGetPlatformRetentionDefaults,
  mockResolveAccessToken,
  mockUpdatePlatformPolicy,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformPolicy: vi.fn(),
  mockGetPlatformRetentionDefaults: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformPolicy: vi.fn(),
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
      updatePlatformPolicy: mockUpdatePlatformPolicy,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
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

  it("reads the disposable email domain list URL as part of the security policy", async () => {
    mockGetPlatformPolicy.mockResolvedValueOnce({
      policy: { disposableEmailDomainsUrl: "https://lists.example.com/d.conf" },
      revision: 2n,
    });

    await expect(getPlatformPolicy()).resolves.toMatchObject({
      values: {
        security: {
          disposableEmailDomainsUrl: "https://lists.example.com/d.conf",
        },
      },
    });
  });
});

const listUrl = "https://lists.example.com/disposable.conf";

/** A stored policy that names a list, as `GetPlatformPolicy` answers it. */
const storedPolicy = {
  communityLimitDefaults: {
    commentPost: { perDay: 100, perMinute: 10 },
    duplicateCommentWindowMinutes: 10,
  },
  disposableEmailDomainsUrl: listUrl,
  mfaRequiredForTenantAdmin: true,
  passwordVerification: { perDay: 50, perMinute: 5 },
};

const community: PlatformCommunityLimits = {
  commentPost: { perDay: 40, perMinute: 4 },
  commentReport: { perDay: 50, perMinute: 10 },
  contactMessagePerAccount: { perDay: 10, perHour: 3 },
  contactMessagePerClient: { perDay: 30, perHour: 10 },
  duplicateCommentWindowMinutes: 10,
  episodeRating: { perDay: 300, perMinute: 30 },
  viewerPreferences: { perDay: 300, perMinute: 30 },
};

describe("savePlatformPolicy", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("session-1");
    mockGetPlatformPolicy.mockResolvedValue({
      policy: storedPolicy,
      revision: 4n,
    });
    mockUpdatePlatformPolicy.mockResolvedValue({});
  });

  // `UpdatePlatformPolicy` writes the whole row, so a value this screen does
  // not edit has to be sent back as read, or the save would clear it.
  it("keeps the stored list URL when the community limits are saved", async () => {
    await expect(
      updatePlatformCommunityLimits(community, 4n, "en")
    ).resolves.toEqual({ ok: true });

    expect(mockUpdatePlatformPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 4n,
        policy: expect.objectContaining({
          disposableEmailDomainsUrl: listUrl,
          mfaRequiredForTenantAdmin: true,
        }),
      }),
      { headers: { Authorization: "Bearer session-1" } }
    );
  });

  it("sends the list URL the security screen saves", async () => {
    await updatePlatformSecurityPolicy(
      {
        disposableEmailDomainsUrl: "",
        mailRequestsPerAddress: { perDay: 20, perHour: 5 },
        mailRequestsPerSource: { perDay: 150, perHour: 30 },
        mfaRequiredForTenantAdmin: false,
        passwordVerification: { perDay: 50, perMinute: 5 },
        storePurchaseConfirmation: { perDay: 100, perMinute: 10 },
        waitFreeTicketUse: { perDay: 100, perMinute: 10 },
      },
      4n,
      "en"
    );

    expect(mockUpdatePlatformPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ disposableEmailDomainsUrl: "" }),
      }),
      expect.anything()
    );
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
