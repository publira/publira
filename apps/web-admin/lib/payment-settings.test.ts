import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantPaymentSettingsApi,
  mockUpdateTenantPaymentSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantPaymentSettingsApi: vi.fn(),
  mockUpdateTenantPaymentSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    paymentSettings: {
      getTenantPaymentSettings: mockGetTenantPaymentSettingsApi,
      updateTenantPaymentSettings: mockUpdateTenantPaymentSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const publicSettings = {
  enabled: true,
  provider: "stripe",
  ready: true,
  secretKeyConfigured: true,
  secretKeyHint: "sk_test_••••••••KLMN",
  webhookSecretConfigured: true,
  webhookSecretHint: "whsec_••••••••WXYZ",
};

const leakedSecretKey = "leak-secret-key-value";
const leakedWebhookSecret = "leak-webhook-secret-value";

describe("payment-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("取得に成功した場合は公開可能な設定だけを返す", async () => {
    mockGetTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: publicSettings,
    });

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001");

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(mockGetTenantPaymentSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:payment-settings"
    );
  });

  it("応答に平文シークレットがあっても画面用の設定へ載せない", async () => {
    mockGetTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: {
        ...publicSettings,
        secretKey: leakedSecretKey,
        webhookSecret: leakedWebhookSecret,
      },
    });

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001");

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(leakedSecretKey);
    expect(JSON.stringify(result)).not.toContain(leakedWebhookSecret);
    if (result.ok) {
      expect(result.settings.secretKeyHint).toBe("sk_test_••••••••KLMN");
      expect(result.settings).not.toHaveProperty("secretKey");
      expect(result.settings).not.toHaveProperty("webhookSecret");
    }
  });

  it("セッションがない場合はエラーを返す", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantPaymentSettingsApi).not.toHaveBeenCalled();
  });

  it("権限がない場合は共通の権限エラーメッセージを返す", async () => {
    mockGetTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001");

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
      requiresSignIn: false,
    });
  });

  it("分類できないエラーは握りつぶさない", async () => {
    mockGetTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantPaymentSettings } = await import("./payment-settings");

    await expect(getTenantPaymentSettings("TENANT001")).rejects.toThrow(
      /boom/u
    );
  });

  it("更新に成功した場合は公開ビューを返し平文を残さない", async () => {
    mockUpdateTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: publicSettings,
    });

    const { SECRET_UPDATE_MODE_REPLACE, updateTenantPaymentSettings } =
      await import("./payment-settings");

    const result = await updateTenantPaymentSettings({
      enabled: true,
      secretKey: leakedSecretKey,
      secretKeyUpdateMode: SECRET_UPDATE_MODE_REPLACE,
      tenantId: "TENANT001",
      webhookSecret: leakedWebhookSecret,
      webhookSecretUpdateMode: SECRET_UPDATE_MODE_REPLACE,
    });

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(JSON.stringify(result)).not.toContain(leakedSecretKey);
    expect(JSON.stringify(result)).not.toContain(leakedWebhookSecret);
    expect(mockUpdateTenantPaymentSettingsApi).toHaveBeenCalledWith(
      {
        enabled: true,
        provider: "stripe",
        secretKey: leakedSecretKey,
        secretKeyUpdateMode: SECRET_UPDATE_MODE_REPLACE,
        tenant: { tenantId: "TENANT001" },
        webhookSecret: leakedWebhookSecret,
        webhookSecretUpdateMode: SECRET_UPDATE_MODE_REPLACE,
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("更新時の invalid_argument はサーバのメッセージをそのまま返す", async () => {
    mockUpdateTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "secret key and webhook signing secret are required when payment is enabled",
        Code.InvalidArgument
      )
    );

    const { SECRET_UPDATE_MODE_UNCHANGED, updateTenantPaymentSettings } =
      await import("./payment-settings");

    const result = await updateTenantPaymentSettings({
      enabled: true,
      secretKey: "",
      secretKeyUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
      tenantId: "TENANT001",
      webhookSecret: "",
      webhookSecretUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
    });

    expect(result).toEqual({
      message:
        "secret key and webhook signing secret are required when payment is enabled",
      ok: false,
    });
  });

  it("権限がない更新は共通の権限エラーメッセージを返す", async () => {
    mockUpdateTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { SECRET_UPDATE_MODE_UNCHANGED, updateTenantPaymentSettings } =
      await import("./payment-settings");

    const result = await updateTenantPaymentSettings({
      enabled: false,
      secretKey: "",
      secretKeyUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
      tenantId: "TENANT001",
      webhookSecret: "",
      webhookSecretUpdateMode: SECRET_UPDATE_MODE_UNCHANGED,
    });

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
    });
  });

  it("tenantPaymentSettingsCacheTag はテナント ID を正規化する", async () => {
    const { tenantPaymentSettingsCacheTag } =
      await import("./payment-settings");

    expect(tenantPaymentSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:payment-settings"
    );
  });
});
