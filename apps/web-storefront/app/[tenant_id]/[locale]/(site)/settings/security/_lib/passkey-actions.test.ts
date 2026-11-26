import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockBeginMyPasskeyRegistration,
  mockClearPendingPasskeyRegistration,
  mockDeleteMyPasskey,
  mockReadPendingPasskeyRegistration,
  mockFinishMyPasskeyRegistration,
  mockRedirect,
  mockRefresh,
  mockRenameMyPasskey,
  mockRequirePublicSession,
  mockSendToProvider,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockBeginMyPasskeyRegistration: vi.fn(),
  mockClearPendingPasskeyRegistration: vi.fn(),
  mockReadPendingPasskeyRegistration: vi.fn(),
  mockDeleteMyPasskey: vi.fn(),
  mockFinishMyPasskeyRegistration: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockRefresh: vi.fn(),
  mockRenameMyPasskey: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockSendToProvider: vi.fn(),
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
  withPublicSessionReauth: <Result>(
    _locale: string,
    _returnTo: string,
    run: () => Promise<Result>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/pending-passkey-registration", () => ({
  clearPendingPasskeyRegistration: mockClearPendingPasskeyRegistration,
  readPendingPasskeyRegistration: mockReadPendingPasskeyRegistration,
}));

vi.mock("#lib/social-sign-in-start", () => ({
  sendToProvider: mockSendToProvider,
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: () => "en",
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accessToken = "session-token";
const credential = '{"id":"credential","type":"public-key"}';
const password = "current-pass";

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

    await expect(
      beginPasskeyRegistrationAction(form({ password }))
    ).resolves.toEqual({
      message: "",
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockBeginMyPasskeyRegistration).toHaveBeenCalledWith(
      tenantId,
      { password },
      accessToken
    );
  });

  it("begins one confirmed by another passkey's assertion", async () => {
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    const { beginPasskeyRegistrationAction } = await importActions();

    await beginPasskeyRegistrationAction(
      form({ passkeyCredential: credential })
    );

    expect(mockBeginMyPasskeyRegistration).toHaveBeenCalledWith(
      tenantId,
      { passkeyCredential: credential },
      accessToken
    );
  });

  it("refuses one the form did not confirm before asking the API", async () => {
    const { beginPasskeyRegistrationAction } = await importActions();

    await expect(beginPasskeyRegistrationAction(form({}))).resolves.toEqual({
      message: "Could not add the passkey. Please try again later.",
      ok: false,
    });
    expect(mockBeginMyPasskeyRegistration).not.toHaveBeenCalled();
  });

  it("says when the password is wrong", async () => {
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      error: new ConnectError(
        "invalid password",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "password" }] },
          },
        ]
      ),
      ok: false,
    });
    const { beginPasskeyRegistrationAction } = await importActions();

    await expect(
      beginPasskeyRegistrationAction(form({ password: "not-it" }))
    ).resolves.toEqual({ message: "The password is incorrect.", ok: false });
  });

  it("says when the account holds as many passkeys as it may", async () => {
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      error: new ConnectError("limit", Code.FailedPrecondition),
      ok: false,
    });
    const { beginPasskeyRegistrationAction } = await importActions();

    await expect(
      beginPasskeyRegistrationAction(form({ password }))
    ).resolves.toEqual({
      message:
        "Your account has as many passkeys as it can hold. Remove one before adding another.",
      ok: false,
    });
  });

  it("refuses a form that did not come from the site before asking the API", async () => {
    const { beginPasskeyRegistrationAction } = await importActions();

    const state = await beginPasskeyRegistrationAction(
      form({ password, tenantId: "not-a-tenant" })
    );

    expect(state.ok).toBe(false);
    expect(mockRequirePublicSession).not.toHaveBeenCalled();
    expect(mockBeginMyPasskeyRegistration).not.toHaveBeenCalled();
  });
});

describe("beginPendingPasskeyRegistrationAction", () => {
  const pending = {
    idToken: "header.payload.signature",
    nonce: "nonce",
    provider: "google",
    tenantId,
  } as const;

  it("begins one with the sign-in the callback left, and spends it", async () => {
    mockReadPendingPasskeyRegistration.mockResolvedValueOnce(pending);
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    const { beginPendingPasskeyRegistrationAction } = await importActions();

    await expect(
      beginPendingPasskeyRegistrationAction(form({}))
    ).resolves.toEqual({
      message: "",
      ok: true,
      optionsJson: '{"challenge":"abc"}',
    });
    expect(mockBeginMyPasskeyRegistration).toHaveBeenCalledWith(
      tenantId,
      { idToken: pending.idToken, nonce: pending.nonce, provider: "google" },
      accessToken
    );
    expect(mockClearPendingPasskeyRegistration).toHaveBeenCalled();
  });

  it("goes back to the page when the sign-in is gone", async () => {
    mockReadPendingPasskeyRegistration.mockResolvedValueOnce(null);
    const { beginPendingPasskeyRegistrationAction } = await importActions();

    await expect(
      beginPendingPasskeyRegistrationAction(form({}))
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockBeginMyPasskeyRegistration).not.toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Your sign-in could not be confirmed. Please try again.",
      status: "error",
    });
  });

  it("goes back to the page, with the sign-in spent, when the API refuses it", async () => {
    mockReadPendingPasskeyRegistration.mockResolvedValueOnce(pending);
    mockBeginMyPasskeyRegistration.mockResolvedValueOnce({
      error: new ConnectError("expired", Code.InvalidArgument),
      ok: false,
    });
    const { beginPendingPasskeyRegistrationAction } = await importActions();

    await expect(
      beginPendingPasskeyRegistrationAction(form({}))
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockClearPendingPasskeyRegistration).toHaveBeenCalled();
    expect(lastFlash()).toEqual({
      message: "Your sign-in could not be confirmed. Please try again.",
      status: "error",
    });
  });
});

describe("discardPendingPasskeyRegistrationAction", () => {
  it("drops the waiting sign-in and goes back to the page", async () => {
    const { discardPendingPasskeyRegistrationAction } = await importActions();

    await expect(
      discardPendingPasskeyRegistrationAction(form({}))
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockClearPendingPasskeyRegistration).toHaveBeenCalled();
    expect(mockRedirect.mock.calls.at(-1)?.[0]).toBe("/settings/security");
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
  it("removes the passkey with the password the dialog asked for, and says so on the page", async () => {
    mockDeleteMyPasskey.mockResolvedValueOnce({ ok: true });
    const { deletePasskeyAction } = await importActions();

    await expect(
      deletePasskeyAction(null, form({ passkeyId: "PSKY0001", password }))
    ).rejects.toThrow(/NEXT_REDIRECT/u);

    expect(mockDeleteMyPasskey).toHaveBeenCalledWith(
      tenantId,
      "PSKY0001",
      { password },
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

  it("explains in the dialog why the last way in stays registered", async () => {
    mockDeleteMyPasskey.mockResolvedValueOnce({
      error: new ConnectError("last", Code.FailedPrecondition),
      ok: false,
    });
    const { deletePasskeyWithPasskeyAction } = await importActions();

    await expect(
      deletePasskeyWithPasskeyAction(
        form({ passkeyCredential: credential, passkeyId: "PSKY0001" })
      )
    ).resolves.toEqual({
      message:
        "Your account has no password or linked account, so its last passkey stays registered.",
      ok: false,
    });
    expect(mockDeleteMyPasskey).toHaveBeenCalledWith(
      tenantId,
      "PSKY0001",
      { passkeyCredential: credential },
      accessToken
    );
  });

  it("refuses a removal without a passkey or a confirmation before asking the API", async () => {
    const { deletePasskeyAction } = await importActions();

    await expect(
      deletePasskeyAction(null, form({ password }))
    ).resolves.toEqual({
      message: "Could not remove the passkey. Please try again later.",
      ok: false,
    });
    await expect(
      deletePasskeyAction(null, form({ passkeyId: "PSKY0001" }))
    ).resolves.toMatchObject({ ok: false });
    expect(mockDeleteMyPasskey).not.toHaveBeenCalled();
  });
});

describe("confirmPasskeyChangeWithProviderAction", () => {
  it("sends the reader to the provider with the passkey to remove waiting", async () => {
    const { confirmPasskeyChangeWithProviderAction } = await importActions();

    await confirmPasskeyChangeWithProviderAction(
      form({
        intent: "passkey_remove",
        passkeyId: "PSKY0001",
        provider: "google",
      })
    );

    expect(mockSendToProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken,
        tenantId,
        intent: "passkey_remove",
        provider: "google",
        target: "PSKY0001",
      })
    );
  });

  it("turns a form that names no tenant away without looking one up", async () => {
    const { confirmPasskeyChangeWithProviderAction } = await importActions();

    await expect(
      confirmPasskeyChangeWithProviderAction(
        form({
          intent: "passkey_add",
          provider: "google",
          tenantId: "not-a-tenant",
        })
      )
    ).resolves.toBeUndefined();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockSendToProvider).not.toHaveBeenCalled();
  });

  it("refuses a removal that names no passkey", async () => {
    const { confirmPasskeyChangeWithProviderAction } = await importActions();

    await expect(
      confirmPasskeyChangeWithProviderAction(
        form({ intent: "passkey_remove", provider: "google" })
      )
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockSendToProvider).not.toHaveBeenCalled();
  });
});
