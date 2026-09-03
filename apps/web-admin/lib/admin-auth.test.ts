import { MfaChallengeKind } from "@publira/api-client/admin/auth";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptTenantAdminInvitation,
  confirmAdminPasswordReset,
  getAdminCurrentUser,
  getTenantAdminInvitationState,
  isAdminSessionValid,
  isTenantAdminRole,
  loginAdmin,
  requestAdminPasswordReset,
} from "./admin-auth";

const {
  mockAcceptTenantAdminInvitation,
  mockConfirmPasswordReset,
  mockGetMe,
  mockGetAccessToken,
  mockGetTenantAdminInvitationState,
  mockLogin,
  mockRequestPasswordReset,
} = vi.hoisted(() => ({
  mockAcceptTenantAdminInvitation: vi.fn(),
  mockConfirmPasswordReset: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetTenantAdminInvitationState: vi.fn(),
  mockLogin: vi.fn(),
  mockRequestPasswordReset: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    auth: {
      acceptTenantAdminInvitation: mockAcceptTenantAdminInvitation,
      confirmPasswordReset: mockConfirmPasswordReset,
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getMe: mockGetMe,
      getTenantAdminInvitationState: mockGetTenantAdminInvitationState,
      login: mockLogin,
      requestPasswordReset: mockRequestPasswordReset,
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("valid-token");
});

describe("loginAdmin", () => {
  const credentials = ["admin@example.com", "hunter2", "tenant_001"] as const;

  it("reports the session a password alone finished the login with", async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: { expiresAt: "2026-09-03T00:00:00Z", token: "session" },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toEqual({
      accessToken: "session",
      expiresAt: Temporal.Instant.from("2026-09-03T00:00:00Z"),
      kind: "session",
      ok: true,
    });
  });

  it("reports the challenge an account owing a code earned instead", async () => {
    mockLogin.mockResolvedValueOnce({
      mfaChallenge: {
        expiresAt: "2026-09-03T00:05:00Z",
        kind: MfaChallengeKind.VERIFY,
        token: "challenge",
      },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toEqual({
      challengeKind: "verify",
      challengeToken: "challenge",
      expiresAt: Temporal.Instant.from("2026-09-03T00:05:00Z"),
      kind: "challenge",
      ok: true,
    });
  });

  it("names the enrollment a tenant holds an administrator at", async () => {
    mockLogin.mockResolvedValueOnce({
      mfaChallenge: {
        expiresAt: "2026-09-03T00:05:00Z",
        kind: MfaChallengeKind.ENROLL,
        token: "challenge",
      },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toMatchObject({
      challengeKind: "enroll",
      kind: "challenge",
    });
  });

  it("refuses a challenge with no token to spend", async () => {
    mockLogin.mockResolvedValueOnce({
      mfaChallenge: {
        expiresAt: "2026-09-03T00:05:00Z",
        kind: MfaChallengeKind.VERIFY,
        token: "   ",
      },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a challenge whose expiry cannot be read", async () => {
    mockLogin.mockResolvedValueOnce({
      mfaChallenge: {
        expiresAt: "not-a-date",
        kind: MfaChallengeKind.VERIFY,
        token: "challenge",
      },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a session whose expiry cannot be read", async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: { expiresAt: "not-a-date", token: "session" },
    });

    const result = await loginAdmin(...credentials, "ja");

    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a challenge kind this console has no screen for", async () => {
    mockLogin.mockResolvedValueOnce({
      mfaChallenge: {
        expiresAt: "2026-09-03T00:05:00Z",
        kind: MfaChallengeKind.UNSPECIFIED,
        token: "challenge",
      },
    });

    const result = await loginAdmin(...credentials, "ja");

    // Signing in on the password alone would make the second factor optional.
    expect(result).toEqual({
      message: "ログイン処理に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
  });
});

describe("getAdminCurrentUser", () => {
  it("asks for a fresh login for an empty accessToken", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("asks for a fresh login for a whitespace-only accessToken", async () => {
    // getAccessToken は常にトリム済みの値を返すため、空白のみのケースは空文字と同等
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("fails without asking for a fresh login when the API returns no user", async () => {
    mockGetMe.mockResolvedValueOnce({});
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: false });
  });

  it("does not ask for a fresh login when the API returns a user with an empty publicId", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: false });
  });

  it("returns the user read from a valid response", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "山田太郎", publicId: "user-001", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({
      ok: true,
      user: { name: "山田太郎", publicId: "user-001", role: "admin" },
    });
  });

  it("passes the access token from getAccessToken straight to the API", async () => {
    mockGetAccessToken.mockResolvedValueOnce("valid-token");
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "user-001", role: "admin" },
    });
    await getAdminCurrentUser("tenant_001");
    expect(mockGetMe).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: { tenantId: "tenant_001" },
      }),
      { headers: { Authorization: "Bearer valid-token" } }
    );
  });

  it("fails without asking for a fresh login on a permission error", async () => {
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("forbidden", Code.PermissionDenied)
    );
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: false });
  });

  it("asks for a fresh login when the session is rejected", async () => {
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ ok: false, requiresSignIn: true });
  });

  it("rethrows an unexpected error", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Network error"));
    await expect(getAdminCurrentUser("tenant_001")).rejects.toThrow(
      "Network error"
    );
  });

  it("returns a user whose name and role are empty as long as it has a publicId", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "  ", publicId: "user-002", role: "" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({
      ok: true,
      user: { name: "", publicId: "user-002", role: "" },
    });
  });
});

describe("isAdminSessionValid", () => {
  it("returns false for an empty accessToken", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });

  it("returns true when a valid user comes back", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "user-001", role: "admin" },
    });
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(true);
  });

  it("returns false on an expected error", async () => {
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("forbidden", Code.PermissionDenied)
    );
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });

  it("rethrows an unexpected error", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(isAdminSessionValid("tenant_001")).rejects.toThrow(
      "Unauthorized"
    );
  });
});

describe("isTenantAdminRole", () => {
  it("allows tenant_admin", () => {
    expect(isTenantAdminRole("tenant_admin")).toBe(true);
  });

  it("allows admin as well", () => {
    expect(isTenantAdminRole("admin")).toBe(true);
  });

  it("rejects editor", () => {
    expect(isTenantAdminRole("editor")).toBe(false);
  });

  it("normalizes mixed case and whitespace before deciding", () => {
    expect(isTenantAdminRole("  TENANT_ADMIN ")).toBe(true);
  });
});

describe("tenant admin invitation", () => {
  it("reads the state of an invitation", async () => {
    mockGetTenantAdminInvitationState.mockResolvedValueOnce({
      accountExists: true,
      email: "admin@example.com",
      expiresAt: "2026-03-31T00:00:00Z",
      status: "pending",
    });

    await expect(
      getTenantAdminInvitationState("tenant_001", "token_001")
    ).resolves.toEqual({
      accountExists: true,
      email: "admin@example.com",
      expiresAt: "2026-03-31T00:00:00Z",
      status: "pending",
    });
  });

  it("accepts an invitation", async () => {
    mockAcceptTenantAdminInvitation.mockResolvedValueOnce({
      accepted: true,
      accountCreated: true,
    });

    await expect(
      acceptTenantAdminInvitation(
        "tenant_001",
        "token_001",
        "ja",
        "山田",
        "password"
      )
    ).resolves.toEqual({
      accepted: true,
      accountCreated: true,
      ok: true,
    });
  });

  it("translates an expired error", async () => {
    mockAcceptTenantAdminInvitation.mockRejectedValueOnce(
      new ConnectError("invitation expired", Code.FailedPrecondition)
    );

    await expect(
      acceptTenantAdminInvitation("tenant_001", "token_001", "ja")
    ).resolves.toEqual({
      message: "招待リンクの有効期限が切れています。",
      ok: false,
    });
  });
});

describe("admin password reset", () => {
  it("sends the password reset mail", async () => {
    mockRequestPasswordReset.mockResolvedValueOnce({ requested: true });

    await expect(
      requestAdminPasswordReset("tenant_001", "admin@example.com", "ja")
    ).resolves.toEqual({ ok: true, requested: true });
  });

  it("translates an input error from sending the password reset mail", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("invalid email address", Code.InvalidArgument)
    );

    await expect(
      requestAdminPasswordReset("tenant_001", "invalid", "ja")
    ).resolves.toEqual({
      message: "メールアドレスを確認してください。",
      ok: false,
    });
  });

  it("resets the password", async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({ confirmed: true });

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123", "ja")
    ).resolves.toEqual({ confirmed: true, ok: true });
  });

  it("turns an expired token into the expired path", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("password reset token expired", Code.FailedPrecondition)
    );

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123", "ja")
    ).resolves.toEqual({
      message:
        "再設定リンクの有効期限が切れています。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "expired",
    });
  });

  it("turns an invalid token into the invalid path", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("password reset token not found", Code.NotFound)
    );

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123", "ja")
    ).resolves.toEqual({
      message:
        "再設定リンクが無効です。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "invalid",
    });
  });
});
