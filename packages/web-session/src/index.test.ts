import { afterEach, describe, expect, it } from "vitest";

import {
  decryptSessionPayload,
  encryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
  sessionCookieOptions,
} from "./index";

const SECRET = "test-secret-value-that-is-long-enough-000000";

// Fixed points rather than an offset from the host clock: the JWE carries the
// expiry as an opaque string, and `isSessionExpired` takes `now` explicitly.
// NOW_MS is 2027-01-15T08:00:00.000Z in epoch milliseconds.
const NOW_MS = 1_800_000_000_000;
const PAST = "2027-01-15T07:59:59.000Z";
const FUTURE = "2027-01-15T08:01:00.000Z";

// No argument means "not set at all", which is the case the removed hardcoded
// fallback used to swallow.
const setSecret = (value?: string) => {
  if (value === undefined) {
    delete process.env.PUBLIRA_AUTH_SECRET;
    return;
  }
  process.env.PUBLIRA_AUTH_SECRET = value;
};

describe("web-session", () => {
  it("encrypts and decrypts a payload", async () => {
    const payload = {
      accessToken: "token-abc",
      expiresAt: FUTURE,
      tenantId: "TENANT001",
    };

    const sealed = await encryptSessionPayload(payload, SECRET);
    const opened = await decryptSessionPayload(sealed, SECRET);

    expect(opened).toEqual(payload);
  });

  it("rejects a secret too short to key A256GCM", async () => {
    const payload = {
      accessToken: "token-abc",
      expiresAt: FUTURE,
    };
    const sealed = await encryptSessionPayload(payload, SECRET);

    expect(() => encryptSessionPayload(payload, "too-short")).toThrow(
      /at least 32 bytes/u
    );
    // Not `null`: an unusable key must not be reported as "no session".
    await expect(decryptSessionPayload(sealed, "too-short")).rejects.toThrow(
      /at least 32 bytes/u
    );
  });

  it("detects expired sessions", () => {
    expect(isSessionExpired(PAST, NOW_MS)).toBe(true);
    expect(isSessionExpired(FUTURE, NOW_MS)).toBe(false);
  });

  describe("resolveAuthSecret", () => {
    const original = process.env.PUBLIRA_AUTH_SECRET;

    afterEach(() => {
      setSecret(original);
    });

    it("returns the configured secret, trimmed", () => {
      setSecret(`  ${SECRET}  `);

      expect(resolveAuthSecret()).toBe(SECRET);
    });

    it("throws when the variable is unset", () => {
      setSecret();

      expect(() => resolveAuthSecret()).toThrow(/PUBLIRA_AUTH_SECRET/u);
    });

    it("throws instead of falling back to a built-in secret", () => {
      setSecret("");

      expect(() => resolveAuthSecret()).toThrow(/PUBLIRA_AUTH_SECRET/u);
    });

    it("throws when the value is shorter than 32 bytes", () => {
      setSecret("short-secret");

      expect(() => resolveAuthSecret()).toThrow(/at least 32 bytes/u);
    });

    it("measures the length in bytes, not code units", () => {
      // 12 characters, 36 UTF-8 bytes: long enough to key A256GCM.
      setSecret("あいうえおかきくけこさし");

      expect(resolveAuthSecret()).toBe("あいうえおかきくけこさし");
    });
  });

  describe("sessionCookieOptions", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
        return;
      }
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("uses the required production cookie policy and preserves the expiry", () => {
      const expiresAt = new Date("2027-01-15T08:01:00.000Z");
      process.env.NODE_ENV = "production";

      expect(sessionCookieOptions(expiresAt)).toEqual({
        expires: expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    it("allows HTTP cookies outside production", () => {
      process.env.NODE_ENV = "development";

      expect(sessionCookieOptions(new Date(FUTURE)).secure).toBe(false);
    });
  });
});
