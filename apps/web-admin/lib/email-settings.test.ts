import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTenantEmailSettings,
  sendTenantSmtpTestEmail,
  tenantEmailSettingsCacheTag,
} from "./email-settings";
import {
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "./email-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantEmailSettings,
  mockSendTenantSmtpTestEmail,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantEmailSettings: vi.fn(),
  mockSendTenantSmtpTestEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api", () => ({
  apiClient: {
    emailSettings: {
      getTenantEmailSettings: mockGetTenantEmailSettings,
      sendTenantSmtpTestEmail: mockSendTenantSmtpTestEmail,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("./session", () => ({ getAccessToken: mockGetAccessToken }));

const smtpTestInput = {
  encryption: "starttls",
  fromAddress: "noreply@example.com",
  fromName: "",
  host: "smtp.example.com",
  password: "",
  passwordUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
  port: 587,
  recipientEmail: "",
  recipientType: TEST_EMAIL_RECIPIENT_TYPE_SELF,
  replyTo: "",
  smtpOverrideEnabled: true,
  tenantId: "TENANT001",
  username: "mailer",
};

const smtpAuthenticationError = () =>
  new ConnectError(
    "smtp connection test failed",
    Code.FailedPrecondition,
    undefined,
    [
      {
        desc: ErrorInfoSchema,
        value: {
          domain: "publira",
          reason: "SMTP_TEST_AUTHENTICATION",
        },
      },
    ]
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("sess_abc");
});

describe("sendTenantSmtpTestEmail", () => {
  it("renders SMTP test reasons in English and Japanese", async () => {
    mockSendTenantSmtpTestEmail.mockRejectedValueOnce(
      smtpAuthenticationError()
    );
    await expect(sendTenantSmtpTestEmail(smtpTestInput, "en")).resolves.toEqual(
      {
        message:
          "SMTP authentication failed. Check the SMTP settings and try again.",
        ok: false,
      }
    );

    mockSendTenantSmtpTestEmail.mockRejectedValueOnce(
      smtpAuthenticationError()
    );
    await expect(sendTenantSmtpTestEmail(smtpTestInput, "ja")).resolves.toEqual(
      {
        message:
          "SMTP認証に失敗しました。SMTPの設定を確認して再試行してください。",
        ok: false,
      }
    );
  });
});

describe("getTenantEmailSettings", () => {
  it("files the settings under the tenant email settings tag", async () => {
    mockGetTenantEmailSettings.mockResolvedValueOnce({
      settings: {
        encryption: "starttls",
        fromAddress: "noreply@example.com",
        fromName: "Publira",
        hasPassword: true,
        host: "smtp.example.com",
        port: 587,
        replyTo: "",
        smtpOverrideEnabled: true,
        username: "mailer",
      },
    });

    const result = await getTenantEmailSettings("TENANT001", "en");

    expect(result.ok).toBe(true);
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a sign-in and drops the cache entry without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const result = await getTenantEmailSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantEmailSettings).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("fails and drops the cache entry when the fetch fails", async () => {
    mockGetTenantEmailSettings.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const result = await getTenantEmailSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("tenantEmailSettingsCacheTag normalizes the tenant id", () => {
    expect(tenantEmailSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:email-settings"
    );
  });
});
