import { encryptPayload } from "@publira/web-session";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteCookie, mockGetCookie, mockSetCookie } = vi.hoisted(() => ({
  mockDeleteCookie: vi.fn(),
  mockGetCookie: vi.fn(),
  mockSetCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: mockDeleteCookie,
      get: mockGetCookie,
      set: mockSetCookie,
    }),
}));

const PUBLIRA_AUTH_SECRET = "test-secret-value-that-is-long-enough-000000";
const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const instantFromNow = (seconds: number): string =>
  Temporal.Now.instant().add({ seconds }).toString();

const challenge = () => ({
  challengeToken: "challenge-token",
  expiresAt: instantFromNow(300),
  kind: "verify" as const,
  nextPath: "/series",
  tenantId: TENANT_ID,
});

const sealed = (payload: unknown): Promise<string> =>
  encryptPayload(payload, PUBLIRA_AUTH_SECRET);

describe("readMfaChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  it("returns the challenge the console sealed", async () => {
    const stored = challenge();
    mockGetCookie.mockReturnValue({ value: await sealed(stored) });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toEqual(stored);
  });

  it("reports no challenge when the cookie is absent", async () => {
    // A `vi.fn()` with no implementation answers what an absent cookie does.
    mockGetCookie.mockReset();

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toBeNull();
  });

  it("reports no challenge once the challenge has run out", async () => {
    mockGetCookie.mockReturnValue({
      value: await sealed({ ...challenge(), expiresAt: instantFromNow(-1) }),
    });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toBeNull();
  });

  it("rejects a payload that is sealed but not a challenge", async () => {
    mockGetCookie.mockReturnValue({
      value: await sealed({ accessToken: "a-session", expiresAt: "later" }),
    });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toBeNull();
  });

  it("rejects a challenge naming a kind this console has no screen for", async () => {
    mockGetCookie.mockReturnValue({
      value: await sealed({ ...challenge(), kind: "sms" }),
    });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toBeNull();
  });

  it("sanitizes the return path a stored challenge carries", async () => {
    mockGetCookie.mockReturnValue({
      value: await sealed({
        ...challenge(),
        nextPath: "//evil.example.com",
      }),
    });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toMatchObject({ nextPath: "/" });
  });

  it("rejects a cookie sealed with another key", async () => {
    mockGetCookie.mockReturnValue({
      value: await encryptPayload(
        challenge(),
        "another-secret-long-enough-to-key-a256gcm-0"
      ),
    });

    const { readMfaChallenge } = await import("./mfa-challenge");

    await expect(readMfaChallenge()).resolves.toBeNull();
  });
});

describe("writeMfaChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PUBLIRA_AUTH_SECRET = PUBLIRA_AUTH_SECRET;
  });

  it("writes a cookie the browser cannot read, expiring with the challenge", async () => {
    const { MFA_CHALLENGE_COOKIE_NAME, readMfaChallenge, writeMfaChallenge } =
      await import("./mfa-challenge");
    const stored = challenge();

    await writeMfaChallenge(stored);

    const written = mockSetCookie.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      httpOnly: true,
      name: MFA_CHALLENGE_COOKIE_NAME,
      path: "/",
      sameSite: "lax",
    });
    expect(written.expires.getTime()).toBe(
      Temporal.Instant.from(stored.expiresAt).epochMilliseconds
    );

    // What was written is what a later request reads back.
    mockGetCookie.mockReturnValue({ value: written.value });
    await expect(readMfaChallenge()).resolves.toEqual(stored);
  });
});
