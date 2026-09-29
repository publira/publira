import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCookie, mockSetCookie } = vi.hoisted(() => ({
  mockGetCookie: vi.fn(),
  mockSetCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: mockGetCookie,
    set: mockSetCookie,
  }),
}));

const importEmailFlashCookie = () => import("./email-flash-cookie");

describe("parseEmailFlashValue", () => {
  it("keeps a well-formed email", async () => {
    const { parseEmailFlashValue } = await importEmailFlashCookie();
    expect(parseEmailFlashValue("user@example.com")).toBe("user@example.com");
  });

  it("trims surrounding whitespace", async () => {
    const { parseEmailFlashValue } = await importEmailFlashCookie();
    expect(parseEmailFlashValue("  user@example.com  ")).toBe(
      "user@example.com"
    );
  });

  it("hides a malformed email", async () => {
    const { parseEmailFlashValue } = await importEmailFlashCookie();
    expect(parseEmailFlashValue("not-an-email")).toBe("");
  });

  it("hides a missing or empty value", async () => {
    const { parseEmailFlashValue } = await importEmailFlashCookie();
    expect(parseEmailFlashValue()).toBe("");
    expect(parseEmailFlashValue("")).toBe("");
    expect(parseEmailFlashValue("   ")).toBe("");
  });
});

describe("emailFlashCookieOptions", () => {
  it("matches the cookie policy and stays short-lived", async () => {
    const { EMAIL_FLASH_COOKIE_MAX_AGE_SECONDS, emailFlashCookieOptions } =
      await importEmailFlashCookie();
    expect(emailFlashCookieOptions).toEqual({
      httpOnly: true,
      maxAge: EMAIL_FLASH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    expect(EMAIL_FLASH_COOKIE_MAX_AGE_SECONDS).toBe(60);
  });
});

describe("email flash cookie names", () => {
  it("uses app-specific names that do not collide with the session cookie", async () => {
    const {
      RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
      SIGNUP_PENDING_EMAIL_COOKIE,
    } = await importEmailFlashCookie();
    expect(RESET_PASSWORD_REQUESTED_EMAIL_COOKIE).toBe(
      "publira_web_host_reset_password_email"
    );
    expect(SIGNUP_PENDING_EMAIL_COOKIE).toBe(
      "publira_web_host_signup_pending_email"
    );
  });
});

describe("setEmailFlashCookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the email with the flash cookie options", async () => {
    const {
      emailFlashCookieOptions,
      RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
      setEmailFlashCookie,
    } = await importEmailFlashCookie();

    await setEmailFlashCookie(
      RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
      "user@example.com"
    );

    expect(mockSetCookie).toHaveBeenCalledWith({
      ...emailFlashCookieOptions,
      name: RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
      value: "user@example.com",
    });
  });
});

describe("readEmailFlashCookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a well-formed cookie value", async () => {
    mockGetCookie.mockReturnValueOnce({ value: "user@example.com" });

    const { readEmailFlashCookie, SIGNUP_PENDING_EMAIL_COOKIE } =
      await importEmailFlashCookie();

    await expect(
      readEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE)
    ).resolves.toBe("user@example.com");
    expect(mockGetCookie).toHaveBeenCalledWith(SIGNUP_PENDING_EMAIL_COOKIE);
  });

  it("hides a malformed or empty cookie", async () => {
    const { readEmailFlashCookie, SIGNUP_PENDING_EMAIL_COOKIE } =
      await importEmailFlashCookie();

    mockGetCookie.mockReturnValueOnce({ value: "not-an-email" });
    await expect(
      readEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE)
    ).resolves.toBe("");

    mockGetCookie.mockReturnValueOnce({ value: "" });
    await expect(
      readEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE)
    ).resolves.toBe("");
  });
});
