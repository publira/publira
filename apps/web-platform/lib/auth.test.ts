import { Code, ConnectError } from "@publira/api-client/errors";
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
  resolveAccessToken: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("tok_abc");
});

describe("loginPlatform", () => {
  it("returns accessToken and expiresAt when the API succeeds", async () => {
    const expiresAt = "2026-03-22T00:00:00Z";
    mockLogin.mockResolvedValueOnce({
      accessToken: { expiresAt, token: "tok_abc" },
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await loginPlatform("admin@example.com", "secret");
    expect(result).toEqual({
      accessToken: "tok_abc",
      expiresAt: new Date(expiresAt),
    });
    expect(mockLogin).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret",
    });
  });

  it("returns null when the API returns no session", async () => {
    mockLogin.mockResolvedValueOnce({ user: {} });

    await expect(loginPlatform("a@b.com", "x")).resolves.toBeNull();
  });

  it("returns null for authentication failures", async () => {
    mockLogin.mockRejectedValueOnce(
      new ConnectError("invalid credentials", Code.Unauthenticated)
    );

    await expect(loginPlatform("a@b.com", "wrong")).resolves.toBeNull();
  });

  it("rethrows unexpected errors", async () => {
    mockLogin.mockRejectedValueOnce(new Error("network error"));

    await expect(loginPlatform("a@b.com", "x")).rejects.toThrow(
      "network error"
    );
  });
});

describe("logoutPlatform", () => {
  it("does not call the API when accessToken is empty", async () => {
    await logoutPlatform("  ");
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("calls the API with a valid accessToken", async () => {
    mockLogout.mockResolvedValueOnce({});

    await logoutPlatform("tok_abc");
    expect(mockLogout).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer tok_abc" } }
    );
  });

  it("does not throw when the API errors", async () => {
    mockLogout.mockRejectedValueOnce(new Error("network error"));

    await expect(logoutPlatform("tok_abc")).resolves.toBeUndefined();
  });
});

describe("getPlatformCurrentOperator", () => {
  it("returns user information when the API succeeds", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Admin", publicId: "usr_1", role: "platform_super_admin" },
    });

    const result = await getPlatformCurrentOperator();
    expect(result).toEqual({
      ok: true,
      operator: {
        name: "Admin",
        publicId: "usr_1",
        role: "platform_super_admin",
      },
    });
    expect(mockGetMe).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer tok_abc" } }
    );
  });

  it("returns role from the API unchanged", async () => {
    mockGetMe.mockResolvedValueOnce({
      user: { name: "Admin", publicId: "usr_1", role: "super-admin" },
    });

    const result = await getPlatformCurrentOperator();
    expect(result).toEqual({
      ok: true,
      operator: { name: "Admin", publicId: "usr_1", role: "super-admin" },
    });
  });

  it("requires reauthentication without calling the API when the session cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    const result = await getPlatformCurrentOperator();
    expect(result).toEqual({ ok: false, requiresSignIn: true });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("does not require reauthentication when the API returns no user", async () => {
    mockGetMe.mockResolvedValueOnce({});

    await expect(getPlatformCurrentOperator()).resolves.toEqual({
      ok: false,
      requiresSignIn: false,
    });
  });

  it("requires reauthentication for an invalid session", async () => {
    mockGetMe.mockRejectedValueOnce(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(getPlatformCurrentOperator()).resolves.toEqual({
      ok: false,
      requiresSignIn: true,
    });
  });
});
