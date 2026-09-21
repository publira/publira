import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformWebPushSettings,
  updatePlatformWebPushSubject,
} from "./webpush-settings";

const {
  mockCacheTag,
  mockGetPlatformWebPushSettings,
  mockResolveSessionId,
  mockUpdatePlatformWebPushSubject,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetPlatformWebPushSettings: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockUpdatePlatformWebPushSubject: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    webPushSettings: {
      getPlatformWebPushSettings: mockGetPlatformWebPushSettings,
      updatePlatformWebPushSubject: mockUpdatePlatformWebPushSubject,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
}));

const storedSettings = {
  hasSubject: true,
  revision: 3n,
  subject: "mailto:push@example.com",
  vapidPublicKey: "BPublicKey",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
});

describe("getPlatformWebPushSettings", () => {
  it("returns the subject and the revision, and nothing of the key pair", async () => {
    mockGetPlatformWebPushSettings.mockResolvedValueOnce({
      settings: storedSettings,
    });

    await expect(getPlatformWebPushSettings("en")).resolves.toEqual({
      ok: true,
      settings: {
        configured: true,
        revision: "3",
        subject: "mailto:push@example.com",
      },
    });
    expect(mockCacheTag).toHaveBeenCalledWith("platform:webpush-settings");
  });

  it("reads a platform with no subject as not configured", async () => {
    mockGetPlatformWebPushSettings.mockResolvedValueOnce({
      settings: { ...storedSettings, hasSubject: false, subject: "" },
    });

    await expect(getPlatformWebPushSettings("en")).resolves.toMatchObject({
      ok: true,
      settings: { configured: false, subject: "" },
    });
  });

  it("names the missing encryption keys when the key pair cannot be generated", async () => {
    mockGetPlatformWebPushSettings.mockRejectedValueOnce(
      new ConnectError(
        "secret manager is not configured",
        Code.FailedPrecondition
      )
    );

    const result = await getPlatformWebPushSettings("en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(result.ok ? "" : result.message).toMatch(
      /PUBLIRA_SECRET_ENCRYPTION_KEYS/u
    );
  });

  it("asks for a sign-in without calling the API when there is no session", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPlatformWebPushSettings("en")).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetPlatformWebPushSettings).not.toHaveBeenCalled();
  });
});

describe("updatePlatformWebPushSubject", () => {
  it("sends the subject with the revision the screen was rendered at", async () => {
    mockUpdatePlatformWebPushSubject.mockResolvedValueOnce({
      settings: { ...storedSettings, revision: 4n },
    });

    const result = await updatePlatformWebPushSubject(
      "mailto:push@example.com",
      3n,
      "en"
    );

    expect(mockUpdatePlatformWebPushSubject).toHaveBeenCalledWith(
      { expectedRevision: 3n, subject: "mailto:push@example.com" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(result).toMatchObject({
      ok: true,
      settings: { configured: true, revision: "4" },
    });
  });

  it("tells the operator to reload when another session saved first", async () => {
    mockUpdatePlatformWebPushSubject.mockRejectedValueOnce(
      new ConnectError(
        "platform web push settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    await expect(
      updatePlatformWebPushSubject("mailto:push@example.com", 3n, "en")
    ).resolves.toEqual({
      message:
        "Another operator changed the Web Push settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
  });

  it("words a subject the server refuses as the form's own guidance", async () => {
    mockUpdatePlatformWebPushSubject.mockRejectedValueOnce(
      new ConnectError(
        "subject must be a mailto: URI with an address or an absolute https: URL",
        Code.InvalidArgument
      )
    );

    await expect(
      updatePlatformWebPushSubject("mailto:push@example", 3n, "ja")
    ).resolves.toEqual({
      message:
        "mailto:push@example.com のようにメールアドレスを 1 つ含む mailto: URI か、https://example.com/contact のような https:// URL を入力してください。",
      ok: false,
    });
  });
});
