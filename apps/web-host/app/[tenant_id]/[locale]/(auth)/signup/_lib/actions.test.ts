import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockReadConsentPageVersionIds,
  mockRedirect,
  mockSetEmailFlashCookie,
  mockSignupPublic,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockReadConsentPageVersionIds: vi.fn(),
  mockRedirect: vi.fn(),
  mockSetEmailFlashCookie: vi.fn(),
  mockSignupPublic: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
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
  readConsentPageVersionIds: mockReadConsentPageVersionIds,
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
    mockReadConsentPageVersionIds.mockResolvedValue([]);
  });

  it("stores the destination email in a flash cookie and redirects without a query", async () => {
    mockSignupPublic.mockResolvedValueOnce(true);

    const { signupAction } = await import("./actions");
    await signupAction({ message: "", ok: false }, formData(validSignupFields));

    expect(mockSignupPublic).toHaveBeenCalledWith({
      agreedPageVersionIds: [],
      birthDate: "",
      email,
      name: "Example User",
      password,
      tenantId,
    });
    expect(mockSetEmailFlashCookie).toHaveBeenCalledWith(
      "publira_web_host_signup_pending_email",
      email
    );
    expect(mockRedirect).toHaveBeenCalledWith("/signup/pending");
  });

  it("sends the versions of the pages the reader agreed to", async () => {
    mockReadConsentPageVersionIds.mockResolvedValueOnce([
      "privacy-v2",
      "terms-v1",
    ]);
    mockSignupPublic.mockResolvedValueOnce(true);
    const data = formData({ ...validSignupFields, consent: "on" });
    data.append("agreedPageVersionIds", "terms-v1");
    data.append("agreedPageVersionIds", "privacy-v2");

    const { signupAction } = await import("./actions");
    await signupAction({ message: "", ok: false }, data);

    expect(mockSignupPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        agreedPageVersionIds: ["privacy-v2", "terms-v1"],
      })
    );
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/signup/pending");
  });

  it("asks for consent again when a page was republished after the form rendered", async () => {
    mockReadConsentPageVersionIds.mockResolvedValueOnce([
      "terms-v2",
      "privacy-v2",
    ]);
    const data = formData({ ...validSignupFields, consent: "on" });
    data.append("agreedPageVersionIds", "terms-v1");
    data.append("agreedPageVersionIds", "privacy-v2");

    const { signupAction } = await import("./actions");
    const result = await signupAction({ message: "", ok: false }, data);

    expect(result).toEqual({
      message:
        "The pages to agree to have been updated. Read them and agree again.",
      ok: false,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:site`);
    expect(mockSignupPublic).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("asks for consent when the tenant named a page after the form rendered", async () => {
    mockReadConsentPageVersionIds.mockResolvedValueOnce(["terms-v1"]);

    const { signupAction } = await import("./actions");
    const result = await signupAction(
      { message: "", ok: false },
      formData(validSignupFields)
    );

    expect(result).toEqual({
      message:
        "The pages to agree to have been updated. Read them and agree again.",
      ok: false,
    });
    expect(mockSignupPublic).not.toHaveBeenCalled();
  });

  it("sends no consent once the tenant names no page any more", async () => {
    mockSignupPublic.mockResolvedValueOnce(true);
    const data = formData({ ...validSignupFields, consent: "on" });
    data.append("agreedPageVersionIds", "terms-v1");

    const { signupAction } = await import("./actions");
    await signupAction({ message: "", ok: false }, data);

    expect(mockSignupPublic).toHaveBeenCalledWith(
      expect.objectContaining({ agreedPageVersionIds: [] })
    );
    expect(mockRedirect).toHaveBeenCalledWith("/signup/pending");
  });

  it("refuses a sign-up that shows pages to agree to without the consent", async () => {
    const data = formData(validSignupFields);
    data.append("agreedPageVersionIds", "terms-v1");

    const { signupAction } = await import("./actions");
    const result = await signupAction({ message: "", ok: false }, data);

    expect(result).toEqual({
      message: "Agree to the listed pages to create an account.",
      ok: false,
    });
    expect(mockSignupPublic).not.toHaveBeenCalled();
  });

  it("does not create the account when the published versions cannot be read", async () => {
    mockReadConsentPageVersionIds.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { signupAction } = await import("./actions");
    const result = await signupAction(
      { message: "", ok: false },
      formData(validSignupFields)
    );

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(mockSignupPublic).not.toHaveBeenCalled();
  });

  it("does not set a flash cookie when signup fails", async () => {
    mockSignupPublic.mockResolvedValueOnce(false);

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
