import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRedirect,
  mockRequestPublicPasswordReset,
  mockSetEmailFlashCookie,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
  mockRequestPublicPasswordReset: vi.fn(),
  mockSetEmailFlashCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  requestPublicPasswordReset: mockRequestPublicPasswordReset,
}));

vi.mock("#lib/email-flash-cookie", () => ({
  RESET_PASSWORD_REQUESTED_EMAIL_COOKIE:
    "publira_web_host_reset_password_email",
  setEmailFlashCookie: mockSetEmailFlashCookie,
}));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const email = "user@example.com";

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("stores the destination email in a flash cookie and redirects without a query", async () => {
    mockRequestPublicPasswordReset.mockResolvedValueOnce(true);

    const { requestPasswordResetAction } = await import("./actions");
    await requestPasswordResetAction(
      { message: "", ok: false },
      formData({ email, tenantId })
    );

    expect(mockRequestPublicPasswordReset).toHaveBeenCalledWith(
      email,
      tenantId
    );
    expect(mockSetEmailFlashCookie).toHaveBeenCalledWith(
      "publira_web_host_reset_password_email",
      email
    );
    expect(mockRedirect).toHaveBeenCalledWith("/ja/reset-password/requested");
  });

  it("does not set a flash cookie when the request fails", async () => {
    mockRequestPublicPasswordReset.mockResolvedValueOnce(false);

    const { requestPasswordResetAction } = await import("./actions");
    const result = await requestPasswordResetAction(
      { message: "", ok: false },
      formData({ email, tenantId })
    );

    expect(result).toEqual({
      message: "再設定メールの送信に失敗しました。入力内容をご確認ください。",
      ok: false,
    });
    expect(mockSetEmailFlashCookie).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
