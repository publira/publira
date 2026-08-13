import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdatePlatformDefaultTimezone, mockUpdateTag } = vi.hoisted(() => ({
  mockUpdatePlatformDefaultTimezone: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/email-change", () => ({
  requestPlatformEmailChange: vi.fn(),
}));

vi.mock("#lib/email-settings", () => ({
  sendPlatformSmtpTestEmail: vi.fn(),
  updatePlatformEmailSettings: vi.fn(),
}));

vi.mock("#lib/platform-settings", () => ({
  platformSettingsCacheTag: "platform:settings",
  updatePlatformDefaultTimezone: mockUpdatePlatformDefaultTimezone,
}));

const timezoneFormData = (defaultTimezone: string): FormData => {
  const formData = new FormData();
  formData.set("default_timezone", defaultTimezone);
  return formData;
};

describe("updatePlatformDefaultTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("有効な IANA 名を保存し、キャッシュタグを更新する", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      defaultTimezone: "America/Los_Angeles",
      ok: true,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("America/Los_Angeles")
    );

    expect(result).toEqual({
      defaultTimezone: "America/Los_Angeles",
      message: "既定タイムゾーンを保存しました。",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "America/Los_Angeles"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:settings");
  });

  it("列挙されないエイリアスもサーバと同じく保存できる", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      defaultTimezone: "Asia/Calcutta",
      ok: true,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Asia/Calcutta")
    );

    expect(result).toEqual({
      defaultTimezone: "Asia/Calcutta",
      message: "既定タイムゾーンを保存しました。",
      ok: true,
    });
    expect(mockUpdatePlatformDefaultTimezone).toHaveBeenCalledWith(
      "Asia/Calcutta"
    );
  });

  it("不正なタイムゾーンは往復せずに拒否する", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Asia/Nowhere")
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("オフセット表記はサーバが受け付けないため拒否する", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("+09:00")
    );

    expect(result).toEqual({
      message: "有効なタイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("未選択の場合は選択を促す", async () => {
    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("")
    );

    expect(result).toEqual({
      message: "タイムゾーンを選択してください。",
      ok: false,
    });
    expect(mockUpdatePlatformDefaultTimezone).not.toHaveBeenCalled();
  });

  it("保存に失敗した場合はキャッシュタグを更新しない", async () => {
    mockUpdatePlatformDefaultTimezone.mockResolvedValueOnce({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });

    const { updatePlatformDefaultTimezoneAction } = await import("./actions");

    const result = await updatePlatformDefaultTimezoneAction(
      null,
      timezoneFormData("Europe/Paris")
    );

    expect(result).toEqual({
      message: "default_timezone must be a valid IANA time zone name",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
