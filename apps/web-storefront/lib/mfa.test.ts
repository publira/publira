import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { IdentityProvider } from "@publira/api-client/public/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConfirmMfaEnrollment,
  mockDisableMfa,
  mockGetMfaStatus,
  mockRegenerateMfaRecoveryCodes,
  mockResolveAccessToken,
  mockStartMfaEnrollment,
} = vi.hoisted(() => ({
  mockConfirmMfaEnrollment: vi.fn(),
  mockDisableMfa: vi.fn(),
  mockGetMfaStatus: vi.fn(),
  mockRegenerateMfaRecoveryCodes: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockStartMfaEnrollment: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      confirmMfaEnrollment: mockConfirmMfaEnrollment,
      disableMfa: mockDisableMfa,
      getMfaStatus: mockGetMfaStatus,
      regenerateMfaRecoveryCodes: mockRegenerateMfaRecoveryCodes,
      startMfaEnrollment: mockStartMfaEnrollment,
    },
  },
  buildClientAddressHeaders: () => Promise.resolve({ headers: {} }),
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const SESSION = { headers: { Authorization: "Bearer sid_001" } };

const reasonError = (code: Code, reason: string) =>
  new ConnectError("no", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

describe("getMyMfaStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("answers whether the reader holds an authenticator", async () => {
    const { getMyMfaStatus } = await import("./mfa");
    mockGetMfaStatus.mockResolvedValueOnce({
      enabled: true,
      enabledAt: "2030-01-01T00:00:00Z",
      remainingRecoveryCodes: 10,
    });

    await expect(getMyMfaStatus("TENANT001")).resolves.toEqual({
      enabled: true,
      enabledAt: "2030-01-01T00:00:00Z",
      remainingRecoveryCodes: 10,
    });
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      SESSION
    );
  });

  it("answers nothing without a session", async () => {
    const { getMyMfaStatus } = await import("./mfa");
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getMyMfaStatus("TENANT001")).resolves.toBeNull();
    expect(mockGetMfaStatus).not.toHaveBeenCalled();
  });
});

describe("changes to the reader's authenticator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("starts an enrollment with the secret and its URI", async () => {
    const { startMyMfaEnrollment } = await import("./mfa");
    mockStartMfaEnrollment.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Site:reader?secret=ABC",
      secret: "ABC",
    });

    await expect(startMyMfaEnrollment("TENANT001")).resolves.toEqual({
      ok: true,
      otpauthUri: "otpauth://totp/Site:reader?secret=ABC",
      secret: "ABC",
    });
  });

  it("answers the recovery codes a confirmation issued", async () => {
    const { confirmMyMfaEnrollment } = await import("./mfa");
    mockConfirmMfaEnrollment.mockResolvedValueOnce({
      recoveryCodes: ["aaaaa-11111", "bbbbb-22222"],
    });

    await expect(
      confirmMyMfaEnrollment("TENANT001", "123456")
    ).resolves.toEqual({
      ok: true,
      recoveryCodes: ["aaaaa-11111", "bbbbb-22222"],
    });
    expect(mockConfirmMfaEnrollment).toHaveBeenCalledWith(
      { code: "123456", tenant: { tenantId: "TENANT001" } },
      SESSION
    );
  });

  it.each([
    ["a wrong code", Code.Unauthenticated, "MFA_INVALID_CODE", "invalid_code"],
    ["a locked account", Code.ResourceExhausted, "MFA_LOCKED", "locked"],
  ])(
    "keeps the form on %s, which is no lost session",
    async (_case, code, reason, refusal) => {
      const { regenerateMyMfaRecoveryCodes } = await import("./mfa");
      mockRegenerateMfaRecoveryCodes.mockRejectedValueOnce(
        reasonError(code, reason)
      );

      await expect(
        regenerateMyMfaRecoveryCodes("TENANT001", "123456")
      ).resolves.toEqual({ code: refusal, ok: false });
    }
  );

  it("rethrows a session the API rejects", async () => {
    const { regenerateMyMfaRecoveryCodes } = await import("./mfa");
    const rejected = new ConnectError("session", Code.Unauthenticated);
    mockRegenerateMfaRecoveryCodes.mockRejectedValueOnce(rejected);

    await expect(
      regenerateMyMfaRecoveryCodes("TENANT001", "123456")
    ).rejects.toBe(rejected);
  });

  it("answers any other refusal for the form to word", async () => {
    const { startMyMfaEnrollment, isMfaSetUpInConsoleError } =
      await import("./mfa");

    const refused = reasonError(
      Code.FailedPrecondition,
      "MFA_SET_UP_IN_CONSOLE"
    );

    mockStartMfaEnrollment.mockRejectedValueOnce(refused);

    const outcome = await startMyMfaEnrollment("TENANT001");

    expect(outcome).toEqual({ error: refused, ok: false });
    expect(isMfaSetUpInConsoleError(refused)).toBe(true);
  });

  it("turns two-step verification off with the password and a code", async () => {
    const { disableMyMfa } = await import("./mfa");
    mockDisableMfa.mockResolvedValueOnce({});

    await expect(
      disableMyMfa("TENANT001", "123456", { password: "pw" })
    ).resolves.toEqual({ ok: true });
    expect(mockDisableMfa).toHaveBeenCalledWith(
      { code: "123456", password: "pw", tenant: { tenantId: "TENANT001" } },
      SESSION
    );
  });

  it("turns two-step verification off with a fresh sign-in", async () => {
    const { disableMyMfa } = await import("./mfa");
    mockDisableMfa.mockResolvedValue({});

    await disableMyMfa("TENANT001", "abcde-12345", {
      idToken: "id.token",
      nonce: "nonce",
      provider: "apple",
    });
    await disableMyMfa("TENANT001", "123456", {
      passkeyCredential: '{"id":"cred"}',
    });

    expect(mockDisableMfa).toHaveBeenNthCalledWith(
      1,
      {
        code: "abcde-12345",
        idToken: "id.token",
        nonce: "nonce",
        provider: IdentityProvider.APPLE,
        tenant: { tenantId: "TENANT001" },
      },
      SESSION
    );
    expect(mockDisableMfa).toHaveBeenNthCalledWith(
      2,
      {
        code: "123456",
        passkeyCredentialJson: '{"id":"cred"}',
        tenant: { tenantId: "TENANT001" },
      },
      SESSION
    );
  });
});
