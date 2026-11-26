import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAccessToken,
  mockGetMfaStatus,
  mockListPasskeys,
  mockReauthenticate,
  mockWriteStepUpCookie,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetMfaStatus: vi.fn(),
  mockListPasskeys: vi.fn(),
  mockReauthenticate: vi.fn(),
  mockWriteStepUpCookie: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./step-up", () => ({
  writeStepUpCookie: mockWriteStepUpCookie,
}));

vi.mock("./api", () => ({
  apiClient: {
    auth: {
      getMfaStatus: mockGetMfaStatus,
      listPasskeys: mockListPasskeys,
      reauthenticate: mockReauthenticate,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const SESSION_HEADERS = { headers: { Authorization: "Bearer session-token" } };

const refused = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("withReauthentication", () => {
  it("answers what the work answered", async () => {
    const { withReauthentication } = await import("./reauthentication");

    await expect(
      withReauthentication("TENANT001", "en", () =>
        Promise.resolve({ ok: true as const })
      )
    ).resolves.toEqual({ ok: true });
  });

  it("asks for a re-authentication, with the factors the account holds, when the API refuses for want of one", async () => {
    mockGetMfaStatus.mockResolvedValueOnce({ enabled: true });
    mockListPasskeys.mockResolvedValueOnce({ passkeys: [{ id: "passkey" }] });

    const { isReauthenticationRequired, withReauthentication } =
      await import("./reauthentication");

    const result = await withReauthentication("TENANT001", "en", () =>
      Promise.reject(
        refused(Code.PermissionDenied, "REAUTHENTICATION_REQUIRED")
      )
    );

    expect(result).toEqual({
      message: "Confirm it's you to make this change.",
      ok: false,
      reauthentication: {
        authenticator: true,
        passkey: true,
        tenantId: "TENANT001",
      },
    });
    expect(isReauthenticationRequired(result)).toBe(true);
    expect(mockGetMfaStatus).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
  });

  it("still offers the password when the account's factors cannot be read", async () => {
    mockGetMfaStatus.mockRejectedValueOnce(
      new ConnectError("busy", Code.Unavailable)
    );
    mockListPasskeys.mockResolvedValueOnce({ passkeys: [] });
    const { withReauthentication } = await import("./reauthentication");

    await expect(
      withReauthentication("TENANT001", "en", () =>
        Promise.reject(
          refused(Code.PermissionDenied, "REAUTHENTICATION_REQUIRED")
        )
      )
    ).resolves.toMatchObject({
      reauthentication: { authenticator: false, passkey: false },
    });
  });

  it("lets any other failure through", async () => {
    const { withReauthentication } = await import("./reauthentication");
    const error = new ConnectError("denied", Code.PermissionDenied);

    await expect(
      withReauthentication("TENANT001", "en", () => Promise.reject(error))
    ).rejects.toBe(error);
  });
});

describe("reauthenticateAdmin", () => {
  it("keeps the step-up token the password earned", async () => {
    mockReauthenticate.mockResolvedValueOnce({
      stepUpToken: {
        expiresAt: "2026-11-26T10:15:00Z",
        token: "step-up-token",
      },
    });
    const { reauthenticateAdmin } = await import("./reauthentication");

    await expect(
      reauthenticateAdmin("TENANT001", { password: "correct horse" }, "en")
    ).resolves.toEqual({ ok: true });
    expect(mockReauthenticate).toHaveBeenCalledWith(
      {
        confirmation: undefined,
        password: "correct horse",
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
    expect(mockWriteStepUpCookie).toHaveBeenCalledWith({
      expiresAt: Temporal.Instant.from("2026-11-26T10:15:00Z"),
      token: "step-up-token",
    });
  });

  it("sends a second factor in place of the password", async () => {
    mockReauthenticate.mockResolvedValueOnce({
      stepUpToken: {
        expiresAt: "2026-11-26T10:15:00Z",
        token: "step-up-token",
      },
    });
    const { reauthenticateAdmin } = await import("./reauthentication");

    await reauthenticateAdmin(
      "TENANT001",
      { confirmation: { code: "123456", passkeyCredentialJson: "" } },
      "en"
    );

    expect(mockReauthenticate).toHaveBeenCalledWith(
      {
        confirmation: { code: "123456", passkeyCredentialJson: "" },
        password: "",
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
  });

  it("puts a wrong password on the password field", async () => {
    mockReauthenticate.mockRejectedValueOnce(
      new ConnectError("invalid password", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "password" }] },
        },
      ])
    );
    const { reauthenticateAdmin } = await import("./reauthentication");

    await expect(
      reauthenticateAdmin("TENANT001", { password: "wrong" }, "en")
    ).resolves.toEqual({
      fieldErrors: { password: "The password is not correct." },
      message: "The password is not correct.",
      ok: false,
    });
    expect(mockWriteStepUpCookie).not.toHaveBeenCalled();
  });

  // A refused code is `unauthenticated`, as a session that is gone is, and
  // must not sign the operator out.
  it("answers a wrong code with a message rather than a sign-out", async () => {
    mockReauthenticate.mockRejectedValueOnce(
      refused(Code.Unauthenticated, "MFA_INVALID_CODE")
    );
    const { reauthenticateAdmin } = await import("./reauthentication");

    await expect(
      reauthenticateAdmin(
        "TENANT001",
        { confirmation: { code: "000000", passkeyCredentialJson: "" } },
        "en"
      )
    ).resolves.toMatchObject({ ok: false });
  });

  it("lets a session that is gone through to the sign-out", async () => {
    const error = new ConnectError("invalid token", Code.Unauthenticated);
    mockReauthenticate.mockRejectedValueOnce(error);
    const { reauthenticateAdmin } = await import("./reauthentication");

    await expect(
      reauthenticateAdmin("TENANT001", { password: "correct horse" }, "en")
    ).rejects.toBe(error);
  });
});
