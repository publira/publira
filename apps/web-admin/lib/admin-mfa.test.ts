import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBeginPasskeyRegistration,
  mockBeginPasskeyVerification,
  mockCacheLife,
  mockCacheTag,
  mockFinishPasskeyRegistration,
  mockFinishPasskeyVerification,
  mockGetAccessToken,
  mockGetMfaStatus,
} = vi.hoisted(() => ({
  mockBeginPasskeyRegistration: vi.fn(),
  mockBeginPasskeyVerification: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockFinishPasskeyRegistration: vi.fn(),
  mockFinishPasskeyVerification: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetMfaStatus: vi.fn(),
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
    auth: {
      beginPasskeyRegistration: mockBeginPasskeyRegistration,
      beginPasskeyVerification: mockBeginPasskeyVerification,
      finishPasskeyRegistration: mockFinishPasskeyRegistration,
      finishPasskeyVerification: mockFinishPasskeyVerification,
      getMfaStatus: mockGetMfaStatus,
    },
  },
  withClientAddressHeaders: () => Promise.resolve({ headers: {} }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAdminMfaStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the MFA status of the signed-in administrator", async () => {
    mockGetMfaStatus.mockResolvedValueOnce({
      enabled: true,
      remainingRecoveryCodes: 8,
      required: false,
    });

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({
      ok: true,
      status: { enabled: true, remainingRecoveryCodes: 8, required: false },
    });
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:admin-mfa-status"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a fresh login and drops the cache entry when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockGetMfaStatus).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh login and drops the cache entry when the session is rejected", async () => {
    mockGetMfaStatus.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws any other error only outside the cache scope, and logs its cause there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Asserted below.
    });
    const error = new ConnectError("upstream down", Code.Unavailable);
    mockGetMfaStatus.mockRejectedValueOnce(error);

    const { getAdminMfaStatus } = await import("./admin-mfa");

    await expect(getAdminMfaStatus("TENANT001")).rejects.toThrow(
      "The second factor's status could not be read."
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      "[web-admin] getAdminMfaStatus failed",
      error
    );
  });
});

const reasonError = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

describe("passkey verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("answers the request options the API began the ceremony with", async () => {
    mockBeginPasskeyVerification.mockResolvedValueOnce({
      requestOptionsJson: '{"challenge":"abc"}',
    });

    const { beginAdminPasskeyVerification } = await import("./admin-mfa");
    const result = await beginAdminPasskeyVerification(
      "TENANT001",
      "challenge-token",
      "en"
    );

    expect(result).toEqual({ ok: true, optionsJson: '{"challenge":"abc"}' });
    expect(mockBeginPasskeyVerification).toHaveBeenCalledWith(
      { challengeToken: "challenge-token", tenant: { tenantId: "TENANT001" } },
      { headers: {} }
    );
  });

  it("says when the account holds no passkey to answer with", async () => {
    mockBeginPasskeyVerification.mockRejectedValueOnce(
      new ConnectError("no passkey is registered", Code.FailedPrecondition)
    );

    const { beginAdminPasskeyVerification } = await import("./admin-mfa");

    await expect(
      beginAdminPasskeyVerification("TENANT001", "challenge-token", "en")
    ).resolves.toEqual({
      challengeExpired: false,
      message:
        "No passkey is registered to this account. Enter a code instead.",
      ok: false,
    });
  });

  it("answers the session a verified assertion earned", async () => {
    mockFinishPasskeyVerification.mockResolvedValueOnce({
      accessToken: { expiresAt: "2026-09-03T00:00:00Z", token: "session" },
      remainingRecoveryCodes: 10,
    });

    const { finishAdminPasskeyVerification } = await import("./admin-mfa");
    const result = await finishAdminPasskeyVerification(
      "TENANT001",
      "challenge-token",
      "{}",
      "en"
    );

    expect(result).toEqual({
      ok: true,
      session: {
        accessToken: "session",
        expiresAt: Temporal.Instant.from("2026-09-03T00:00:00Z"),
      },
    });
    expect(mockFinishPasskeyVerification).toHaveBeenCalledWith(
      {
        challengeToken: "challenge-token",
        credentialJson: "{}",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: {} }
    );
  });

  it.each([
    [
      "a refused assertion, which keeps the challenge",
      reasonError(Code.Unauthenticated, "MFA_PASSKEY_REFUSED"),
      {
        challengeExpired: false,
        message:
          "That passkey was not accepted. Use a passkey registered to this account.",
      },
    ],
    [
      "the lock a run of failures set",
      reasonError(Code.ResourceExhausted, "MFA_LOCKED"),
      {
        challengeExpired: false,
        message: "Too many failed attempts. Wait a while before trying again.",
      },
    ],
    [
      "a challenge that ran out, which goes back to the password",
      new ConnectError("invalid token", Code.Unauthenticated),
      {
        challengeExpired: true,
        message: "This sign-in has expired. Sign in again.",
      },
    ],
  ])("words %s", async (_case, error, expected) => {
    mockFinishPasskeyVerification.mockRejectedValueOnce(error);

    const { finishAdminPasskeyVerification } = await import("./admin-mfa");

    await expect(
      finishAdminPasskeyVerification("TENANT001", "challenge-token", "{}", "en")
    ).resolves.toEqual({ ...expected, ok: false });
  });

  it("rethrows a failure it cannot classify", async () => {
    const error = new ConnectError("boom", Code.Internal);
    mockFinishPasskeyVerification.mockRejectedValueOnce(error);

    const { finishAdminPasskeyVerification } = await import("./admin-mfa");

    await expect(
      finishAdminPasskeyVerification("TENANT001", "challenge-token", "{}", "en")
    ).rejects.toBe(error);
  });
});

describe("passkey registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("answers the creation options the API began the ceremony with", async () => {
    mockBeginPasskeyRegistration.mockResolvedValueOnce({
      creationOptionsJson: '{"challenge":"abc"}',
    });

    const { beginAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      beginAdminPasskeyRegistration("TENANT001", "challenge-token", "en")
    ).resolves.toEqual({ ok: true, optionsJson: '{"challenge":"abc"}' });
  });

  it("answers the recovery codes and the session the registration finished the login with", async () => {
    mockFinishPasskeyRegistration.mockResolvedValueOnce({
      accessToken: { expiresAt: "2026-09-03T00:00:00Z", token: "session" },
      recoveryCodes: ["ABCDE-FGHJK"],
    });

    const { finishAdminPasskeyRegistration } = await import("./admin-mfa");
    const result = await finishAdminPasskeyRegistration(
      "TENANT001",
      "challenge-token",
      "{}",
      "en"
    );

    expect(result).toEqual({
      ok: true,
      recoveryCodes: ["ABCDE-FGHJK"],
      session: {
        accessToken: "session",
        expiresAt: Temporal.Instant.from("2026-09-03T00:00:00Z"),
      },
    });
    expect(mockFinishPasskeyRegistration).toHaveBeenCalledWith(
      {
        challengeToken: "challenge-token",
        credentialJson: "{}",
        name: "",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: {} }
    );
  });

  it.each([
    [
      "a credential the API could not verify",
      reasonError(Code.InvalidArgument, "MFA_PASSKEY_REFUSED"),
      {
        challengeExpired: false,
        message: "The passkey could not be registered. Try again.",
      },
    ],
    [
      "a credential the tenant already holds",
      new ConnectError("passkey is already registered", Code.AlreadyExists),
      {
        challengeExpired: false,
        message: "This passkey is already registered to your account.",
      },
    ],
    [
      "an enroll challenge another login already settled",
      new ConnectError("invalid token", Code.Unauthenticated),
      {
        challengeExpired: true,
        message: "This sign-in has expired. Sign in again.",
      },
    ],
  ])("words %s", async (_case, error, expected) => {
    mockFinishPasskeyRegistration.mockRejectedValueOnce(error);

    const { finishAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      finishAdminPasskeyRegistration("TENANT001", "challenge-token", "{}", "en")
    ).resolves.toEqual({ ...expected, ok: false });
  });
});
