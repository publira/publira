import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockRedirect,
  mockSetEmailFlashCookie,
  mockSignupPublic,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockRedirect: vi.fn(),
  mockSetEmailFlashCookie: vi.fn(),
  mockSignupPublic: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  signupPublic: mockSignupPublic,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/email-flash-cookie", () => ({
  SIGNUP_PENDING_EMAIL_COOKIE: "publira_web_host_signup_pending_email",
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
const password = "secret-password";

const validSignupFields = {
  confirmPassword: password,
  email,
  locale: "en",
  name: "Example User",
  password,
  tenantId,
};

describe("signupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("stores the destination email in a flash cookie and redirects without a query", async () => {
    mockSignupPublic.mockResolvedValueOnce({ pendingVerification: true });

    const { signupAction } = await import("./actions");
    await signupAction({ message: "", ok: false }, formData(validSignupFields));

    expect(mockSignupPublic).toHaveBeenCalledWith(
      "Example User",
      email,
      password,
      tenantId
    );
    expect(mockSetEmailFlashCookie).toHaveBeenCalledWith(
      "publira_web_host_signup_pending_email",
      email
    );
    expect(mockRedirect).toHaveBeenCalledWith("/signup/pending");
  });

  it("does not set a flash cookie when signup succeeds without pending verification", async () => {
    mockSignupPublic.mockResolvedValueOnce({
      accessToken: "tok",
      pendingVerification: false,
    });

    const { signupAction } = await import("./actions");
    await signupAction({ message: "", ok: false }, formData(validSignupFields));

    expect(mockSetEmailFlashCookie).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/my");
  });

  it("does not set a flash cookie when signup fails", async () => {
    mockSignupPublic.mockResolvedValueOnce(null);

    const { signupAction } = await import("./actions");
    const result = await signupAction(
      { message: "", ok: false },
      formData(validSignupFields)
    );

    expect(result).toEqual({
      message: "Could not create your account. Please check what you entered.",
      ok: false,
    });
    expect(mockSetEmailFlashCookie).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
