import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockBeginMyPasskeyRegistration,
  mockDeleteMyPasskey,
  mockFinishMyPasskeyRegistration,
  mockRedirect,
  mockRefresh,
  mockRenameMyPasskey,
  mockRequirePublicSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBeginMyPasskeyRegistration: vi.fn(),
  mockDeleteMyPasskey: vi.fn(),
  mockFinishMyPasskeyRegistration: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRefresh: vi.fn(),
  mockRenameMyPasskey: vi.fn(),
  mockRequirePublicSession: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mockRefresh }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/auth", () => ({
  beginMyPasskeyRegistration: mockBeginMyPasskeyRegistration,
  deleteMyPasskey: mockDeleteMyPasskey,
  finishMyPasskeyRegistration: mockFinishMyPasskeyRegistration,
  renameMyPasskey: mockRenameMyPasskey,
}));

vi.mock("#lib/auth-session", () => ({
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
const credential = '{"id":"credential","type":"public-key"}';

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

/** The flash the Action put on the `/settings/security` redirect it took. */
const lastFlash = (): { message: string; status: string } => {
  const path = mockRedirect.mock.calls.at(-1)?.[0] ?? "";
  const params = new URLSearchParams(path.slice(path.indexOf("?")));
  return {
    message: params.get("message") ?? "",
    status: params.get("status") ?? "",
  };
};

const importActions = () => import("./passkey-actions");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePublicSession.mockResolvedValue(accessToken);
});

describe("beginPasskeyRegistrationAction", () => {
  it("answers the options the API began the registration with", async () => {
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    const { beginPasskeyRegistrationAction } = await importActions();

    await expect(beginPasskeyRegistrationAction(form({}))).resolves.toEqual({
      message: "",
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockBeginMyPasskeyRegistration).toHaveBeenCalledWith(
      tenantId,
      accessToken
    );
  });

  it("says when the account holds as many passkeys as it may", async () => {
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      error: new ConnectError("limit", Code.FailedPrecondition),
      ok: false,
    });
    const { beginPasskeyRegistrationAction } = await importActions();

    await expect(beginPasskeyRegistrationAction(form({}))).resolves.toEqual({
      message:
        "Your account has as many passkeys as it can hold. Remove one before adding another.",
      ok: false,
    });
  });

  it("refuses a form that did not come from the site before asking the API", async () => {
    const { beginPasskeyRegistrationAction } = await importActions();

    const state = await beginPasskeyRegistrationAction(
      form({ tenantId: "not-a-tenant" })
    );

    expect(state.ok).toBe(false);
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockBeginMyPasskeyRegistration).not.toHaveBeenCalled();
  });
});

describe("finishPasskeyRegistrationAction", () => {
  it("stores the passkey, reads the list again, and hands its id to the naming step", async () => {
    mockFinishMyPasskeyRegistration.mockResolvedValueOnce({
      ok: true,
      passkey: { id: "PSKY0001" },
    });
    const { finishPasskeyRegistrationAction } = await importActions();

    await expect(
      finishPasskeyRegistrationAction(form({ credential }))
    ).resolves.toEqual({ message: "", ok: true, passkeyId: "PSKY0001" });
    expect(mockFinishMyPasskeyRegistration).toHaveBeenCalledWith(
      tenantId,
      credential,
      accessToken
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("says when the passkey is registered already", async () => {
    mockFinishMyPasskeyRegistration.mockResolvedValueOnce({
      error: new ConnectError("exists", Code.AlreadyExists),
      ok: false,
    });
    const { finishPasskeyRegistrationAction } = await importActions();

    await expect(
      finishPasskeyRegistrationAction(form({ credential }))
    ).resolves.toEqual({
      message: "This passkey is already registered to your account.",
      ok: false,
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refuses a submission without a credential", async () => {
    const { finishPasskeyRegistrationAction } = await importActions();

    await expect(finishPasskeyRegistrationAction(form({}))).resolves.toEqual({
      message: "Could not add the passkey. Please try again later.",
      ok: false,
    });
    expect(mockFinishMyPasskeyRegistration).not.toHaveBeenCalled();
  });
});

describe("namePasskeyAction", () => {
  it("names the passkey and reads the list again", async () => {
    mockRenameMyPasskey.mockResolvedValueOnce({ ok: true });
    const { namePasskeyAction } = await importActions();

    await expect(
      namePasskeyAction(null, form({ name: " Laptop ", passkeyId: "PSKY0001" }))
    ).resolves.toEqual({ message: "", ok: true });
    expect(mockRenameMyPasskey).toHaveBeenCalledWith(
      tenantId,
      "PSKY0001",
      "Laptop",
      accessToken
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("refuses a name longer than the API keeps", async () => {
    const { namePasskeyAction } = await importActions();

    await expect(
      namePasskeyAction(
        null,
        form({ name: "x".repeat(65), passkeyId: "PSKY0001" })
      )
    ).resolves.toEqual({
      message: "Use 64 characters or fewer for the name.",
      ok: false,
    });
    expect(mockRenameMyPasskey).not.toHaveBeenCalled();
  });

  it("says when the passkey is gone", async () => {
    mockRenameMyPasskey.mockResolvedValueOnce({
      error: new ConnectError("missing", Code.NotFound),
      ok: false,
    });
    const { namePasskeyAction } = await importActions();

    await expect(
      namePasskeyAction(null, form({ name: "Laptop", passkeyId: "PSKY0001" }))
    ).resolves.toEqual({
      message: "That passkey is no longer registered to your account.",
      ok: false,
    });
  });
});

describe("deletePasskeyAction", () => {
  it("removes the passkey and says so on the page", async () => {
    mockDeleteMyPasskey.mockResolvedValueOnce({ ok: true });
    const { deletePasskeyAction } = await importActions();

    await expect(
      deletePasskeyAction(form({ passkeyId: "PSKY0001" }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockDeleteMyPasskey).toHaveBeenCalledWith(
      tenantId,
      "PSKY0001",
      accessToken
    );
    expect(mockRedirect.mock.calls.at(-1)?.[0]).toMatch(
      /^\/settings\/security\?/u
    );
    expect(lastFlash()).toEqual({
      message: "The passkey has been removed.",
      status: "success",
    });
  });

  it("explains why the last way in stays registered", async () => {
    mockDeleteMyPasskey.mockResolvedValueOnce({
      error: new ConnectError("last", Code.FailedPrecondition),
      ok: false,
    });
    const { deletePasskeyAction } = await importActions();

    await expect(
      deletePasskeyAction(form({ passkeyId: "PSKY0001" }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(lastFlash()).toEqual({
      message:
        "Your account has no password or linked account, so its last passkey stays registered.",
      status: "error",
    });
  });

  it("refuses a row without a passkey before asking the API", async () => {
    const { deletePasskeyAction } = await importActions();

    await expect(deletePasskeyAction(form({}))).rejects.toThrow(
      /NEXT_REDIRECT/u
    );

    expect(mockDeleteMyPasskey).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Could not remove the passkey. Please try again later.",
      status: "error",
    });
  });
});
