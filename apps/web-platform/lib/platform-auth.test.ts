import { describe, expect, it, vi } from "vitest";

import {
  getPlatformCurrentOperator,
  loginPlatform,
  logoutPlatform,
} from "./platform-auth";

const { mockCreateSession, mockDeleteSession, mockGetMe } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockGetMe: vi.fn(),
}));

vi.mock("@publira/api-client/platform/client", () => ({
  createPlatformApiClient: () => ({
    auth: {
      createSession: mockCreateSession,
      deleteSession: mockDeleteSession,
      getMe: mockGetMe,
    },
    setup: {},
  }),
}));

describe("loginPlatform", () => {
  it("API 成功時は sessionId と expiresAt を返す", async () => {
    const expiresAt = "2026-03-22T00:00:00Z";
    mockCreateSession.mockResolvedValueOnce({
      session: { expiresAt, sessionId: "tok_abc" },
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await loginPlatform("admin@example.com", "secret");
    expect(result).toEqual({
      expiresAt: new Date(expiresAt),
      sessionId: "tok_abc",
    });
    expect(mockCreateSession).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret",
    });
  });

  it("API がセッション情報を返さない場合は null を返す", async () => {
    mockCreateSession.mockResolvedValueOnce({ user: {} });

    await expect(loginPlatform("a@b.com", "x")).resolves.toBeNull();
  });

  it("認証失敗 (Unauthenticated エラー) は null を返す", async () => {
    mockCreateSession.mockRejectedValueOnce(
      new Error("unauthenticated: invalid credentials")
    );

    await expect(loginPlatform("a@b.com", "wrong")).resolves.toBeNull();
  });

  it("ネットワークエラー時も null を返す", async () => {
    mockCreateSession.mockRejectedValueOnce(new Error("network error"));

    await expect(loginPlatform("a@b.com", "x")).resolves.toBeNull();
  });
});

describe("logoutPlatform", () => {
  it("sessionId が空文字の場合 API を呼ばない", async () => {
    await logoutPlatform("  ");
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it("正常な sessionId で API を呼ぶ", async () => {
    mockDeleteSession.mockResolvedValueOnce({});

    await logoutPlatform("tok_abc");
    expect(mockDeleteSession).toHaveBeenCalledWith({ sessionId: "tok_abc" });
  });

  it("API エラー時も例外を投げない", async () => {
    mockDeleteSession.mockRejectedValueOnce(new Error("network error"));

    await expect(logoutPlatform("tok_abc")).resolves.toBeUndefined();
  });
});

describe("getPlatformCurrentOperator", () => {
  it("API 成功時はユーザー情報を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await getPlatformCurrentOperator("tok_abc");
    expect(result).toEqual({
      name: "Admin",
      publicId: "usr_1",
      role: "platform_super_admin",
    });
    expect(mockGetMe).toHaveBeenCalledWith({ sessionId: "tok_abc" });
  });

  it("sessionId が空文字の場合は null を返す (API を呼ばない)", async () => {
    const result = await getPlatformCurrentOperator("  ");
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("API がユーザーを返さない場合は null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({});

    await expect(getPlatformCurrentOperator("tok_abc")).resolves.toBeNull();
  });

  it("セッション無効 (Unauthenticated エラー) は null を返す", async () => {
    mockGetMe.mockRejectedValueOnce(
      new Error("unauthenticated: invalid session")
    );

    await expect(getPlatformCurrentOperator("tok_expired")).resolves.toBeNull();
  });
});
