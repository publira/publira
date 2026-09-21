import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockGetAccessToken, mockUpdatePolicy } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockUpdatePolicy: vi.fn(),
  }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/royalties", () => ({
  updateRoyaltyClosePolicy: mockUpdatePolicy,
}));

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

describe("updateRoyaltyCloseSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("refuses automatic closing without a day", async () => {
    const { updateRoyaltyCloseSettingsAction } = await import("./actions");

    const result = await updateRoyaltyCloseSettingsAction(
      null,
      formData({ auto_close_day: "", close_mode: "automatic" })
    );

    expect(result).toEqual({
      fieldErrors: {
        autoCloseDay:
          "Choose the day of the following month on which to close.",
      },
      message: expect.any(String),
      ok: false,
    });
    expect(mockUpdatePolicy).not.toHaveBeenCalled();
  });

  it("refuses a day no month is sure to have", async () => {
    const { updateRoyaltyCloseSettingsAction } = await import("./actions");

    const result = await updateRoyaltyCloseSettingsAction(
      null,
      formData({ auto_close_day: "29", close_mode: "automatic" })
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdatePolicy).not.toHaveBeenCalled();
  });

  it("saves automatic closing with its day", async () => {
    const policy = {
      autoCloseDay: 5,
      automaticSince: "2026-09-21T00:00:00Z",
      closeMode: "automatic",
    };
    mockUpdatePolicy.mockResolvedValueOnce({ ok: true, policy });
    const { updateRoyaltyCloseSettingsAction } = await import("./actions");

    const result = await updateRoyaltyCloseSettingsAction(
      null,
      formData({ auto_close_day: "5", close_mode: "automatic" })
    );

    expect(result).toEqual({
      message: "The closing settings were saved.",
      ok: true,
      policy,
    });
    expect(mockUpdatePolicy).toHaveBeenCalledWith(
      { autoCloseDay: 5, closeMode: "automatic", tenantId: "TENANT001" },
      "en"
    );
  });

  it("saves manual closing without a day", async () => {
    const policy = { automaticSince: "", closeMode: "manual" };
    mockUpdatePolicy.mockResolvedValueOnce({ ok: true, policy });
    const { updateRoyaltyCloseSettingsAction } = await import("./actions");

    const result = await updateRoyaltyCloseSettingsAction(
      null,
      formData({ close_mode: "manual" })
    );

    expect(result?.ok).toBe(true);
    expect(mockUpdatePolicy).toHaveBeenCalledWith(
      { autoCloseDay: undefined, closeMode: "manual", tenantId: "TENANT001" },
      "en"
    );
  });

  it("passes the API's refusal through", async () => {
    mockUpdatePolicy.mockResolvedValueOnce({
      message: "Could not save the closing settings. Please try again later.",
      ok: false,
    });
    const { updateRoyaltyCloseSettingsAction } = await import("./actions");

    const result = await updateRoyaltyCloseSettingsAction(
      null,
      formData({ close_mode: "manual" })
    );

    expect(result).toEqual({
      message: "Could not save the closing settings. Please try again later.",
      ok: false,
    });
  });
});
