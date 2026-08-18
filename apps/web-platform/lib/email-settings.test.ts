import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SECRET_UPDATE_MODE_REPLACE,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
  getPlatformEmailSettings,
  sendPlatformSmtpTestEmail,
  updatePlatformEmailSettings,
} from "./email-settings";

const {
  mockGetPlatformEmailSettings,
  mockResolveSessionId,
  mockSendPlatformSmtpTestEmail,
  mockUpdatePlatformEmailSettings,
} = vi.hoisted(() => ({
  mockGetPlatformEmailSettings: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockSendPlatformSmtpTestEmail: vi.fn(),
  mockUpdatePlatformEmailSettings: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    emailSettings: {
      getPlatformEmailSettings: mockGetPlatformEmailSettings,
      sendPlatformSmtpTestEmail: mockSendPlatformSmtpTestEmail,
      updatePlatformEmailSettings: mockUpdatePlatformEmailSettings,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
});

describe("getPlatformEmailSettings", () => {
  it("正常系: SMTP 設定を整形して返す", async () => {
    mockGetPlatformEmailSettings.mockResolvedValueOnce({
      settings: {
        encryption: "starttls",
        fromAddress: "noreply@example.com",
        hasPassword: true,
        host: "smtp.example.com",
        port: 587,
        replyTo: "support@example.com",
        username: "mailer",
      },
    });

    await expect(getPlatformEmailSettings()).resolves.toEqual({
      ok: true,
      settings: {
        encryption: "starttls",
        fromAddress: "noreply@example.com",
        hasPassword: true,
        host: "smtp.example.com",
        port: 587,
        replyTo: "support@example.com",
        username: "mailer",
      },
    });
  });

  it("sessionId が空のとき API を呼ばず失敗を返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPlatformEmailSettings()).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });

    expect(mockGetPlatformEmailSettings).not.toHaveBeenCalled();
  });
});

describe("updatePlatformEmailSettings", () => {
  it("正常系: 保存 API を呼び出して更新後設定を返す", async () => {
    mockUpdatePlatformEmailSettings.mockResolvedValueOnce({
      settings: {
        encryption: "tls",
        fromAddress: "noreply@example.com",
        hasPassword: true,
        host: "smtp.example.com",
        port: 465,
        replyTo: "",
        username: "mailer",
      },
    });

    const result = await updatePlatformEmailSettings({
      encryption: "tls",
      fromAddress: "noreply@example.com",
      host: "smtp.example.com",
      password: "secret",
      passwordUpdateMode: SECRET_UPDATE_MODE_REPLACE,
      port: 465,
      replyTo: "",
      username: "mailer",
    });

    expect(result).toEqual({
      ok: true,
      settings: {
        encryption: "tls",
        fromAddress: "noreply@example.com",
        hasPassword: true,
        host: "smtp.example.com",
        port: 465,
        replyTo: "",
        username: "mailer",
      },
    });

    expect(mockUpdatePlatformEmailSettings).toHaveBeenCalledWith(
      {
        encryption: "tls",
        fromAddress: "noreply@example.com",
        host: "smtp.example.com",
        password: "secret",
        passwordUpdateMode: SECRET_UPDATE_MODE_REPLACE,
        port: 465,
        replyTo: "",
        username: "mailer",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });
});

describe("sendPlatformSmtpTestEmail", () => {
  it("正常系: 接続テスト API の送信先を返す", async () => {
    mockSendPlatformSmtpTestEmail.mockResolvedValueOnce({
      recipientEmail: "operator@example.com",
    });

    await expect(
      sendPlatformSmtpTestEmail({
        encryption: "starttls",
        fromAddress: "noreply@example.com",
        host: "smtp.example.com",
        password: "",
        passwordUpdateMode: 1,
        port: 587,
        recipientEmail: "",
        recipientType: TEST_EMAIL_RECIPIENT_TYPE_SELF,
        replyTo: "",
        username: "mailer",
      })
    ).resolves.toEqual({ ok: true, recipientEmail: "operator@example.com" });
  });
});
