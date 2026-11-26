import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCookie, mockSetCookie } = vi.hoisted(() => ({
  mockGetCookie: vi.fn(),
  mockSetCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mockGetCookie, set: mockSetCookie }),
}));

const device = {
  expiresAt: Temporal.Instant.from("2026-12-30T00:00:00Z"),
  token: "device-token",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readLoginDeviceToken", () => {
  it("reads the token this browser holds", async () => {
    mockGetCookie.mockReturnValueOnce({ value: " device-token " });
    const { readLoginDeviceToken } = await import("./login-device-cookie");

    await expect(readLoginDeviceToken()).resolves.toBe("device-token");
    expect(mockGetCookie).toHaveBeenCalledWith(
      "publira_web_storefront_login_device"
    );
  });

  it("answers an empty token for a browser that holds none", async () => {
    mockGetCookie.mockReturnValueOnce(undefined);
    const { readLoginDeviceToken } = await import("./login-device-cookie");

    await expect(readLoginDeviceToken()).resolves.toBe("");
  });
});

describe("writeLoginDeviceCookie", () => {
  it("keeps the device in its own cookie, expiring with it", async () => {
    const { writeLoginDeviceCookie } = await import("./login-device-cookie");

    await writeLoginDeviceCookie(device);

    expect(mockSetCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOnly: true,
        name: "publira_web_storefront_login_device",
        value: "device-token",
      })
    );
    expect(mockSetCookie.mock.calls[0]?.[0].expires.toISOString()).toBe(
      "2026-12-30T00:00:00.000Z"
    );
  });

  it("leaves the cookie alone when the sign-in was issued no device", async () => {
    const { writeLoginDeviceCookie } = await import("./login-device-cookie");

    await writeLoginDeviceCookie(null);

    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("does not fail the sign-in when the cookie cannot be written", async () => {
    const consoleError = vi.spyOn(console, "error").mockReturnValue();

    mockSetCookie.mockImplementationOnce(() => {
      throw new Error("headers already sent");
    });
    const { writeLoginDeviceCookie } = await import("./login-device-cookie");

    await expect(writeLoginDeviceCookie(device)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
