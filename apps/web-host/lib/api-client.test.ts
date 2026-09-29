import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccessToken } from "./api-client";
import { PUBLIC_SESSION_COOKIE_NAME } from "./auth-shared";

const { mockCacheLife, mockCookies } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: vi.fn(),
  io: () => Promise.resolve(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: () => Promise.resolve(new Headers()),
}));

const cookieStore = (value?: string) => ({
  get: (name: string) =>
    name === PUBLIC_SESSION_COOKIE_NAME && value !== undefined
      ? { value }
      : undefined,
});

describe("resolveAccessToken", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIRA_AUTH_SECRET", "a-test-secret-of-at-least-32-bytes");
    mockCacheLife.mockReset();
    mockCookies.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves the client cache time of the route to the reads that hold its data", async () => {
    const sealed = await encryptSessionPayload(
      { accessToken: "access-token", expiresAt: "2999-01-01T00:00:00Z" },
      resolveAuthSecret()
    );
    mockCookies.mockResolvedValueOnce(cookieStore(sealed));

    await expect(resolveAccessToken()).resolves.toBe("access-token");
    expect(mockCacheLife).toHaveBeenCalledExactlyOnceWith({
      stale: Number.POSITIVE_INFINITY,
    });
  });

  it("answers no token without a session cookie", async () => {
    mockCookies.mockResolvedValueOnce(cookieStore());

    await expect(resolveAccessToken()).resolves.toBe("");
  });
});
