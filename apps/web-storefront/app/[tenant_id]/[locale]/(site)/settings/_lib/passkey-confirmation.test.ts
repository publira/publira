import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockBeginMyPasskeyConfirmation,
  mockClearPublicSessionCookie,
  mockDeleteMe,
  mockRedirect,
  mockRequirePublicSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBeginMyPasskeyConfirmation: vi.fn(),
  mockClearPublicSessionCookie: vi.fn(),
  mockDeleteMe: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRequirePublicSession: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth", () => ({
  accountCacheTag: (tenantId: string) => `tenant:${tenantId}:account`,
  beginMyPasskeyConfirmation: mockBeginMyPasskeyConfirmation,
  deleteMe: mockDeleteMe,
  updateMe: vi.fn(),
}));

vi.mock("#lib/auth-session", () => ({
  clearPublicSessionCookie: mockClearPublicSessionCookie,
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessToken = "session-token";
const passkeyCredential = '{"id":"credential","type":"public-key"}';

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    locale: "en",
    tenantId,
    ...values,
  })) {
    data.set(name, value);
  }

  return data;
};

const importConfirmationActions = () =>
  import("./passkey-confirmation-actions");

const importSettingsActions = () => import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePublicSession.mockResolvedValue(accessToken);
});

describe("beginPasskeyConfirmationAction", () => {
  it("answers the options, signing in again to the screen the form is on", async () => {
    mockBeginMyPasskeyConfirmation.mockResolvedValueOnce({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });

    const { beginPasskeyConfirmationAction } =
      await importConfirmationActions();

    await expect(
      beginPasskeyConfirmationAction(form({ returnTo: "/settings/security" }))
    ).resolves.toEqual({
      message: "",
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/settings/security",
      tenantId
    );
    expect(mockBeginMyPasskeyConfirmation).toHaveBeenCalledWith(
      tenantId,
      accessToken
    );
  });

  it("says when the account holds no passkey", async () => {
    mockBeginMyPasskeyConfirmation.mockResolvedValueOnce({
      error: new ConnectError("none", Code.FailedPrecondition),
      ok: false,
    });

    const { beginPasskeyConfirmationAction } =
      await importConfirmationActions();

    await expect(
      beginPasskeyConfirmationAction(form({ returnTo: "/settings" }))
    ).resolves.toEqual({
      message: "No passkey is registered to your account. Confirm another way.",
      ok: false,
    });
  });
});

describe("deleteAccountWithPasskeyAction", () => {
  it("deletes the account with the assertion, signs the reader out, and ends on the sign-in page", async () => {
    mockDeleteMe.mockResolvedValueOnce("deleted");
    const { deleteAccountWithPasskeyAction } = await importSettingsActions();

    await expect(
      deleteAccountWithPasskeyAction(form({ passkeyCredential }))
    ).rejects.toThrow(/NEXT_REDIRECT:\/login\?/u);

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockDeleteMe).toHaveBeenCalledWith(
      tenantId,
      { passkeyCredential },
      accessToken
    );
    expect(mockClearPublicSessionCookie).toHaveBeenCalled();
  });

  it("keeps a refused deletion in the dialog and the reader signed in", async () => {
    mockDeleteMe.mockResolvedValueOnce("failed");
    const { deleteAccountWithPasskeyAction } = await importSettingsActions();

    await expect(
      deleteAccountWithPasskeyAction(form({ passkeyCredential }))
    ).resolves.toEqual({
      message: "Could not delete your account. Please check what you entered.",
      ok: false,
    });
    expect(mockClearPublicSessionCookie).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("explains why the tenant's last admin is kept", async () => {
    mockDeleteMe.mockResolvedValueOnce("last_tenant_admin");
    const { deleteAccountWithPasskeyAction } = await importSettingsActions();

    const state = await deleteAccountWithPasskeyAction(
      form({ passkeyCredential })
    );

    expect(state?.message).toContain("last tenant admin");
  });

  it("refuses a submission without an assertion before it reaches the session", async () => {
    const { deleteAccountWithPasskeyAction } = await importSettingsActions();

    const state = await deleteAccountWithPasskeyAction(form({}));

    expect(state?.ok).toBe(false);
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockDeleteMe).not.toHaveBeenCalled();
  });
});
