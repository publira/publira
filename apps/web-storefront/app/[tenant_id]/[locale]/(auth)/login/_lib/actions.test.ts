import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";

const {
  mockAssertSameOrigin,
  mockBeginPasskeyLoginPublic,
  mockFinishPasskeyLoginPublic,
  mockLoginPublic,
  mockRedirect,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBeginPasskeyLoginPublic: vi.fn(),
  mockFinishPasskeyLoginPublic: vi.fn(),
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
  beginPasskeyLoginPublic: mockBeginPasskeyLoginPublic,
  finishPasskeyLoginPublic: mockFinishPasskeyLoginPublic,
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
      t("storefront.auth.errors.login_failed")
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

const passkeyFormData = (credential = '{"id":"cred"}'): FormData => {
  const data = new FormData();
  data.set("credential", credential);
  data.set("locale", "en");
  data.set("returnTo", "/my");
  data.set("tenantId", tenantId);

  return data;
};

describe("beginPasskeyLoginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("answers the options the API began the sign-in with", async () => {
    mockBeginPasskeyLoginPublic.mockResolvedValueOnce({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });

    const { beginPasskeyLoginAction } = await import("./actions");

    await expect(beginPasskeyLoginAction(passkeyFormData(""))).resolves.toEqual(
      { message: "", ok: true, optionsJson: '{"challenge":"abc"}' }
    );
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockBeginPasskeyLoginPublic).toHaveBeenCalledWith(tenantId);
  });

  it("asks the reader to wait after too many attempts", async () => {
    mockBeginPasskeyLoginPublic.mockResolvedValueOnce({
      ok: false,
      refusal: "rate-limited",
    });
    const t = await getMessagesFor("en");

    const { beginPasskeyLoginAction } = await import("./actions");

    await expect(beginPasskeyLoginAction(passkeyFormData(""))).resolves.toEqual(
      { message: t("errors.rpc.rate-limited"), ok: false }
    );
  });

  it("begins nothing for a form that names no tenant", async () => {
    const data = passkeyFormData("");
    data.set("tenantId", "not-a-tenant");
    const t = await getMessagesFor("en");

    const { beginPasskeyLoginAction } = await import("./actions");

    await expect(beginPasskeyLoginAction(data)).resolves.toEqual({
      message: t("storefront.auth.errors.passkey_failed"),
      ok: false,
    });
    expect(mockBeginPasskeyLoginPublic).not.toHaveBeenCalled();
  });
});

describe("finishPasskeyLoginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("writes the session and returns the reader to where they were", async () => {
    const session = { accessToken: "tok", expiresAt: "2030-01-01" };
    mockFinishPasskeyLoginPublic.mockResolvedValueOnce({ ok: true, session });

    const { finishPasskeyLoginAction } = await import("./actions");

    await expect(finishPasskeyLoginAction(passkeyFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/my"
    );
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockFinishPasskeyLoginPublic).toHaveBeenCalledWith(
      tenantId,
      '{"id":"cred"}'
    );
    expect(mockWritePublicSessionCookie).toHaveBeenCalledWith(
      session,
      tenantId
    );
  });

  it("returns to the form with a message when the passkey is refused", async () => {
    mockFinishPasskeyLoginPublic.mockResolvedValueOnce({
      ok: false,
      refusal: "refused",
    });
    const t = await getMessagesFor("en");

    const { finishPasskeyLoginAction } = await import("./actions");

    await expect(finishPasskeyLoginAction(passkeyFormData())).resolves.toEqual({
      message: t("storefront.auth.errors.passkey_failed"),
      ok: false,
    });
    expect(mockWritePublicSessionCookie).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("finishes nothing for a submission without an assertion", async () => {
    const t = await getMessagesFor("en");

    const { finishPasskeyLoginAction } = await import("./actions");

    await expect(
      finishPasskeyLoginAction(passkeyFormData(""))
    ).resolves.toEqual({
      message: t("storefront.auth.errors.passkey_failed"),
      ok: false,
    });
    expect(mockFinishPasskeyLoginPublic).not.toHaveBeenCalled();
  });
});
