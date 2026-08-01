import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformCurrentOperator,
  loginPlatform,
  logoutPlatform,
} from "./auth";

const { mockLogin, mockLogout, mockGetMe, mockResolveSessionId } = vi.hoisted(
  () => ({
    mockGetMe: vi.fn(),
    mockLogin: vi.fn(),
    mockLogout: vi.fn(),
    mockResolveSessionId: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      getMe: mockGetMe,
      login: mockLogin,
      logout: mockLogout,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveSessionId: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("tok_abc");
});

describe("loginPlatform", () => {
  it("API 成功時は sessionId と expiresAt を返す", async () => {
    const expiresAt = "2026-03-22T00:00:00Z";
    mockLogin.mockResolvedValueOnce({
      accessToken: { expiresAt, token: "tok_abc" },
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await loginPlatform("admin@example.com", "secret");
    expect(result).toEqual({
      expiresAt: new Date(expiresAt),
      sessionId: "tok_abc",
    });
    expect(mockLogin).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret",
    });
  });

  it("API がセッション情報を返さない場合は null を返す", async () => {
    mockLogin.mockResolvedValueOnce({ user: {} });

    await expect(loginPlatform("a@b.com", "x")).resolves.toBeNull();
  });

  it("認証失敗 (Unauthenticated エラー) は null を返す", async () => {
    mockLogin.mockRejectedValueOnce(
      new Error("unauthenticated: invalid credentials")
    );

    await expect(loginPlatform("a@b.com", "wrong")).resolves.toBeNull();
  });

  it("想定外エラー時は再throwする", async () => {
    mockLogin.mockRejectedValueOnce(new Error("network error"));

    await expect(loginPlatform("a@b.com", "x")).rejects.toThrow(
      "network error"
    );
  });
});

describe("logoutPlatform", () => {
  it("sessionId が空文字の場合 API を呼ばない", async () => {
    await logoutPlatform("  ");
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("正常な sessionId で API を呼ぶ", async () => {
    mockLogout.mockResolvedValueOnce({});

    await logoutPlatform("tok_abc");
    expect(mockLogout).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer tok_abc" } }
    );
  });

  it("API エラー時も例外を投げない", async () => {
    mockLogout.mockRejectedValueOnce(new Error("network error"));

    await expect(logoutPlatform("tok_abc")).resolves.toBeUndefined();
  });
});

describe("getPlatformCurrentOperator", () => {
  it("API 成功時はユーザー情報を返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await getPlatformCurrentOperator();
    expect(result).toEqual({
      name: "Admin",
      publicId: "usr_1",
      role: "platform_super_admin",
    });
    expect(mockGetMe).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer tok_abc" } }
    );
  });

  it("role は API の値をそのまま返す", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Admin", publicId: "usr_1", role: "super-admin" },
    });

    const result = await getPlatformCurrentOperator();
    expect(result).toEqual({
      name: "Admin",
      publicId: "usr_1",
      role: "super-admin",
    });
  });

  it("セッションが解決できない場合は null を返す (API を呼ばない)", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    const result = await getPlatformCurrentOperator();
    expect(result).toBeNull();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("API がユーザーを返さない場合は null を返す", async () => {
    mockGetMe.mockResolvedValueOnce({});

    await expect(getPlatformCurrentOperator()).resolves.toBeNull();
  });

  it("セッション無効 (Unauthenticated エラー) は null を返す", async () => {
    mockGetMe.mockRejectedValueOnce(
      new Error("unauthenticated: invalid session")
    );

    await expect(getPlatformCurrentOperator()).resolves.toBeNull();
  });
});
