import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateTag, mockUpdateTenantTimezone } = vi.hoisted(() => ({
  mockUpdateTag: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/admin-auth", () => ({
  requestAdminEmailChange: vi.fn(),
}));

vi.mock("#lib/email-settings", () => ({
  sendTenantSmtpTestEmail: vi.fn(),
  updateTenantEmailSettings: vi.fn(),
}));

vi.mock("#lib/session", () => ({
  getAccessToken: vi.fn(),
}));

vi.mock("#lib/site-settings", () => ({
  updateTenantSiteSettings: vi.fn(),
}));

vi.mock("#lib/tenant-timezone", () => ({
  tenantTimezoneCacheTag: (tenantId: string) => `tenant:${tenantId}:timezone`,
  updateTenantTimezone: mockUpdateTenantTimezone,
}));

vi.mock("#lib/theme-settings", () => ({
  updateTenantThemeSettings: vi.fn(),
}));

const timezoneFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

describe("updateTenantTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("有効な IANA 名を保存し、キャッシュタグを更新する", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      ok: true,
      timezone: "America/Los_Angeles",
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      timezoneFormData({
        tenant_id: "TENANT001",
        timezone: "America/Los_Angeles",
      })
    );

    expect(result).toEqual({
      message: "タイムゾーンを保存しました。",
      ok: true,
      timezone: "America/Los_Angeles",
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith({
      tenantId: "TENANT001",
      timezone: "America/Los_Angeles",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:timezone");
  });

  it("不正なタイムゾーンは API を呼ばずに拒否する", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      timezoneFormData({ tenant_id: "TENANT001", timezone: "Asia/Nowhere" })
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("未選択のまま送信した場合は選択を促す", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      timezoneFormData({ tenant_id: "TENANT001", timezone: "  " })
    );

    expect(result).toEqual({
      message: "タイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("テナント ID がない場合は保存しない", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      timezoneFormData({ timezone: "Asia/Tokyo" })
    );

    expect(result).toEqual({
      message: "テナント ID が見つかりません。",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("保存に失敗した場合はメッセージを返し、キャッシュタグを更新しない", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      message: "権限がありません。",
      ok: false,
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      timezoneFormData({ tenant_id: "TENANT001", timezone: "Asia/Tokyo" })
    );

    expect(result).toEqual({ message: "権限がありません。", ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
