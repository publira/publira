import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getTenantEmailSender,
  getTenantEmailSettings,
  sendTenantSmtpTestEmail,
  tenantEmailSettingsCacheTag,
  updateTenantEmailSettings,
} from "./email-settings";
import {
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "./email-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantEmailSender,
  mockGetTenantEmailSettings,
  mockSendTenantSmtpTestEmail,
  mockUpdateTenantEmailSettings,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantEmailSender: vi.fn(),
  mockGetTenantEmailSettings: vi.fn(),
  mockSendTenantSmtpTestEmail: vi.fn(),
  mockUpdateTenantEmailSettings: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api", () => ({
  apiClient: {
    emailSettings: {
      getTenantEmailSender: mockGetTenantEmailSender,
      getTenantEmailSettings: mockGetTenantEmailSettings,
      sendTenantSmtpTestEmail: mockSendTenantSmtpTestEmail,
      updateTenantEmailSettings: mockUpdateTenantEmailSettings,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("./session", () => ({ getAccessToken: mockGetAccessToken }));

const smtpSettingsInput = {
  encryption: "starttls",
  fromAddress: "noreply@example.com",
  fromName: "",
  host: "smtp.example.com",
  password: "",
  passwordUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
  port: 587,
  replyTo: "",
  smtpOverrideEnabled: true,
  tenantId: "TENANT001",
  username: "mailer",
};

const smtpTestInput = {
  ...smtpSettingsInput,
  recipientEmail: "",
  recipientType: TEST_EMAIL_RECIPIENT_TYPE_SELF,
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

const passwordWithoutUsernameError = () =>
  new ConnectError(
    "username is required with a password",
    Code.InvalidArgument,
    undefined,
    [
      {
        desc: BadRequestSchema,
        value: { fieldViolations: [{ field: "username" }] },
      },
    ]
  );

const passwordWithoutUsernameMessage =
  "A password needs a username. Enter the username, or remove the password to send without authenticating.";

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

  it("says a password needs a username when the test is refused for want of one", async () => {
    mockSendTenantSmtpTestEmail.mockRejectedValueOnce(
      passwordWithoutUsernameError()
    );

    await expect(
      sendTenantSmtpTestEmail({ ...smtpTestInput, username: "" }, "en")
    ).resolves.toEqual({ message: passwordWithoutUsernameMessage, ok: false });
  });
});

describe("updateTenantEmailSettings", () => {
  it("puts a password refused for want of a username on the username field", async () => {
    mockUpdateTenantEmailSettings.mockRejectedValueOnce(
      passwordWithoutUsernameError()
    );

    await expect(
      updateTenantEmailSettings({ ...smtpSettingsInput, username: "" }, "en")
    ).resolves.toEqual({
      fieldErrors: { username: passwordWithoutUsernameMessage },
      message: "Please check the information you entered.",
      ok: false,
    });
  });

  it("passes the server's validation detail through", async () => {
    mockUpdateTenantEmailSettings.mockRejectedValueOnce(
      new ConnectError("from_address is required", Code.InvalidArgument)
    );

    await expect(
      updateTenantEmailSettings(smtpSettingsInput, "en")
    ).resolves.toEqual({
      message: "from_address is required",
      ok: false,
    });
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

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantEmailSettings.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getTenantEmailSettings("TENANT001", "en")).rejects.toThrow(
      Error
    );
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

describe("getTenantEmailSender", () => {
  it("answers the sender in force under the email settings tag, so a save there reaches it", async () => {
    mockGetTenantEmailSender.mockResolvedValueOnce({
      fromAddress: "noreply@mail.example.com",
    });

    const result = await getTenantEmailSender(" TENANT001 ", "en");

    expect(result).toEqual({
      fromAddress: "noreply@mail.example.com",
      ok: true,
    });
    expect(mockGetTenantEmailSender).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("answers an empty sender where the settings in force name none", async () => {
    mockGetTenantEmailSender.mockResolvedValueOnce({ fromAddress: "" });

    await expect(getTenantEmailSender("TENANT001", "en")).resolves.toEqual({
      fromAddress: "",
      ok: true,
    });
  });

  it("asks for a sign-in and drops the cache entry without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const result = await getTenantEmailSender("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantEmailSender).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("says the sender could not be read and drops the cache entry when the fetch fails", async () => {
    mockGetTenantEmailSender.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const result = await getTenantEmailSender("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantEmailSender.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getTenantEmailSender("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a sign-in when the API rejects the session", async () => {
    mockGetTenantEmailSender.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      getTenantEmailSender("TENANT001", "en")
    ).resolves.toMatchObject({ ok: false, requiresSignIn: true });
  });
});
