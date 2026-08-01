import { describe, expect, it } from "vitest";

import {
  decryptSessionPayload,
  encryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "./index";

describe("web-session", () => {
  it("encrypts and decrypts a payload", async () => {
    const secret = resolveAuthSecret();
    const payload = {
      accessToken: "token-abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      tenantPublicId: "TENANT001",
    };

    const sealed = await encryptSessionPayload(payload, secret);
    const opened = await decryptSessionPayload(sealed, secret);

    expect(opened).toEqual(payload);
  });

  it("detects expired sessions", () => {
    expect(isSessionExpired(new Date(Date.now() - 1000).toISOString())).toBe(
      true
    );
    expect(isSessionExpired(new Date(Date.now() + 60_000).toISOString())).toBe(
      false
    );
  });
});
