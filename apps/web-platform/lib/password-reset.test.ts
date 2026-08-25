import { Code, ConnectError } from "@publira/api-client/errors";
import { describe, expect, it, vi } from "vitest";

import {
  confirmPlatformPasswordReset,
  requestPlatformPasswordReset,
} from "./password-reset";

const { mockConfirmPasswordReset, mockRequestPasswordReset } = vi.hoisted(
  () => ({
    mockConfirmPasswordReset: vi.fn(),
    mockRequestPasswordReset: vi.fn(),
  })
);

vi.mock("@publira/api-client/platform/client", () => ({
  createPlatformApiClient: () => ({
    auth: {
      confirmPasswordReset: mockConfirmPasswordReset,
      requestPasswordReset: mockRequestPasswordReset,
    },
    setup: {},
  }),
}));

describe("requestPlatformPasswordReset", () => {
  it("API 成功時は requested をそのまま返す", async () => {
    mockRequestPasswordReset.mockResolvedValueOnce({ requested: true });

    await expect(
      requestPlatformPasswordReset("operator@example.com", "ja")
    ).resolves.toEqual({ ok: true, requested: true });
  });

  it("invalid_argument はメール宛の固有文言に差し替える", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      requestPlatformPasswordReset("invalid", "ja")
    ).resolves.toEqual({
      message: "メールアドレスを確認してください。",
      ok: false,
    });
  });

  it("locale=en では英語のメッセージを返す", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      requestPlatformPasswordReset("invalid", "en")
    ).resolves.toEqual({
      message: "Check the email address.",
      ok: false,
    });
  });

  it("空のメールアドレスは RPC を呼ばずにロケール付きで拒否する", async () => {
    await expect(requestPlatformPasswordReset("   ", "en")).resolves.toEqual({
      message: "Enter your email address.",
      ok: false,
    });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      requestPlatformPasswordReset("operator@example.com", "ja")
    ).rejects.toThrow("boom");
  });
});

describe("confirmPlatformPasswordReset", () => {
  const TOKEN = "a".repeat(64);

  it("failed_precondition は期限切れとして扱う", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("expired", Code.FailedPrecondition)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "ja")
    ).resolves.toEqual({
      message:
        "再設定リンクの有効期限が切れています。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "expired",
    });
  });

  it("not_found は無効なリンクとして扱う", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("unknown token", Code.NotFound)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "en")
    ).resolves.toEqual({
      message: "This reset link is invalid. Request the reset email again.",
      ok: false,
      reason: "invalid",
    });
  });

  it("空のパスワードは RPC を呼ばずに拒否する", async () => {
    await expect(
      confirmPlatformPasswordReset(TOKEN, "   ", "en")
    ).resolves.toEqual({
      message: "Enter a new password.",
      ok: false,
      reason: "system",
    });
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockConfirmPasswordReset.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      confirmPlatformPasswordReset(TOKEN, "new-password", "ja")
    ).rejects.toThrow("boom");
  });
});
