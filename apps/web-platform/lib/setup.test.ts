import { Code, ConnectError } from "@publira/api-client/errors";
import { describe, expect, it, vi } from "vitest";

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

describe("createInitialUser", () => {
  it("API 成功時は ok=true を返す", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({});

    await expect(
      createInitialUser("管理者", "admin@example.com", "password")
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
      createInitialUser("管理者", "admin@example.com", "password")
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
      createInitialUser("管理者", "invalid", "password")
    ).resolves.toEqual({
      alreadyCompleted: false,
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockCreateInitialUser.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      createInitialUser("管理者", "admin@example.com", "password")
    ).rejects.toThrow("boom");
  });

  it("RPC 由来でない例外も伝播する", async () => {
    mockCreateInitialUser.mockRejectedValueOnce("boom");

    await expect(
      createInitialUser("管理者", "admin@example.com", "password")
    ).rejects.toBe("boom");
  });
});
