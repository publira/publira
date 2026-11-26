import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockLoginAdmin,
  mockReadLoginDeviceToken,
  mockRedirect,
  mockWriteAdminSessionCookie,
  mockWriteLoginDeviceCookie,
  mockWriteMfaChallenge,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockLoginAdmin: vi.fn(),
  mockReadLoginDeviceToken: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockWriteAdminSessionCookie: vi.fn(),
  mockWriteLoginDeviceCookie: vi.fn(),
  mockWriteMfaChallenge: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/admin-auth", () => ({ loginAdmin: mockLoginAdmin }));

vi.mock("#lib/admin-session-cookie", () => ({
  writeAdminSessionCookie: mockWriteAdminSessionCookie,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/login-device-cookie", () => ({
  readLoginDeviceToken: mockReadLoginDeviceToken,
  writeLoginDeviceCookie: mockWriteLoginDeviceCookie,
}));

vi.mock("#lib/mfa-challenge", () => ({
  MFA_PATH: "/mfa",
  writeMfaChallenge: mockWriteMfaChallenge,
}));

const TENANT_ID = "0194f3c0-0000-7000-8000-000000000001";

const device = {
  expiresAt: Temporal.Instant.from("2026-12-30T00:00:00Z"),
  token: "device-new",
};

const loginFormData = (): FormData => {
  const formData = new FormData();
  formData.set("email", "operator@example.com");
  formData.set("next", "/works");
  formData.set("password", "correct horse battery staple");
  formData.set("tenant_id", TENANT_ID);

  return formData;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("loginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadLoginDeviceToken.mockResolvedValue("device-old");
  });

  it("presents the browser's device token and keeps the device the session came with", async () => {
    const session = {
      device,
      accessToken: "session-token",
      expiresAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
      kind: "session",
      ok: true,
    };

    mockLoginAdmin.mockResolvedValueOnce(session);

    const { loginAction } = await import("./actions");

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/works"
    );
    expect(mockLoginAdmin).toHaveBeenCalledWith(
      "operator@example.com",
      "correct horse battery staple",
      TENANT_ID,
      "en",
      "device-old"
    );
    expect(mockWriteLoginDeviceCookie).toHaveBeenCalledWith(device);
    expect(mockWriteAdminSessionCookie).toHaveBeenCalledWith(
      TENANT_ID,
      session
    );
  });

  it("keeps the device when the password earned a challenge instead", async () => {
    mockLoginAdmin.mockResolvedValueOnce({
      device,
      challengeKind: "verify",
      challengeToken: "challenge-token",
      expiresAt: Temporal.Instant.from("2026-10-01T00:05:00Z"),
      kind: "challenge",
      methods: ["totp"],
      ok: true,
    });

    const { loginAction } = await import("./actions");

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/mfa"
    );
    expect(mockWriteLoginDeviceCookie).toHaveBeenCalledWith(device);
    expect(mockWriteAdminSessionCookie).not.toHaveBeenCalled();
  });

  it("writes no device when the credentials are refused", async () => {
    mockLoginAdmin.mockResolvedValueOnce({
      message: "The email address or password is incorrect.",
      ok: false,
    });

    const { loginAction } = await import("./actions");

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login?error="
    );
    expect(mockWriteLoginDeviceCookie).not.toHaveBeenCalled();
    expect(mockWriteAdminSessionCookie).not.toHaveBeenCalled();
  });
});
