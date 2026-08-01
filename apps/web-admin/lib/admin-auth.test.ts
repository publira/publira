import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptTenantAdminInvitation,
  confirmAdminPasswordReset,
  getAdminCurrentUser,
  getTenantAdminInvitationState,
  isAdminSessionValid,
  isTenantAdminRole,
  requestAdminPasswordReset,
} from "./admin-auth";

const {
  mockAcceptTenantAdminInvitation,
  mockConfirmPasswordReset,
  mockGetMe,
  mockGetAccessToken,
  mockGetTenantAdminInvitationState,
  mockRequestPasswordReset,
} = vi.hoisted(() => ({
  mockAcceptTenantAdminInvitation: vi.fn(),
  mockConfirmPasswordReset: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetMe: vi.fn(),
  mockGetTenantAdminInvitationState: vi.fn(),
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
      requestPasswordReset: mockRequestPasswordReset,
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("valid-token");
});

describe("getAdminCurrentUser", () => {
  it("空の accessToken に対して null を返す", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("空白のみの accessToken に対して null を返す", async () => {
    // getAccessToken は常にトリム済みの値を返すため、空白のみのケースは空文字と同等
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("API が user を返さない場合に null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({});
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("API が publicId 空の user を返した場合に null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("有効なレスポンスからユーザー情報を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "山田太郎", publicId: "user-001", role: "admin" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({
      name: "山田太郎",
      publicId: "user-001",
      role: "admin",
    });
  });

  it("getAccessToken が返した access token をそのまま API に渡す", async () => {
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

  it("想定内エラーは null を返す", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("permission_denied"));
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toBeNull();
  });

  it("想定外エラーは再throwする", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Network error"));
    await expect(getAdminCurrentUser("tenant_001")).rejects.toThrow(
      "Network error"
    );
  });

  it("name と role が空文字の場合も publicId があれば返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "  ", publicId: "user-002", role: "" },
    });
    const result = await getAdminCurrentUser("tenant_001");
    expect(result).toEqual({ name: "", publicId: "user-002", role: "" });
  });
});

describe("isAdminSessionValid", () => {
  it("空の accessToken に対して false を返す", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });

  it("有効なユーザーが取得できる場合 true を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "テスト", publicId: "user-001", role: "admin" },
    });
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(true);
  });

  it("想定内エラーは false を返す", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("permission_denied"));
    const result = await isAdminSessionValid("tenant_001");
    expect(result).toBe(false);
  });

  it("想定外エラーは再throwする", async () => {
    mockGetMe.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(isAdminSessionValid("tenant_001")).rejects.toThrow(
      "Unauthorized"
    );
  });
});

describe("isTenantAdminRole", () => {
  it("tenant_admin を許可する", () => {
    expect(isTenantAdminRole("tenant_admin")).toBe(true);
  });

  it("admin も許可する", () => {
    expect(isTenantAdminRole("admin")).toBe(true);
  });

  it("editor を拒否する", () => {
    expect(isTenantAdminRole("editor")).toBe(false);
  });

  it("大文字混在と空白を正規化して判定する", () => {
    expect(isTenantAdminRole("  TENANT_ADMIN ")).toBe(true);
  });
});

describe("tenant admin invitation", () => {
  it("招待状態を取得できる", async () => {
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

  it("招待承諾が成功する", async () => {
    mockAcceptTenantAdminInvitation.mockResolvedValueOnce({
      accepted: true,
      accountCreated: true,
    });

    await expect(
      acceptTenantAdminInvitation("tenant_001", "token_001", "山田", "password")
    ).resolves.toEqual({
      accepted: true,
      accountCreated: true,
      ok: true,
    });
  });

  it("期限切れエラーを変換する", async () => {
    mockAcceptTenantAdminInvitation.mockRejectedValueOnce(
      new Error("failed_precondition: invitation expired")
    );

    await expect(
      acceptTenantAdminInvitation("tenant_001", "token_001")
    ).resolves.toEqual({
      message: "招待リンクの有効期限が切れています。",
      ok: false,
    });
  });
});

describe("admin password reset", () => {
  it("再設定メール送信が成功する", async () => {
    mockRequestPasswordReset.mockResolvedValueOnce({ requested: true });

    await expect(
      requestAdminPasswordReset("tenant_001", "admin@example.com")
    ).resolves.toEqual({ ok: true, requested: true });
  });

  it("再設定メール送信の入力エラーを変換する", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new Error("invalid_argument: invalid email address")
    );

    await expect(
      requestAdminPasswordReset("tenant_001", "invalid")
    ).resolves.toEqual({
      message: "メールアドレスを確認してください。",
      ok: false,
    });
  });

  it("パスワード再設定が成功する", async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({ confirmed: true });

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123")
    ).resolves.toEqual({ confirmed: true, ok: true });
  });

  it("期限切れトークンを期限切れ導線に変換する", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new Error("failed_precondition: password reset token expired")
    );

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123")
    ).resolves.toEqual({
      message:
        "再設定リンクの有効期限が切れています。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "expired",
    });
  });

  it("不正トークンを無効導線に変換する", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new Error("not_found: password reset token not found")
    );

    await expect(
      confirmAdminPasswordReset("tenant_001", "token_001", "password123")
    ).resolves.toEqual({
      message:
        "再設定リンクが無効です。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "invalid",
    });
  });
});
