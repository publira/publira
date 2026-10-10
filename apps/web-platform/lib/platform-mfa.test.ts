import {
  Code,
  ConnectError,
  ErrorInfoSchema,
  RPC_ERROR_REASON,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "./messages";

const {
  mockCacheLife,
  mockCacheTag,
  mockDisableMfa,
  mockGetMfaStatus,
  mockResolveAccessToken,
  mockVerifyMfa,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDisableMfa: vi.fn(),
  mockGetMfaStatus: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockVerifyMfa: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      disableMfa: mockDisableMfa,
      getMfaStatus: mockGetMfaStatus,
      verifyMfa: mockVerifyMfa,
    },
  },
  buildClientAddressHeaders: () =>
    Promise.resolve({ headers: { "X-Forwarded-For": "203.0.113.7" } }),
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const reasonError = (code: Code, reason: string): ConnectError =>
  new ConnectError("refused", code, undefined, [
    {
      desc: ErrorInfoSchema,
      value: { domain: "publira", reason },
    },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockResolveAccessToken.mockResolvedValue("session-token");
});

describe("getPlatformMfaStatus", () => {
  it("returns the MFA status of the signed-in operator under its tag", async () => {
    mockGetMfaStatus.mockResolvedValueOnce({
      enabled: true,
      remainingRecoveryCodes: 8,
      required: true,
    });

    const { getPlatformMfaStatus, PLATFORM_MFA_STATUS_CACHE_TAG } =
      await import("./platform-mfa");

    await expect(getPlatformMfaStatus()).resolves.toEqual({
      ok: true,
      status: { enabled: true, remainingRecoveryCodes: 8, required: true },
    });
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(PLATFORM_MFA_STATUS_CACHE_TAG);
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a fresh sign-in and drops the cache entry when there is no session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { getPlatformMfaStatus } = await import("./platform-mfa");

    await expect(getPlatformMfaStatus()).resolves.toEqual({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetMfaStatus).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh sign-in when the session is rejected", async () => {
    mockGetMfaStatus.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );

    const { getPlatformMfaStatus } = await import("./platform-mfa");

    await expect(getPlatformMfaStatus()).resolves.toEqual({
      ok: false,
      requiresSignIn: true,
    });
  });
});

describe("verifyPlatformMfa", () => {
  it("hands back the session the code earned", async () => {
    mockVerifyMfa.mockResolvedValueOnce({
      accessToken: { expiresAt: "2026-10-01T00:00:00Z", token: "tok" },
      recoveryCodeUsed: true,
      remainingRecoveryCodes: 9,
    });

    const { verifyPlatformMfa } = await import("./platform-mfa");

    await expect(
      verifyPlatformMfa("challenge-token", "123456", "en")
    ).resolves.toEqual({
      ok: true,
      recoveryCodeUsed: true,
      remainingRecoveryCodes: 9,
      session: {
        accessToken: "tok",
        expiresAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
      },
    });
    expect(mockVerifyMfa).toHaveBeenCalledWith(
      { challengeToken: "challenge-token", code: "123456" },
      { headers: { "X-Forwarded-For": "203.0.113.7" } }
    );
  });

  // A refused code and a spent challenge share `unauthenticated`; only the
  // reason says the operator mistyped rather than ran out of time.
  it("tells a wrong code from an expired challenge", async () => {
    const t = await getMessagesFor("en");
    const { verifyPlatformMfa } = await import("./platform-mfa");

    mockVerifyMfa.mockRejectedValueOnce(
      reasonError(Code.Unauthenticated, RPC_ERROR_REASON.mfaInvalidCode)
    );
    await expect(verifyPlatformMfa("c", "000000", "en")).resolves.toEqual({
      challengeExpired: false,
      message: t("platform.auth.mfa.errors.invalid_code"),
      ok: false,
    });

    mockVerifyMfa.mockRejectedValueOnce(
      reasonError(Code.ResourceExhausted, RPC_ERROR_REASON.mfaLocked)
    );
    await expect(verifyPlatformMfa("c", "000000", "en")).resolves.toEqual({
      challengeExpired: false,
      message: t("platform.auth.mfa.errors.locked"),
      ok: false,
    });

    mockVerifyMfa.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );
    await expect(verifyPlatformMfa("c", "000000", "en")).resolves.toEqual({
      challengeExpired: true,
      message: t("platform.auth.mfa.expired"),
      ok: false,
    });
  });
});

describe("disablePlatformMfa", () => {
  it("keeps a wrong code on the form", async () => {
    mockDisableMfa.mockRejectedValueOnce(
      reasonError(Code.Unauthenticated, RPC_ERROR_REASON.mfaInvalidCode)
    );
    const t = await getMessagesFor("en");

    const { disablePlatformMfa } = await import("./platform-mfa");

    await expect(disablePlatformMfa("000000", "en")).resolves.toEqual({
      message: t("platform.auth.mfa.errors.invalid_code"),
      ok: false,
    });
  });

  // A rejected session is no message next to the code field: it leaves as a
  // throw, which `withPlatformSessionReauth` turns into the sign-in redirect.
  it("rethrows a rejected session", async () => {
    const rejected = new ConnectError("invalid token", Code.Unauthenticated);
    mockDisableMfa.mockRejectedValueOnce(rejected);

    const { disablePlatformMfa } = await import("./platform-mfa");

    await expect(disablePlatformMfa("123456", "en")).rejects.toBe(rejected);
  });
});
