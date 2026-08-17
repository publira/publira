import { afterEach, describe, expect, it } from "vitest";

import {
  decryptSessionPayload,
  encryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "./index";

const SECRET = "test-secret-value-that-is-long-enough-000000";

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
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      tenantId: "TENANT001",
    };

    const sealed = await encryptSessionPayload(payload, SECRET);
    const opened = await decryptSessionPayload(sealed, SECRET);

    expect(opened).toEqual(payload);
  });

  it("rejects a secret too short to key A256GCM", async () => {
    const payload = {
      accessToken: "token-abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
    expect(isSessionExpired(new Date(Date.now() - 1000).toISOString())).toBe(
      true
    );
    expect(isSessionExpired(new Date(Date.now() + 60_000).toISOString())).toBe(
      false
    );
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
});
