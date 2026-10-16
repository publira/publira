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
  mockDeletePasskey,
  mockFinishPasskeyRegistration,
  mockFinishPasskeyVerification,
  mockGetAccessToken,
  mockGetMfaStatus,
  mockListPasskeys,
  mockRenamePasskey,
} = vi.hoisted(() => ({
  mockBeginPasskeyRegistration: vi.fn(),
  mockBeginPasskeyVerification: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeletePasskey: vi.fn(),
  mockFinishPasskeyRegistration: vi.fn(),
  mockFinishPasskeyVerification: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetMfaStatus: vi.fn(),
  mockListPasskeys: vi.fn(),
  mockRenamePasskey: vi.fn(),
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
      deletePasskey: mockDeletePasskey,
      finishPasskeyRegistration: mockFinishPasskeyRegistration,
      finishPasskeyVerification: mockFinishPasskeyVerification,
      getMfaStatus: mockGetMfaStatus,
      listPasskeys: mockListPasskeys,
      renamePasskey: mockRenamePasskey,
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
    mockListPasskeys.mockResolvedValue({ passkeys: [] });
  });

  it("returns the MFA status of the signed-in administrator", async () => {
    mockGetMfaStatus.mockResolvedValueOnce({
      enabled: true,
      remainingRecoveryCodes: 8,
      required: false,
    });
    mockListPasskeys.mockResolvedValueOnce({
      passkeys: [
        {
          backedUp: true,
          createdAt: "2026-10-01T09:30:00Z",
          id: "PASSKEY00001",
          lastUsedAt: "2026-10-02T10:00:00Z",
          name: "Work laptop",
        },
      ],
    });

    const { getAdminMfaStatus } = await import("./admin-mfa");
    const result = await getAdminMfaStatus("TENANT001");

    expect(result).toEqual({
      ok: true,
      status: {
        enabled: true,
        passkeys: [
          {
            createdAt: "2026-10-01T09:30:00Z",
            id: "PASSKEY00001",
            lastUsedAt: "2026-10-02T10:00:00Z",
            name: "Work laptop",
          },
        ],
        remainingRecoveryCodes: 8,
        required: false,
      },
    });
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListPasskeys).toHaveBeenCalledWith(
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
      passkeyId: "",
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

describe("passkey registration from the account settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("begins the ceremony for the signed-in account", async () => {
    mockBeginPasskeyRegistration.mockResolvedValueOnce({
      creationOptionsJson: '{"challenge":"abc"}',
    });

    const { beginAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      beginAdminPasskeyRegistration("TENANT001", "", "en")
    ).resolves.toEqual({ ok: true, optionsJson: '{"challenge":"abc"}' });
    expect(mockBeginPasskeyRegistration).toHaveBeenCalledWith(
      { challengeToken: "", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("answers the stored passkey, and no session of its own", async () => {
    mockFinishPasskeyRegistration.mockResolvedValueOnce({
      passkey: { id: "PASSKEY00002" },
      recoveryCodes: [],
    });

    const { finishAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      finishAdminPasskeyRegistration("TENANT001", "", "{}", "en")
    ).resolves.toEqual({
      ok: true,
      passkeyId: "PASSKEY00002",
      recoveryCodes: [],
      session: null,
    });
    expect(mockFinishPasskeyRegistration).toHaveBeenCalledWith(
      {
        challengeToken: "",
        credentialJson: "{}",
        name: "",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    [
      "a credential the API could not verify",
      reasonError(Code.InvalidArgument, "MFA_PASSKEY_REFUSED"),
      "The passkey could not be registered. Try again.",
    ],
    [
      "a credential the account already holds",
      new ConnectError("passkey is already registered", Code.AlreadyExists),
      "This passkey is already registered to your account.",
    ],
  ])("words %s", async (_case, error, message) => {
    mockFinishPasskeyRegistration.mockRejectedValueOnce(error);

    const { finishAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      finishAdminPasskeyRegistration("TENANT001", "", "{}", "en")
    ).resolves.toEqual({ challengeExpired: false, message, ok: false });
  });

  // A session the API rejected is the login redirect's to handle, not a
  // challenge that ran out.
  it("rethrows a rejected session for the re-authentication flow", async () => {
    const error = new ConnectError("invalid token", Code.Unauthenticated);
    mockBeginPasskeyRegistration.mockRejectedValueOnce(error);

    const { beginAdminPasskeyRegistration } = await import("./admin-mfa");

    await expect(
      beginAdminPasskeyRegistration("TENANT001", "", "en")
    ).rejects.toBe(error);
  });
});

describe("renaming and removing a passkey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("names the passkey the row stands for", async () => {
    mockRenamePasskey.mockResolvedValueOnce({});

    const { renameAdminPasskey } = await import("./admin-mfa");

    await expect(
      renameAdminPasskey("TENANT001", "PASSKEY00001", "Phone", "en")
    ).resolves.toEqual({ ok: true });
    expect(mockRenamePasskey).toHaveBeenCalledWith(
      { id: "PASSKEY00001", name: "Phone", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a name the API found too long", async () => {
    mockRenamePasskey.mockRejectedValueOnce(
      new ConnectError(
        "name must be at most 64 characters",
        Code.InvalidArgument
      )
    );

    const { renameAdminPasskey } = await import("./admin-mfa");

    await expect(
      renameAdminPasskey("TENANT001", "PASSKEY00001", "x", "en")
    ).resolves.toEqual({
      message: "Use 64 characters or fewer for the name.",
      ok: false,
    });
  });

  it.each([
    [
      "the last second factor the tenant requires",
      new ConnectError(
        "the last second factor cannot be removed while two-step verification is required",
        Code.FailedPrecondition
      ),
      "This is the last second factor on your account, and this tenant requires two-step verification for administrators. Add another passkey or set up an authenticator app before removing it.",
    ],
    [
      "a passkey that is already gone",
      new ConnectError("passkey not found", Code.NotFound),
      "That passkey is no longer registered to your account.",
    ],
  ])("words a removal refused for %s", async (_case, error, message) => {
    mockDeletePasskey.mockRejectedValueOnce(error);

    const { deleteAdminPasskey } = await import("./admin-mfa");

    await expect(
      deleteAdminPasskey("TENANT001", "PASSKEY00001", "en")
    ).resolves.toEqual({ message, ok: false });
  });

  it("removes the passkey the row stands for", async () => {
    mockDeletePasskey.mockResolvedValueOnce({});

    const { deleteAdminPasskey } = await import("./admin-mfa");

    await expect(
      deleteAdminPasskey("TENANT001", "PASSKEY00001", "en")
    ).resolves.toEqual({ ok: true });
    expect(mockDeletePasskey).toHaveBeenCalledWith(
      { id: "PASSKEY00001", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});
