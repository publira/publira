import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockClearPublicSessionCookie,
  mockConfirmPublicPasswordReset,
  mockRedirect,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockClearPublicSessionCookie: vi.fn(),
  mockConfirmPublicPasswordReset: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  confirmPublicPasswordReset: mockConfirmPublicPasswordReset,
}));

vi.mock("#lib/auth-session", () => ({
  clearPublicSessionCookie: mockClearPublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant-locale-path", () => ({
  tenantLocalePath: (_tenantId: string, locale: string, href: string) =>
    Promise.resolve(`/${locale}${href}`),
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const password = "new-password";

const confirmForm = (): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    confirmPassword: password,
    locale: "en",
    newPassword: password,
    tenantId,
    token: "a".repeat(64),
  })) {
    data.set(name, value);
  }
  return data;
};

describe("confirmPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs this browser out before sending it to sign in with the new password", async () => {
    mockConfirmPublicPasswordReset.mockResolvedValueOnce(true);
    const { confirmPasswordAction } = await import("./actions");

    await expect(confirmPasswordAction(confirmForm())).rejects.toThrow(
      "NEXT_REDIRECT:/en/login?reset=done"
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockClearPublicSessionCookie).toHaveBeenCalledOnce();
  });

  it("keeps the session of a reset the API refused", async () => {
    mockConfirmPublicPasswordReset.mockResolvedValueOnce(false);
    const { confirmPasswordAction } = await import("./actions");

    await expect(confirmPasswordAction(confirmForm())).rejects.toThrow(
      /NEXT_REDIRECT:\/en\/confirm-password\?/u
    );

    expect(mockClearPublicSessionCookie).not.toHaveBeenCalled();
  });
});
