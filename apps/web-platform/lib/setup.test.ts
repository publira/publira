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
    mockCheckSetupStatus.mockResolvedValueOnce({ setupCompleted: true });

    await expect(isSetupCompleted()).resolves.toEqual({
      available: true,
      completed: true,
    });
  });

  it("returns false when the API returns setup_completed=false", async () => {
    mockCheckSetupStatus.mockResolvedValueOnce({ setupCompleted: false });

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
describe("resolveSetupCompleted", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheckSetupStatus.mockReset();
  });

  it("returns the value from the API unchanged", async () => {
    mockCheckSetupStatus.mockResolvedValue({ setupCompleted: false });
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(false);
  });

  it("continues routing with the most recent API value when the connection fails", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ setupCompleted: false })
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(false);
    await expect(resolveSetupCompleted()).resolves.toBe(false);
  });

  it("keeps null when the most recent known value is null and the connection fails", async () => {
    mockCheckSetupStatus
      .mockRejectedValueOnce(
        new ConnectError("setup not initialized", Code.FailedPrecondition)
      )
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBeNull();
    await expect(resolveSetupCompleted()).resolves.toBeNull();
  });

  it("treats connection errors before any API response as setup complete", async () => {
    mockCheckSetupStatus.mockRejectedValue(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(true);
  });

  it("uses the API response again after recovery", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ setupCompleted: false })
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce({ setupCompleted: true });
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(false);
    await expect(resolveSetupCompleted()).resolves.toBe(false);
    await expect(resolveSetupCompleted()).resolves.toBe(true);
  });
});

describe("createInitialUser", () => {
  it("sends the chosen default locale and reports success", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({});

    await expect(
      createInitialUser({
        defaultLocale: "en",
        email: "admin@example.com",
        locale: "ja",
        name: "管理者",
        password: "password",
      })
    ).resolves.toEqual({ ok: true });
    expect(mockCreateInitialUser).toHaveBeenCalledWith({
      defaultLocale: "en",
      email: "admin@example.com",
      name: "管理者",
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
        locale: "ja",
        name: "管理者",
        password: "password",
      })
    ).resolves.toEqual({
      alreadyCompleted: true,
      message:
        "セットアップは既に完了しています。ログイン画面からサインインしてください。",
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
        locale: "ja",
        name: "管理者",
        password: "password",
      })
    ).resolves.toEqual({
      alreadyCompleted: false,
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("renders the failure copy in the locale it was given", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("setup already completed", Code.AlreadyExists)
    );

    await expect(
      createInitialUser({
        defaultLocale: "en",
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

  it("rethrows an RPC error it cannot classify", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      createInitialUser({
        defaultLocale: "ja",
        email: "admin@example.com",
        locale: "ja",
        name: "管理者",
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
        locale: "ja",
        name: "管理者",
        password: "password",
      })
    ).rejects.toBe("boom");
  });
});
