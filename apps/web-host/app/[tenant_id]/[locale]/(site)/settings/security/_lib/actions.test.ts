import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockChangePublicPassword,
  mockRedirect,
  mockRequirePublicSession,
  mockWritePublicSessionCookie,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockChangePublicPassword: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRequirePublicSession: vi.fn(),
  mockWritePublicSessionCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/auth", () => ({
  changePublicPassword: mockChangePublicPassword,
  requestPublicEmailChange: vi.fn(),
}));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
  writePublicSessionCookie: mockWritePublicSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

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
  const values: Record<string, string> = {
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

/** The flash the Action put on the `/settings/security` redirect it took. */
const lastFlash = (): { message: string; status: string } => {
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
