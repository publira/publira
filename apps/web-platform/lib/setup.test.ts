import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialUser, isSetupCompleted } from "./setup";

const { mockCheckSetupStatus, mockCreateInitialUser } = vi.hoisted(() => ({
  mockCheckSetupStatus: vi.fn(),
  mockCreateInitialUser: vi.fn(),
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

describe("isSetupCompleted", () => {
  it("API が setup_completed=true を返した場合 true を返す", async () => {
    mockCheckSetupStatus.mockResolvedValueOnce({ setupCompleted: true });

    await expect(isSetupCompleted()).resolves.toBe(true);
  });

  it("API が setup_completed=false を返した場合 false を返す", async () => {
    mockCheckSetupStatus.mockResolvedValueOnce({ setupCompleted: false });

    await expect(isSetupCompleted()).resolves.toBe(false);
  });

  it("想定内エラー時は null を返す", async () => {
    mockCheckSetupStatus.mockRejectedValueOnce(
      new ConnectError("setup not initialized", Code.FailedPrecondition)
    );

    await expect(isSetupCompleted()).resolves.toBeNull();
  });

  it("想定外エラー時は再throwする", async () => {
    mockCheckSetupStatus.mockRejectedValueOnce(new Error("network"));

    await expect(isSetupCompleted()).rejects.toThrow("network");
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

  it("API が答えた値をそのまま返す", async () => {
    mockCheckSetupStatus.mockResolvedValue({ setupCompleted: false });
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(false);
  });

  it("接続できないときは直近に API が答えた値でルーティングを続ける", async () => {
    mockCheckSetupStatus
      .mockResolvedValueOnce({ setupCompleted: false })
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(false);
    await expect(resolveSetupCompleted()).resolves.toBe(false);
  });

  it("直近の既知値が null なら接続エラー時も null のままにする", async () => {
    mockCheckSetupStatus
      .mockRejectedValueOnce(
        new ConnectError("setup not initialized", Code.FailedPrecondition)
      )
      .mockRejectedValueOnce(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBeNull();
    await expect(resolveSetupCompleted()).resolves.toBeNull();
  });

  it("API が一度も答えていない状態の接続エラーはセットアップ済みとして扱う", async () => {
    mockCheckSetupStatus.mockRejectedValue(unavailable());
    const { resolveSetupCompleted } = await loadSetup();

    await expect(resolveSetupCompleted()).resolves.toBe(true);
  });

  it("復旧後は API の答えに戻る", async () => {
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
  it("API 成功時は ok=true を返す", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({});

    await expect(
      createInitialUser("管理者", "admin@example.com", "password", "ja")
    ).resolves.toEqual({ ok: true });
    expect(mockCreateInitialUser).toHaveBeenCalledWith({
      email: "admin@example.com",
      name: "管理者",
      password: "password",
    });
  });

  it("セットアップ済みエラー時は専用メッセージを返す", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("setup already completed", Code.AlreadyExists)
    );

    await expect(
      createInitialUser("管理者", "admin@example.com", "password", "ja")
    ).resolves.toEqual({
      alreadyCompleted: true,
      message:
        "セットアップは既に完了しています。ログイン画面からサインインしてください。",
      ok: false,
    });
  });

  it("入力エラー時は入力内容エラーのメッセージを返す", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );

    await expect(
      createInitialUser("管理者", "invalid", "password", "ja")
    ).resolves.toEqual({
      alreadyCompleted: false,
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("locale=en では英語のメッセージを返す", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("setup already completed", Code.AlreadyExists)
    );

    await expect(
      createInitialUser("Admin", "admin@example.com", "password", "en")
    ).resolves.toEqual({
      alreadyCompleted: true,
      message: "Setup is already complete. Sign in from the sign-in screen.",
      ok: false,
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      createInitialUser("管理者", "admin@example.com", "password", "ja")
    ).rejects.toThrow("boom");
  });

  it("RPC 由来でない例外も伝播する", async () => {
    mockCreateInitialUser.mockRejectedValueOnce("boom");

    await expect(
      createInitialUser("管理者", "admin@example.com", "password", "ja")
    ).rejects.toBe("boom");
  });
});
