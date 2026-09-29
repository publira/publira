import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockConfirmPasswordReset, mockRedirect } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockConfirmPasswordReset: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
  }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/password-reset", () => ({
  confirmPlatformPasswordReset: mockConfirmPasswordReset,
}));

const TOKEN = "a".repeat(64);

const confirmFormData = (password: string, confirmPassword = password) => {
  const formData = new FormData();
  formData.set("token", TOKEN);
  formData.set("password", password);
  formData.set("confirm_password", confirmPassword);
  return formData;
};

describe("confirmPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the new password with the spaces the operator typed around it", async () => {
    mockConfirmPasswordReset.mockResolvedValueOnce({
      confirmed: true,
      ok: true,
    });

    const { confirmPasswordAction } = await import("./actions");

    await expect(
      confirmPasswordAction(confirmFormData("  correct horse  "))
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=done");
    expect(mockConfirmPasswordReset).toHaveBeenCalledWith(
      TOKEN,
      "  correct horse  ",
      "en"
    );
  });

  it("tells apart a confirmation that differs only in its spaces", async () => {
    const { confirmPasswordAction } = await import("./actions");

    await expect(
      confirmPasswordAction(confirmFormData("correct horse ", "correct horse"))
    ).rejects.toThrow("NEXT_REDIRECT:/confirm-password?error=");
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });
});
