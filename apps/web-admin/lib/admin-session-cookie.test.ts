import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetCookie, mockUpdateTag } = vi.hoisted(() => ({
  mockSetCookie: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("@publira/web-session", () => ({
  encryptSessionPayload: () => Promise.resolve("sealed-session"),
  resolveAuthSecret: () => "auth-secret",
  sessionCookieOptions: () => ({ httpOnly: true }),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: mockSetCookie }),
}));

describe("writeAdminSessionCookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the session cookie and clears the session read's tag", async () => {
    const { writeAdminSessionCookie } = await import("./admin-session-cookie");

    await writeAdminSessionCookie("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      accessToken: "session-token",
      expiresAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    });

    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "publira_web_admin_auth",
        value: "sealed-session",
      })
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("admin-session-cookie");
  });
});
