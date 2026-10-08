import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";

const {
  mockAssertSameOrigin,
  mockLoginPublic,
  mockRedirect,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockLoginPublic: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockWritePublicSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  loginPublic: mockLoginPublic,
}));

vi.mock("#lib/auth-session", () => ({
  writePublicSessionCookie: mockWritePublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const loginFormData = (): FormData => {
  const data = new FormData();
  data.set("email", "reader@example.com");
  data.set("locale", "en");
  data.set("password", "a-password");
  data.set("returnTo", "/my");
  data.set("tenantId", tenantId);
  return data;
};

/** The message the action sent the reader back to the sign-in page with. */
const redirectedError = async (): Promise<string | null> => {
  const { loginAction } = await import("./actions");
  try {
    await loginAction(loginFormData());
  } catch (error) {
    const path = error instanceof Error ? error.message : "";
    return new URL(
      path.replace("NEXT_REDIRECT:", ""),
      "https://reader.example"
    ).searchParams.get("error");
  }
  return null;
};

describe("loginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("writes the session and returns the reader to where they were", async () => {
    const session = { accessToken: "tok", expiresAt: "2030-01-01" };
    mockLoginPublic.mockResolvedValueOnce({ ok: true, session });

    const { loginAction } = await import("./actions");

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/my"
    );
    expect(mockWritePublicSessionCookie).toHaveBeenCalledWith(
      session,
      tenantId
    );
  });

  it("says the email address or password is incorrect when the credentials are refused", async () => {
    mockLoginPublic.mockResolvedValueOnce({
      ok: false,
      refusal: "credentials",
    });
    const t = await getMessagesFor("en");

    await expect(redirectedError()).resolves.toBe(
      t("host.auth.errors.login_failed")
    );
    expect(mockWritePublicSessionCookie).not.toHaveBeenCalled();
  });

  it("asks the reader to wait, not to check their password, after too many attempts", async () => {
    mockLoginPublic.mockResolvedValueOnce({
      ok: false,
      refusal: "rate-limited",
    });
    const t = await getMessagesFor("en");

    await expect(redirectedError()).resolves.toBe(t("errors.rpc.rate-limited"));
    expect(mockWritePublicSessionCookie).not.toHaveBeenCalled();
  });
});
