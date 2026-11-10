import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMessagesFor } from "#lib/messages";

const {
  mockAssertSameOrigin,
  mockClearMfaChallenge,
  mockReadMfaChallenge,
  mockRedirect,
  mockVerifyMfaPublic,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockClearMfaChallenge: vi.fn(),
  mockReadMfaChallenge: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockVerifyMfaPublic: vi.fn(),
  mockWritePublicSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth", () => ({ verifyMfaPublic: mockVerifyMfaPublic }));

vi.mock("#lib/auth-session", () => ({
  writePublicSessionCookie: mockWritePublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/mfa-challenge", () => ({
  clearMfaChallenge: mockClearMfaChallenge,
  readMfaChallenge: mockReadMfaChallenge,
}));

vi.mock("#lib/tenant", () => ({ getTenantDefaultLocale: () => "en" }));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CHALLENGE = {
  challengeToken: "chl",
  expiresAt: "2030-01-01T00:05:00Z",
  locale: "en",
  returnTo: "/my/library",
  tenantId,
};

/** The Action hands the session to the cookie writer without reading it. */
const SESSION = { accessToken: "tok" };

const codeFormData = (code = "123456", method = "authenticator"): FormData => {
  const data = new FormData();
  data.set("code", code);
  data.set("locale", "en");
  data.set("method", method);
  data.set("tenantId", tenantId);

  return data;
};

const verify = async (formData = codeFormData()) => {
  const { verifyMfaAction } = await import("./actions");

  return verifyMfaAction(null, formData);
};

/** Where the Action sent the reader, as a URL. */
const redirectedTo = async (formData = codeFormData()): Promise<URL> => {
  try {
    await verify(formData);
  } catch (error) {
    const path = error instanceof Error ? error.message : "";

    return new URL(
      path.replace("NEXT_REDIRECT:", ""),
      "https://reader.example"
    );
  }

  throw new Error("the Action did not redirect");
};

describe("verifyMfaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockReadMfaChallenge.mockResolvedValue(CHALLENGE);
  });

  it("writes the session the code bought and goes on to where the reader was heading", async () => {
    mockVerifyMfaPublic.mockResolvedValueOnce({
      kind: "signed_in",
      recoveryCodeUsed: false,
      remainingRecoveryCodes: 10,
      session: SESSION,
    });

    const destination = await redirectedTo();

    expect(destination.pathname).toBe("/my/library");
    expect(mockVerifyMfaPublic).toHaveBeenCalledWith(tenantId, "chl", "123456");
    expect(mockWritePublicSessionCookie).toHaveBeenCalledWith(
      SESSION,
      tenantId
    );
    expect(mockClearMfaChallenge).toHaveBeenCalled();
  });

  it.each([
    [
      "authenticator",
      "invalid_code",
      "storefront.auth.two_step.errors.invalid_code",
    ],
    [
      "recovery",
      "invalid_code",
      "storefront.auth.two_step.errors.invalid_recovery_code",
    ],
    ["authenticator", "locked", "storefront.auth.two_step.errors.locked"],
    ["recovery", "rate_limited", "errors.rpc.rate-limited"],
  ] as const)(
    "stays on the %s form with what it says about a refused code (%s)",
    async (method, refusal, key) => {
      mockVerifyMfaPublic.mockResolvedValueOnce({ kind: "refused", refusal });
      const t = await getMessagesFor("en");

      await expect(verify(codeFormData("000000", method))).resolves.toEqual({
        message: t(key),
        ok: false,
      });
      expect(mockWritePublicSessionCookie).not.toHaveBeenCalled();
      expect(mockClearMfaChallenge).not.toHaveBeenCalled();
    }
  );

  it("sends the reader to sign in again once the challenge is over", async () => {
    mockVerifyMfaPublic.mockResolvedValueOnce({ kind: "expired" });
    const t = await getMessagesFor("en");

    const destination = await redirectedTo();

    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("error")).toBe(
      t("storefront.auth.two_step.expired")
    );
    expect(destination.searchParams.get("returnTo")).toBe("/my/library");
    expect(mockClearMfaChallenge).toHaveBeenCalled();
  });

  it("sends the reader to sign in again without a challenge to settle", async () => {
    mockReadMfaChallenge.mockResolvedValueOnce(null);

    const destination = await redirectedTo();

    expect(destination.pathname).toBe("/login");
    expect(mockVerifyMfaPublic).not.toHaveBeenCalled();
  });

  it("asks for the code when none was typed", async () => {
    const t = await getMessagesFor("en");

    await expect(verify(codeFormData("  "))).resolves.toEqual({
      message: t("storefront.auth.two_step.code_required"),
      ok: false,
    });
    expect(mockVerifyMfaPublic).not.toHaveBeenCalled();
  });
});
