import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformStorageSettings,
  storageTestReasonKey,
  testPlatformStorageConnection,
  updatePlatformStorageSettings,
} from "./storage-settings";
import type { PlatformStorageInput } from "./storage-settings";
import {
  STORAGE_SECRET_REPLACE,
  STORAGE_SECRET_UNCHANGED,
} from "./storage-settings-shared";

const {
  mockCacheTag,
  mockGetPlatformStorageSettings,
  mockResolveSessionId,
  mockTestPlatformStorageConnection,
  mockUpdatePlatformStorageSettings,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetPlatformStorageSettings: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockTestPlatformStorageConnection: vi.fn(),
  mockUpdatePlatformStorageSettings: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
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
});

describe("getPlatformStorageSettings", () => {
  it("returns the stored values and the revision as a decimal string", async () => {
    mockGetPlatformStorageSettings.mockResolvedValueOnce({
      settings: storedSettings,
    });

    await expect(getPlatformStorageSettings("en")).resolves.toEqual({
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
  });

  it("reads a platform with nothing saved as revision 0", async () => {
    mockGetPlatformStorageSettings.mockResolvedValueOnce({ settings: {} });

    const result = await getPlatformStorageSettings("en");

    expect(result).toMatchObject({
      ok: true,
      settings: { bucket: "", hasSecretAccessKey: false, revision: "0" },
    });
  });

  it("asks for a sign-in without calling the API when there is no session", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPlatformStorageSettings("en")).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetPlatformStorageSettings).not.toHaveBeenCalled();
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

describe("storageTestReasonKey", () => {
  it("resolves a recorded STORAGE_TEST_* reason and nothing else", () => {
    expect(storageTestReasonKey("STORAGE_TEST_BUCKET_NOT_FOUND")).toBe(
      "platform.storage.test.reasons.bucket_not_found"
    );
    expect(storageTestReasonKey("SMTP_TEST_AUTHENTICATION")).toBeUndefined();
  });
});
