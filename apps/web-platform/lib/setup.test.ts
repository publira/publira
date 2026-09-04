import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialUser, isSetupCompleted } from "./setup";

const {
  mockCheckSetupStatus,
  mockCreateInitialUser,
  mockDropFailedCacheEntry,
} = vi.hoisted(() => ({
  mockCheckSetupStatus: vi.fn(),
  mockCreateInitialUser: vi.fn(),
  mockDropFailedCacheEntry: vi.fn(),
}));

vi.mock("@publira/api-client/platform/client", () => ({
  createPlatformApiClient: () => ({
    auth: {},
    setup: {
      checkSetupStatus: mockCheckSetupStatus,
      createInitialUser: mockCreateInitialUser,
    },
  }),
}));

vi.mock("@publira/utils/cached-read", () => ({
  dropFailedCacheEntry: mockDropFailedCacheEntry,
}));

describe("isSetupCompleted", () => {
  beforeEach(() => {
    mockDropFailedCacheEntry.mockReset();
  });

  it("returns true when the API returns setup_completed=true", async () => {
    mockCheckSetupStatus.mockResolvedValueOnce({
      defaultLocale: "ja",
      setupCompleted: true,
    });

    await expect(isSetupCompleted()).resolves.toEqual({
      available: true,
      completed: true,
    });
  });

  it("returns false when the API returns setup_completed=false", async () => {
    mockCheckSetupStatus.mockResolvedValueOnce({
      defaultLocale: "",
      setupCompleted: false,
    });

    await expect(isSetupCompleted()).resolves.toEqual({
      available: true,
      completed: false,
    });
  });

  it("returns null for expected errors", async () => {
    mockCheckSetupStatus.mockRejectedValueOnce(
      new ConnectError("setup not initialized", Code.FailedPrecondition)
    );

    await expect(isSetupCompleted()).resolves.toEqual({
      available: true,
      completed: null,
    });
  });

  it("returns unavailable when it cannot read the status", async () => {
    mockCheckSetupStatus.mockRejectedValueOnce(new Error("network"));

    await expect(isSetupCompleted()).resolves.toEqual({ available: false });
    expect(mockDropFailedCacheEntry).toHaveBeenCalledOnce();
  });
});

const unavailable = (): ConnectError =>
  new ConnectError("connect ECONNREFUSED 127.0.0.1:8102", Code.Unavailable);

const loadSetup = () => import("./setup");

/**
 * `proxy.ts` reads the setup state on every request it matches, so the read has
 * to answer even while the platform API is down: a throw there is a bare 500
 * for the whole console, with no page rendered to put an error screen on.
 *
 * Each case re-imports the module so the process-wide "last known state" starts
 * empty, which is what a freshly started server instance sees.
 */
describe("resolveSetupState", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheckSetupStatus.mockReset();
  });

  it("returns the values from the API unchanged", async () => {
    mockCheckSetupStatus.mockResolvedValue({
      defaultLocale: "en",
      setupCompleted: false,
    });
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: false,
      defaultLocale: "en",
    });
  });

  it("continues routing with the most recent API value when the connection fails", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ defaultLocale: "ja", setupCompleted: false })
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: false,
      defaultLocale: "ja",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: false,
      defaultLocale: "ja",
    });
  });

  it("keeps reporting no saved language when the connection then fails", async () => {
    mockCheckSetupStatus
      .mockRejectedValueOnce(
        new ConnectError("setup not initialized", Code.FailedPrecondition)
      )
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: null,
      defaultLocale: "none",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: null,
      defaultLocale: "none",
    });
  });

  /**
   * A process that has never had an answer knows nothing about the saved
   * language, which is not the same as knowing there is none: the browser keeps
   * whatever an earlier process published rather than losing it to a restart
   * that happened during the outage.
   */
  it("treats connection errors before any API response as setup complete and the language unknown", async () => {
    mockCheckSetupStatus.mockRejectedValue(unavailable());
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "unknown",
    });
  });

  it("uses the API response again after recovery", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ defaultLocale: "", setupCompleted: false })
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce({ defaultLocale: "ja", setupCompleted: true });
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: false,
      defaultLocale: "none",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: false,
      defaultLocale: "none",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "ja",
    });
  });

  // An outage does not change what the platform saved, and the console reading
  // the error screen it produces must not change language on the operator.
  it("keeps the saved language through an outage", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ defaultLocale: "ja", setupCompleted: true })
      .mockRejectedValue(unavailable());
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "ja",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "ja",
    });
  });

  it("reports no language for a code this build has no catalog for", async () => {
    mockCheckSetupStatus.mockResolvedValue({
      defaultLocale: "fr",
      setupCompleted: true,
    });
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "none",
    });
  });

  // Only an outage keeps the previous language. An answer naming a code this
  // build cannot render is an answer, and publishing the language before it
  // would put a language on screen the platform no longer names.
  it("drops the remembered language once the API answers with one it cannot render", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ defaultLocale: "ja", setupCompleted: true })
      .mockResolvedValueOnce({ defaultLocale: "fr", setupCompleted: true })
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupState } = await loadSetup();

    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "ja",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "none",
    });
    await expect(resolveSetupState()).resolves.toEqual({
      completed: true,
      defaultLocale: "none",
    });
  });
});

describe("createInitialUser", () => {
  it("sends the chosen default locale and reports success", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({});

    await expect(
      createInitialUser({
        defaultLocale: "en",
        email: "admin@example.com",
        locale: "en",
        name: "Admin",
        password: "password",
      })
    ).resolves.toEqual({ ok: true });
    expect(mockCreateInitialUser).toHaveBeenCalledWith({
      defaultLocale: "en",
      email: "admin@example.com",
      name: "Admin",
      password: "password",
    });
  });

  it("reports an already-completed setup with its own message", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("setup already completed", Code.AlreadyExists)
    );

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "admin@example.com",
        locale: "en",
        name: "Admin",
        password: "password",
      })
    ).resolves.toEqual({
      alreadyCompleted: true,
      message: "Setup is already complete. Sign in from the sign-in screen.",
      ok: false,
    });
  });

  it("reports an invalid argument as a validation message", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "invalid",
        locale: "en",
        name: "Admin",
        password: "password",
      })
    ).resolves.toEqual({
      alreadyCompleted: false,
      message: "The submitted values are invalid.",
      ok: false,
    });
  });

  it("renders the failure copy in the locale it was given, so locale=ja is Japanese", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("setup already completed", Code.AlreadyExists)
    );

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "admin@example.com",
        locale: "ja",
        name: "Admin",
        password: "password",
      })
    ).resolves.toEqual({
      alreadyCompleted: true,
      message:
        "セットアップは既に完了しています。ログイン画面からサインインしてください。",
      ok: false,
    });
  });

  it("rethrows an RPC error it cannot classify", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "admin@example.com",
        locale: "en",
        name: "Admin",
        password: "password",
      })
    ).rejects.toThrow("boom");
  });

  it("rethrows a rejection that is not an RPC error", async () => {
    mockCreateInitialUser.mockRejectedValueOnce("boom");

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "admin@example.com",
        locale: "en",
        name: "Admin",
        password: "password",
      })
    ).rejects.toBe("boom");
  });
});
