import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformStorageSettings,
  platformStorageSettingsCacheTag,
  storageTestFailureMessage,
  testPlatformStorageConnection,
  updatePlatformStorageSettings,
} from "./storage-settings";
import type { PlatformStorageInput } from "./storage-settings";
import {
  STORAGE_SECRET_REPLACE,
  STORAGE_SECRET_UNCHANGED,
} from "./storage-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetPlatformLocale,
  mockGetPlatformStorageSettings,
  mockResolveSessionId,
  mockTestPlatformStorageConnection,
  mockUpdatePlatformStorageSettings,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockGetPlatformStorageSettings: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockTestPlatformStorageConnection: vi.fn(),
  mockUpdatePlatformStorageSettings: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
  apiClient: {
    storageSettings: {
      getPlatformStorageSettings: mockGetPlatformStorageSettings,
      testPlatformStorageConnection: mockTestPlatformStorageConnection,
      updatePlatformStorageSettings: mockUpdatePlatformStorageSettings,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

const storedSettings = {
  accessKeyId: "AKIAEXAMPLE",
  bucket: "publira-media",
  endpoint: "https://s3.example.com",
  forcePathStyle: true,
  hasSecretAccessKey: true,
  publicBaseUrl: "",
  region: "us-east-1",
  revision: 3n,
};

const input: PlatformStorageInput = {
  accessKeyId: "AKIAEXAMPLE",
  bucket: "publira-media",
  endpoint: "https://s3.example.com",
  forcePathStyle: true,
  publicBaseUrl: "",
  region: "us-east-1",
  secretAccessKey: "",
  secretAccessKeyUpdateMode: STORAGE_SECRET_UNCHANGED,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
});

describe("getPlatformStorageSettings", () => {
  it("returns the stored values and the revision as a decimal string", async () => {
    mockGetPlatformStorageSettings.mockResolvedValueOnce({
      settings: storedSettings,
    });

    await expect(getPlatformStorageSettings()).resolves.toEqual({
      ok: true,
      settings: {
        accessKeyId: "AKIAEXAMPLE",
        bucket: "publira-media",
        endpoint: "https://s3.example.com",
        forcePathStyle: true,
        hasSecretAccessKey: true,
        publicBaseUrl: "",
        region: "us-east-1",
        revision: "3",
      },
    });
    expect(mockGetPlatformStorageSettings).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(platformStorageSettingsCacheTag).toBe("platform:storage-settings");
    expect(mockCacheTag).toHaveBeenCalledWith(platformStorageSettingsCacheTag);
    // Refreshed after a minute: `publiractl` writes the row straight to
    // Postgres, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("reads a platform with nothing saved as revision 0", async () => {
    mockGetPlatformStorageSettings.mockResolvedValueOnce({ settings: {} });

    const result = await getPlatformStorageSettings();

    expect(result).toMatchObject({
      ok: true,
      settings: { bucket: "", hasSecretAccessKey: false, revision: "0" },
    });
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformStorageSettings()).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetPlatformStorageSettings).not.toHaveBeenCalled();
  });

  it("returns a failure as a value instead of throwing inside the cache scope", async () => {
    mockGetPlatformStorageSettings.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformStorageSettings()).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("updatePlatformStorageSettings", () => {
  it("sends the form values with the revision the screen was rendered at", async () => {
    mockUpdatePlatformStorageSettings.mockResolvedValueOnce({
      settings: { ...storedSettings, revision: 4n },
    });

    const result = await updatePlatformStorageSettings(input, 3n, "en");

    expect(mockUpdatePlatformStorageSettings).toHaveBeenCalledWith(
      { ...input, expectedRevision: 3n },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(result).toMatchObject({ ok: true, settings: { revision: "4" } });
  });

  it("tells the operator to reload when another session saved first", async () => {
    mockUpdatePlatformStorageSettings.mockRejectedValueOnce(
      new ConnectError(
        "platform storage settings have changed since they were read",
        Code.FailedPrecondition
      )
    );

    await expect(
      updatePlatformStorageSettings(input, 3n, "en")
    ).resolves.toEqual({
      message:
        "Another operator changed the storage settings, so nothing was saved. Reload the screen and try again.",
      ok: false,
    });
  });

  it("passes the server's validation detail through", async () => {
    mockUpdatePlatformStorageSettings.mockRejectedValueOnce(
      new ConnectError("secret manager is not configured", Code.InvalidArgument)
    );

    await expect(
      updatePlatformStorageSettings(
        {
          ...input,
          secretAccessKey: "new-secret",
          secretAccessKeyUpdateMode: STORAGE_SECRET_REPLACE,
        },
        3n,
        "en"
      )
    ).resolves.toEqual({
      message: "secret manager is not configured",
      ok: false,
    });
  });
});

describe("testPlatformStorageConnection", () => {
  it("reports success only when all four operations passed", async () => {
    mockTestPlatformStorageConnection.mockResolvedValueOnce({
      checks: [1, 2, 3, 4].map((operation) => ({
        operation,
        reason: "",
        succeeded: true,
      })),
    });

    const result = await testPlatformStorageConnection(input, "en");

    expect(result).toEqual({
      checks: [
        { detail: "", label: "Upload", status: "succeeded" },
        { detail: "", label: "Read back", status: "succeeded" },
        { detail: "", label: "List", status: "succeeded" },
        { detail: "", label: "Delete", status: "succeeded" },
      ],
      ok: true,
      succeeded: true,
    });
  });

  it("names the failed operation and marks the ones the run never reached", async () => {
    mockTestPlatformStorageConnection.mockResolvedValueOnce({
      checks: [
        { operation: 1, reason: "STORAGE_TEST_CREDENTIALS", succeeded: false },
      ],
    });

    const result = await testPlatformStorageConnection(input, "en");

    expect(result).toMatchObject({ ok: true, succeeded: false });
    expect(result.ok && result.checks.map((check) => check.status)).toEqual([
      "failed",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.ok && result.checks[0]?.detail).toMatch(
      /^Authentication failed/u
    );
  });

  it("tells a permission failure apart from a connectivity one", async () => {
    mockTestPlatformStorageConnection.mockResolvedValueOnce({
      checks: [
        { operation: 1, reason: "", succeeded: true },
        { operation: 2, reason: "", succeeded: true },
        { operation: 3, reason: "STORAGE_TEST_PERMISSION", succeeded: false },
        { operation: 4, reason: "STORAGE_TEST_TIMEOUT", succeeded: false },
      ],
    });

    const result = await testPlatformStorageConnection(input, "en");

    expect(result.ok && result.checks.map((check) => check.detail)).toEqual([
      "",
      "",
      expect.stringMatching(/^Permission denied/u),
      expect.stringMatching(/^Connection timed out/u),
    ]);
  });

  it("words a reason it does not know as the unknown failure", async () => {
    mockTestPlatformStorageConnection.mockResolvedValueOnce({
      checks: [{ operation: 1, reason: "SOMETHING_NEW", succeeded: false }],
    });

    const result = await testPlatformStorageConnection(input, "en");

    expect(result.ok && result.checks[0]?.detail).toBe(
      "The storage refused for a reason Publira doesn't recognize. Check the storage provider's logs."
    );
  });
});

describe("storageTestFailureMessage", () => {
  it("words a recorded STORAGE_TEST_* reason and nothing else", async () => {
    await expect(
      storageTestFailureMessage("STORAGE_TEST_BUCKET_NOT_FOUND", "en")
    ).resolves.toBe(
      "Configuration problem: the bucket wasn't found. Check the bucket name, the region, and the endpoint."
    );
    await expect(
      storageTestFailureMessage("SMTP_TEST_AUTHENTICATION", "en")
    ).resolves.toBeUndefined();
  });
});
