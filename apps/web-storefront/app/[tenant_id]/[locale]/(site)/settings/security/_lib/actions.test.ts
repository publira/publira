import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockChangePublicPassword,
  mockRedirect,
  mockRequestPublicEmailChange,
  mockRequirePublicSession,
  mockSendToProvider,
  mockUnlinkMyIdentity,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockChangePublicPassword: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRequestPublicEmailChange: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockSendToProvider: vi.fn(),
  mockUnlinkMyIdentity: vi.fn(),
  mockWritePublicSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  changePublicPassword: mockChangePublicPassword,
  requestPublicEmailChange: mockRequestPublicEmailChange,
  unlinkMyIdentity: mockUnlinkMyIdentity,
}));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: <Result>(
    _locale: string,
    _returnTo: string,
    run: () => Promise<Result>
  ) => run(),
  writePublicSessionCookie: mockWritePublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/social-sign-in-start", () => ({
  sendToProvider: mockSendToProvider,
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessToken = "session-token";
const currentPassword = "current-pass";
const newPassword = "new-pass";

/**
 * What `changePublicPassword` answers with. The Action never reads the session
 * it hands back — it forwards it to the cookie writer — so the expiry a real
 * one carries is left out and the assertion is on identity.
 */
const REPLACEMENT_SESSION = { accessToken: "replacement-token" };

const changePasswordForm = (
  overrides: Record<string, string> = {}
): FormData => {
  const data = new FormData();

  const values = {
    confirmPassword: newPassword,
    currentPassword,
    locale: "en",
    newPassword,
    tenantId,
    ...overrides,
  };

  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }

  return data;
};

/** A flash message, as a redirect carries it. */
interface Flash {
  message: string;
  status: string;
}

/** The flash the Action put on the `/settings/security` redirect it took. */
const lastFlash = (): Flash => {
  const path = mockRedirect.mock.calls.at(-1)?.[0] ?? "";
  const params = new URLSearchParams(path.slice(path.indexOf("?")));

  return {
    message: params.get("message") ?? "",
    status: params.get("status") ?? "",
  };
};

const importActions = () => import("./actions");

describe("changePasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("re-seals the session cookie with the token the change hands back", async () => {
    mockChangePublicPassword.mockResolvedValueOnce(REPLACEMENT_SESSION);

    const { changePasswordAction } = await importActions();
    await expect(changePasswordAction(changePasswordForm())).rejects.toThrow(
      /NEXT_REDIRECT/u
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockChangePublicPassword).toHaveBeenCalledWith(
      tenantId,
      currentPassword,
      newPassword,
      accessToken
    );
    expect(mockWritePublicSessionCookie).toHaveBeenCalledWith(
      REPLACEMENT_SESSION,
      tenantId
    );
    expect(lastFlash()).toEqual({
      message:
        "Your password has been changed. Your other devices have been signed out.",
      status: "success",
    });
  });

  it("reports a rejected change without touching the session cookie", async () => {
    mockChangePublicPassword.mockResolvedValueOnce(null);

    const { changePasswordAction } = await importActions();
    await expect(changePasswordAction(changePasswordForm())).rejects.toThrow(
      /NEXT_REDIRECT/u
    );

    expect(mockWritePublicSessionCookie).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Could not change your password. Please check what you entered.",
      status: "error",
    });
  });

  it("refuses a confirmation that does not match the new password", async () => {
    const { changePasswordAction } = await importActions();
    await expect(
      changePasswordAction(
        changePasswordForm({ confirmPassword: "typed-something-else" })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockChangePublicPassword).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message:
        "The passwords do not match. Enter the same password in both fields.",
      status: "error",
    });
  });

  it("refuses a new password equal to the current one", async () => {
    const { changePasswordAction } = await importActions();
    await expect(
      changePasswordAction(
        changePasswordForm({
          confirmPassword: currentPassword,
          newPassword: currentPassword,
        })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockChangePublicPassword).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Enter a new password that is different from your current one.",
      status: "error",
    });
  });

  it("rejects an empty submission before it reaches the session", async () => {
    const { changePasswordAction } = await importActions();
    await expect(
      changePasswordAction(
        changePasswordForm({
          confirmPassword: "",
          currentPassword: "",
          newPassword: "",
        })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockChangePublicPassword).not.toHaveBeenCalled();
    expect(lastFlash().status).toBe("error");
  });
});

/** A link or unlink row's form, which names the provider and nothing else. */
const providerForm = (provider = "google"): FormData => {
  const data = new FormData();
  data.set("locale", "en");
  data.set("provider", provider);
  data.set("tenantId", tenantId);

  return data;
};

describe("linkIdentityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("sends the reader to the provider with the session to link to", async () => {
    const { linkIdentityAction } = await importActions();

    await linkIdentityAction(providerForm("apple"));

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/settings/security",
      tenantId
    );
    expect(mockSendToProvider).toHaveBeenCalledWith({
      accessToken,
      intent: "link",
      locale: "en",
      provider: "apple",
      returnTo: "/settings/security",
      tenantId,
    });
  });

  it("refuses a provider the site does not know", async () => {
    const { linkIdentityAction } = await importActions();

    await expect(linkIdentityAction(providerForm("github"))).rejects.toThrow(
      /NEXT_REDIRECT/u
    );

    expect(mockSendToProvider).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Could not link the account. Please try again later.",
      status: "error",
    });
  });
});

describe("unlinkIdentityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("unlinks the provider and says so", async () => {
    mockUnlinkMyIdentity.mockResolvedValueOnce({ ok: true });
    const { unlinkIdentityAction } = await import("./actions");

    await expect(unlinkIdentityAction(providerForm())).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(mockUnlinkMyIdentity).toHaveBeenCalledWith(
      tenantId,
      "google",
      accessToken
    );
    expect(lastFlash()).toEqual({
      message: "The account was unlinked.",
      status: "success",
    });
  });

  it("explains why the last way in stays linked", async () => {
    mockUnlinkMyIdentity.mockResolvedValueOnce({
      error: new ConnectError("last", Code.FailedPrecondition),
      ok: false,
    });
    const { unlinkIdentityAction } = await import("./actions");

    await expect(unlinkIdentityAction(providerForm())).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(lastFlash()).toEqual({
      message:
        "Your account has no password or passkey, so the last linked account stays linked.",
      status: "error",
    });
  });

  it("refuses a provider the site does not know", async () => {
    const { unlinkIdentityAction } = await import("./actions");

    await expect(unlinkIdentityAction(providerForm("github"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(mockUnlinkMyIdentity).not.toHaveBeenCalled();
    expect(lastFlash().status).toBe("error");
  });
});

const emailChangeForm = (overrides: Record<string, string> = {}): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    currentEmail: "reader@example.com",
    locale: "en",
    newEmail: "moved@example.com",
    tenantId,
    ...overrides,
  })) {
    data.set(name, value);
  }

  return data;
};

describe("requestEmailChangeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("confirms the change with the account's password", async () => {
    mockRequestPublicEmailChange.mockResolvedValueOnce({ ok: true });
    const { requestEmailChangeAction } = await importActions();

    await expect(
      requestEmailChangeAction(emailChangeForm({ currentPassword }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockRequestPublicEmailChange).toHaveBeenCalledWith(
      tenantId,
      "reader@example.com",
      "moved@example.com",
      { password: currentPassword },
      accessToken
    );
    expect(lastFlash().status).toBe("success");
  });

  it("says the tenant refuses the new address", async () => {
    mockRequestPublicEmailChange.mockResolvedValueOnce({
      emailRefusal: "disposable_domain",
      ok: false,
    });
    const { requestEmailChangeAction } = await importActions();

    await expect(
      requestEmailChangeAction(emailChangeForm({ currentPassword }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(lastFlash()).toEqual({
      message:
        "This site does not accept addresses from disposable email services. Use another email address.",
      status: "error",
    });
  });

  it("keeps the general failure for a refusal that is not of the address", async () => {
    mockRequestPublicEmailChange.mockResolvedValueOnce({ ok: false });
    const { requestEmailChangeAction } = await importActions();

    await expect(
      requestEmailChangeAction(emailChangeForm({ currentPassword }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(lastFlash().status).toBe("error");
    expect(lastFlash().message).not.toContain("does not accept");
  });
});

describe("confirmEmailChangeWithProviderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("sends the reader to the provider with the addresses and the session", async () => {
    const { confirmEmailChangeWithProviderAction } = await importActions();

    await confirmEmailChangeWithProviderAction(
      emailChangeForm({ provider: "google" })
    );

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockSendToProvider).toHaveBeenCalledWith({
      accessToken,
      emailChange: {
        currentEmail: "reader@example.com",
        newEmail: "moved@example.com",
      },
      intent: "email_change",
      locale: "en",
      provider: "google",
      returnTo: "/settings/security",
      tenantId,
    });
    expect(mockRequestPublicEmailChange).not.toHaveBeenCalled();
  });

  it("refuses an address it cannot send to before the reader leaves the site", async () => {
    const { confirmEmailChangeWithProviderAction } = await importActions();

    await expect(
      confirmEmailChangeWithProviderAction(
        emailChangeForm({ newEmail: "not-an-address", provider: "google" })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockSendToProvider).not.toHaveBeenCalled();
    expect(lastFlash().status).toBe("error");
  });

  it("refuses a provider the site does not know", async () => {
    const { confirmEmailChangeWithProviderAction } = await importActions();

    await expect(
      confirmEmailChangeWithProviderAction(
        emailChangeForm({ provider: "github" })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockSendToProvider).not.toHaveBeenCalled();
    expect(lastFlash().status).toBe("error");
  });
});

describe("requestEmailChangeWithPasskeyAction", () => {
  const passkeyCredential = '{"id":"credential","type":"public-key"}';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePublicSession.mockResolvedValue(accessToken);
  });

  it("asks for the change with the assertion and reports it on the page", async () => {
    mockRequestPublicEmailChange.mockResolvedValueOnce({ ok: true });
    const { requestEmailChangeWithPasskeyAction } = await importActions();

    await expect(
      requestEmailChangeWithPasskeyAction(
        emailChangeForm({ passkeyCredential })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockRequestPublicEmailChange).toHaveBeenCalledWith(
      tenantId,
      "reader@example.com",
      "moved@example.com",
      { passkeyCredential },
      accessToken
    );
    expect(lastFlash()).toEqual({
      message:
        "We sent a confirmation email to both your current and your new address. Open both links to finish the change.",
      status: "success",
    });
  });

  it("keeps a refused change on the form, with the addresses still typed", async () => {
    mockRequestPublicEmailChange.mockResolvedValueOnce({ ok: false });
    const { requestEmailChangeWithPasskeyAction } = await importActions();

    await expect(
      requestEmailChangeWithPasskeyAction(
        emailChangeForm({ passkeyCredential })
      )
    ).resolves.toEqual({
      message:
        "Could not request the email change. Please check what you entered.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("refuses a submission without an assertion before it reaches the session", async () => {
    const { requestEmailChangeWithPasskeyAction } = await importActions();

    const state = await requestEmailChangeWithPasskeyAction(emailChangeForm());

    expect(state?.ok).toBe(false);
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockRequestPublicEmailChange).not.toHaveBeenCalled();
  });
});
