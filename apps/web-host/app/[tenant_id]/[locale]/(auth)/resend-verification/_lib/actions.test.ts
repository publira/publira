import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRedirect,
  mockRequestPublicEmailVerification,
  mockSetEmailFlashCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn(),
  mockRequestPublicEmailVerification: vi.fn(),
  mockSetEmailFlashCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  requestPublicEmailVerification: mockRequestPublicEmailVerification,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/email-flash-cookie", () => ({
  RESEND_VERIFICATION_REQUESTED_EMAIL_COOKIE:
    "publira_web_host_resend_verification_email",
  setEmailFlashCookie: mockSetEmailFlashCookie,
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
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

describe("requestEmailVerificationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("stores the destination email in a flash cookie and redirects without a query", async () => {
    mockRequestPublicEmailVerification.mockResolvedValueOnce(true);

    const { requestEmailVerificationAction } = await import("./actions");
    await requestEmailVerificationAction(
      { message: "", ok: false },
      formData({ email, locale: "en", tenantId })
    );

    expect(mockRequestPublicEmailVerification).toHaveBeenCalledWith(
      email,
      tenantId
    );
    expect(mockSetEmailFlashCookie).toHaveBeenCalledWith(
      "publira_web_host_resend_verification_email",
      email
    );
    expect(mockRedirect).toHaveBeenCalledWith("/resend-verification/requested");
  });

  it("does not set a flash cookie when the request fails", async () => {
    mockRequestPublicEmailVerification.mockResolvedValueOnce(false);

    const { requestEmailVerificationAction } = await import("./actions");
    const result = await requestEmailVerificationAction(
      { message: "", ok: false },
      formData({ email, locale: "en", tenantId })
    );

    expect(result).toEqual({
      message:
        "Could not send the confirmation email. Please check what you entered.",
      ok: false,
    });
    expect(mockSetEmailFlashCookie).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
